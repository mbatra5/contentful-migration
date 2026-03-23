import { getEnvironment } from './contentful-client';
import { Logger } from './logger';

const RATE_LIMIT_DELAY = 300;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface EntryRef {
  entries: string[];
  assets: string[];
}

function extractLinkReferences(fields: Record<string, unknown>): EntryRef {
  const refs: EntryRef = { entries: [], assets: [] };

  function walk(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    const sys = v.sys as Record<string, unknown> | undefined;
    if (sys?.type === 'Link') {
      if (sys.linkType === 'Entry') refs.entries.push(sys.id as string);
      else if (sys.linkType === 'Asset') refs.assets.push(sys.id as string);
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    for (const val of Object.values(v)) walk(val);
  }

  walk(fields);
  return refs;
}

function getDisplayTitle(fields: Record<string, unknown>): string | null {
  const titleFields = ['entryName', 'title', 'name', 'internalName', 'heading', 'label', 'slug'];
  for (const key of titleFields) {
    const f = fields[key] as Record<string, unknown> | undefined;
    if (!f) continue;
    const locales = Object.keys(f);
    if (locales.length > 0 && typeof f[locales[0]] === 'string') return f[locales[0]] as string;
  }
  return null;
}

// ─── ANALYZE (dry-run tree walk) ────────────────────────────

export interface AnalyzedEntry {
  id: string;
  contentType: string;
  title: string | null;
  depth: number;
  refCount: number;
  assetCount: number;
}

export interface AnalysisResult {
  entries: AnalyzedEntry[];
  totalEntries: number;
  totalAssets: number;
  contentTypeCounts: Record<string, number>;
  maxDepthReached: number;
  rootTitle: string;
}

export async function runAnalyze(
  token: string,
  spaceId: string,
  envId: string,
  entryId: string,
  opts: { maxDepth?: number; skipTypes?: string[] },
  logger: Logger,
): Promise<AnalysisResult> {
  const env = await getEnvironment(token, spaceId, envId);
  const { maxDepth = 1, skipTypes = ['page'] } = opts;
  const skipSet = new Set(skipTypes);

  const visited = new Set<string>();
  const skipped = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: entryId, depth: 0 }];
  const analyzed: AnalyzedEntry[] = [];
  const assetIds = new Set<string>();
  const contentTypeCounts: Record<string, number> = {};
  let maxDepthReached = 0;

  logger.info(`Analyzing entry tree from ${entryId} (depth ${maxDepth}, skip: ${skipTypes.join(', ') || 'none'})...`);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || skipped.has(id)) continue;
    visited.add(id);

    let entry;
    try {
      entry = await env.getEntry(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotFound') || msg.includes('404')) {
        logger.warn(`  Entry ${id} not found, skipping.`);
        continue;
      }
      throw err;
    }

    const contentType = (entry.sys.contentType as { sys: { id: string } }).sys.id;

    if (skipSet.has(contentType) && id !== entryId) {
      visited.delete(id);
      skipped.add(id);
      continue;
    }

    const refs = extractLinkReferences(entry.fields);
    const title = getDisplayTitle(entry.fields);

    analyzed.push({
      id,
      contentType,
      title,
      depth,
      refCount: refs.entries.length,
      assetCount: refs.assets.length,
    });

    contentTypeCounts[contentType] = (contentTypeCounts[contentType] || 0) + 1;
    refs.assets.forEach(a => assetIds.add(a));
    if (depth > maxDepthReached) maxDepthReached = depth;

    logger.info(`  [${analyzed.length}] ${'  '.repeat(depth)}${contentType}: ${title || id} (${refs.entries.length} refs, ${refs.assets.length} assets)`);

    if (depth < maxDepth) {
      for (const childId of refs.entries) {
        if (!visited.has(childId) && !skipped.has(childId)) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      }
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  const rootTitle = analyzed[0]?.title || entryId;

  logger.success(`\nAnalysis complete: ${analyzed.length} entries, ${assetIds.size} assets, ${Object.keys(contentTypeCounts).length} content types.`);
  if (skipped.size > 0) logger.info(`Skipped ${skipped.size} entries (type filter).`);

  return {
    entries: analyzed,
    totalEntries: analyzed.length,
    totalAssets: assetIds.size,
    contentTypeCounts,
    maxDepthReached,
    rootTitle,
  };
}

// ─── EXTRACT ────────────────────────────────────────────────

export interface ExtractedEntry {
  id: string;
  contentType: string;
  title: string | null;
  fields: Record<string, unknown>;
  entryRefs: string[];
  assetRefs: string[];
}

export interface ExtractionResult {
  entries: Record<string, ExtractedEntry>;
  dependencyOrder: string[];
  assetIds: string[];
  rootTitle: string;
}

export async function runExtract(
  token: string,
  spaceId: string,
  envId: string,
  entryId: string,
  opts: { maxDepth?: number; skipTypes?: string[] },
  logger: Logger,
): Promise<ExtractionResult> {
  const env = await getEnvironment(token, spaceId, envId);
  const { maxDepth = 1, skipTypes = ['page'] } = opts;
  const skipSet = new Set(skipTypes);

  const visited = new Set<string>();
  const skipped = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: entryId, depth: 0 }];
  const entries: Record<string, ExtractedEntry> = {};
  const assetIds = new Set<string>();
  const dependencyOrder: string[] = [];

  logger.info(`Walking entry tree from ${entryId} (depth ${maxDepth}, skip: ${skipTypes.join(', ') || 'none'})...`);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || skipped.has(id)) continue;
    visited.add(id);

    let entry;
    try {
      entry = await env.getEntry(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotFound') || msg.includes('404')) {
        logger.warn(`Entry ${id} not found, skipping.`);
        continue;
      }
      throw err;
    }

    const contentType = (entry.sys.contentType as { sys: { id: string } }).sys.id;

    if (skipSet.has(contentType) && id !== entryId) {
      visited.delete(id);
      skipped.add(id);
      continue;
    }

    const refs = extractLinkReferences(entry.fields);
    const title = getDisplayTitle(entry.fields);

    entries[id] = {
      id,
      contentType,
      title,
      fields: entry.fields,
      entryRefs: refs.entries,
      assetRefs: refs.assets,
    };

    refs.assets.forEach(a => assetIds.add(a));
    dependencyOrder.push(id);

    logger.info(`  [${dependencyOrder.length}] ${contentType}: ${title || id}`);

    if (depth < maxDepth) {
      for (const childId of refs.entries) {
        if (!visited.has(childId) && !skipped.has(childId)) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      }
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  const rootTitle = entries[entryId]?.title || entryId;
  logger.success(`\nExtraction complete: ${dependencyOrder.length} entries, ${assetIds.size} assets.`);

  return { entries, dependencyOrder, assetIds: [...assetIds], rootTitle };
}

// ─── MIGRATE (direct source → target) ──────────────────────

export interface MigrateResult {
  created: number;
  skipped: number;
  failed: number;
  remap: Record<string, string>;
}

function stripReferenceFields(fields: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') { clean[key] = localeMap; continue; }
    const cleaned: Record<string, unknown> = {};
    for (const [locale, value] of Object.entries(localeMap as Record<string, unknown>)) {
      if (isLink(value) || isLinkArray(value)) continue;
      cleaned[locale] = value;
    }
    if (Object.keys(cleaned).length > 0) clean[key] = cleaned;
  }
  return clean;
}

function isLink(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const sys = (v as Record<string, unknown>).sys as Record<string, unknown> | undefined;
  return sys?.type === 'Link';
}

function isLinkArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && isLink(v[0]);
}

function remapFields(
  fields: Record<string, unknown>,
  entryIdMap: Record<string, string>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fields), (_key, value) => {
    if (value && typeof value === 'object' && value.sys?.type === 'Link' && value.sys?.linkType === 'Entry') {
      const mapped = entryIdMap[value.sys.id];
      if (mapped) return { sys: { ...value.sys, id: mapped } };
    }
    return value;
  });
}

function filterLocales(fields: Record<string, unknown>, allowedLocales: Set<string>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') { filtered[key] = localeMap; continue; }
    const kept: Record<string, unknown> = {};
    for (const [locale, val] of Object.entries(localeMap as Record<string, unknown>)) {
      if (allowedLocales.has(locale)) kept[locale] = val;
    }
    if (Object.keys(kept).length > 0) filtered[key] = kept;
  }
  return filtered;
}

export async function runMigrate(
  token: string,
  source: { spaceId: string; envId: string; entryId: string },
  target: { spaceId: string; envId: string },
  opts: { maxDepth?: number; skipTypes?: string[]; publish?: boolean; force?: boolean },
  logger: Logger,
): Promise<MigrateResult> {
  logger.info('Connecting to source...');
  const sourceEnv = await getEnvironment(token, source.spaceId, source.envId);

  const extraction = await runExtract(
    token, source.spaceId, source.envId, source.entryId,
    { maxDepth: opts.maxDepth, skipTypes: opts.skipTypes },
    logger,
  );

  const { entries, dependencyOrder } = extraction;
  if (dependencyOrder.length === 0) {
    logger.warn('No entries to migrate.');
    return { created: 0, skipped: 0, failed: 0, remap: {} };
  }

  logger.info('\nConnecting to target...');
  const targetEnv = await getEnvironment(token, target.spaceId, target.envId);

  const localesResp = await targetEnv.getLocales();
  const allowedLocales = new Set(localesResp.items.map((l: { code: string }) => l.code));
  logger.info(`Target locales: ${[...allowedLocales].join(', ')}`);

  const remap: Record<string, string> = {};
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Pass 1: Create shells
  logger.info(`\nPass 1: Creating ${dependencyOrder.length} entry shells...`);

  for (let i = 0; i < dependencyOrder.length; i++) {
    const id = dependencyOrder[i];
    const entry = entries[id];
    const label = `[${i + 1}/${dependencyOrder.length}]`;

    const strippedFields = filterLocales(stripReferenceFields(entry.fields), allowedLocales);

    try {
      const newEntry = await targetEnv.createEntry(entry.contentType, { fields: strippedFields });
      remap[id] = newEntry.sys.id;
      logger.success(`  ${label} ${entry.contentType}: ${entry.title || id} -> ${newEntry.sys.id}`);
      created++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  ${label} ${entry.contentType}: ${entry.title || id} FAILED: ${msg}`);
      failed++;
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  // Pass 2: Link references
  const withRefs = dependencyOrder.filter(id => remap[id] && entries[id].entryRefs.length > 0);
  if (withRefs.length > 0) {
    logger.info(`\nPass 2: Linking references for ${withRefs.length} entries...`);

    for (let i = 0; i < withRefs.length; i++) {
      const id = withRefs[i];
      const entry = entries[id];
      const targetId = remap[id];
      const label = `[${i + 1}/${withRefs.length}]`;

      const remappedFields = filterLocales(remapFields(entry.fields, remap), allowedLocales);

      try {
        const targetEntry = await targetEnv.getEntry(targetId);
        targetEntry.fields = remappedFields;
        await targetEntry.update();
        logger.success(`  ${label} ${entry.contentType}: ${entry.title || id} linked (${entry.entryRefs.length} refs)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`  ${label} Linking failed: ${msg}`);
      }

      await sleep(RATE_LIMIT_DELAY);
    }
  }

  // Publish
  if (opts.publish) {
    logger.info(`\nPublishing ${created} entries...`);
    for (const [, targetId] of Object.entries(remap)) {
      try {
        const e = await targetEnv.getEntry(targetId);
        await e.publish();
      } catch { /* skip */ }
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  logger.success(`\nMigration complete: ${created} created, ${skipped} skipped, ${failed} failed.`);
  return { created, skipped, failed, remap };
}

// ─── CREATE (push extracted data to target) ─────────────────

export async function runCreate(
  token: string,
  extraction: ExtractionResult,
  target: { spaceId: string; envId: string },
  opts: { publish?: boolean },
  logger: Logger,
): Promise<MigrateResult> {
  const { entries, dependencyOrder } = extraction;
  if (dependencyOrder.length === 0) {
    logger.warn('No entries to create.');
    return { created: 0, skipped: 0, failed: 0, remap: {} };
  }

  logger.info('Connecting to target...');
  const targetEnv = await getEnvironment(token, target.spaceId, target.envId);

  const localesResp = await targetEnv.getLocales();
  const allowedLocales = new Set(localesResp.items.map((l: { code: string }) => l.code));
  logger.info(`Target locales: ${[...allowedLocales].join(', ')}`);

  const remap: Record<string, string> = {};
  let created = 0;
  let skipped = 0;
  let failed = 0;

  logger.info(`\nPass 1: Creating ${dependencyOrder.length} entry shells...`);
  for (let i = 0; i < dependencyOrder.length; i++) {
    const id = dependencyOrder[i];
    const entry = entries[id];
    const label = `[${i + 1}/${dependencyOrder.length}]`;
    const strippedFields = filterLocales(stripReferenceFields(entry.fields), allowedLocales);
    try {
      const newEntry = await targetEnv.createEntry(entry.contentType, { fields: strippedFields });
      remap[id] = newEntry.sys.id;
      logger.success(`  ${label} ${entry.contentType}: ${entry.title || id} -> ${newEntry.sys.id}`);
      created++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  ${label} ${entry.contentType}: ${entry.title || id} FAILED: ${msg}`);
      failed++;
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  const withRefs = dependencyOrder.filter(id => remap[id] && entries[id].entryRefs.length > 0);
  if (withRefs.length > 0) {
    logger.info(`\nPass 2: Linking references for ${withRefs.length} entries...`);
    for (let i = 0; i < withRefs.length; i++) {
      const id = withRefs[i];
      const entry = entries[id];
      const targetId = remap[id];
      const label = `[${i + 1}/${withRefs.length}]`;
      const remappedFields = filterLocales(remapFields(entry.fields, remap), allowedLocales);
      try {
        const targetEntry = await targetEnv.getEntry(targetId);
        targetEntry.fields = remappedFields;
        await targetEntry.update();
        logger.success(`  ${label} ${entry.contentType}: ${entry.title || id} linked (${entry.entryRefs.length} refs)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`  ${label} Linking failed: ${msg}`);
      }
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  if (opts.publish) {
    logger.info(`\nPublishing ${created} entries...`);
    for (const [, targetId] of Object.entries(remap)) {
      try {
        const e = await targetEnv.getEntry(targetId);
        await e.publish();
      } catch { /* skip */ }
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  logger.success(`\nCreate complete: ${created} created, ${skipped} skipped, ${failed} failed.`);
  return { created, skipped, failed, remap };
}

// ─── TRANSFORM ──────────────────────────────────────────────

export interface TransformRule {
  rule: 'set' | 'copy' | 'delete' | 'modify';
  field?: string;
  sourceLocale?: string;
  targetLocale?: string;
  value?: unknown;
  suffix?: string;
  prefix?: string;
  replace?: { from: string; to: string };
}

export interface TransformResult {
  updated: number;
  skipped: number;
  failed: number;
}

export async function runTransform(
  token: string,
  spaceId: string,
  envId: string,
  contentType: string,
  transforms: TransformRule[],
  filters: { draft?: boolean; published?: boolean; updatedBy?: string; nameContains?: string },
  logger: Logger,
): Promise<TransformResult> {
  const env = await getEnvironment(token, spaceId, envId);

  logger.info(`Querying ${contentType} entries...`);
  const response = await env.getEntries({
    content_type: contentType,
    limit: 1000,
    'sys.archivedAt[exists]': false,
  });

  let items = response.items;
  logger.info(`Found ${items.length} entries from API.`);

  if (filters.draft) items = items.filter((e: { sys: { publishedVersion?: number } }) => !e.sys.publishedVersion);
  if (filters.published) items = items.filter((e: { sys: { publishedVersion?: number } }) => !!e.sys.publishedVersion);
  if (filters.updatedBy) {
    const uid = filters.updatedBy;
    items = items.filter((e: { sys: { updatedBy?: { sys: { id: string } } } }) => e.sys.updatedBy?.sys?.id === uid);
  }
  if (filters.nameContains) {
    const search = filters.nameContains.toLowerCase();
    items = items.filter((e: { fields: Record<string, unknown> }) => {
      const title = getDisplayTitle(e.fields);
      return title != null && title.toLowerCase().includes(search);
    });
    logger.info(`Name filter "${filters.nameContains}": ${items.length} matches.`);
  }

  logger.info(`After filters: ${items.length} entries.`);

  let updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < items.length; i++) {
    const entry = items[i];
    const title = getDisplayTitle(entry.fields) || entry.sys.id;
    const label = `[${i + 1}/${items.length}]`;

    const changedFields: string[] = [];
    for (const t of transforms) {
      const changed = applyTransform(entry.fields, t);
      changedFields.push(...changed);
    }

    if (changedFields.length === 0) {
      logger.info(`  ${label} ${title} — no changes`);
      skipped++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    try {
      await entry.update();
      logger.success(`  ${label} ${title} — updated: ${changedFields.join(', ')}`);
      updated++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  ${label} ${title} — FAILED: ${msg}`);
      failed++;
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  logger.success(`\nTransform complete: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
  return { updated, skipped, failed };
}

function applyTransform(fields: Record<string, Record<string, unknown>>, t: TransformRule): string[] {
  const changed: string[] = [];
  const entries = t.field
    ? (fields[t.field] ? [[t.field, fields[t.field]]] as [string, Record<string, unknown>][] : [])
    : Object.entries(fields) as [string, Record<string, unknown>][];

  for (const [fieldName, localeMap] of entries) {
    if (typeof localeMap !== 'object' || localeMap === null) continue;

    switch (t.rule) {
      case 'set':
        if (!t.targetLocale || t.value === undefined) break;
        localeMap[t.targetLocale] = t.value;
        changed.push(fieldName);
        break;
      case 'copy':
        if (!t.sourceLocale || !t.targetLocale) break;
        if (!(t.sourceLocale in localeMap)) break;
        let val = structuredClone(localeMap[t.sourceLocale]);
        if (typeof val === 'string') {
          if (t.prefix) val = t.prefix + val;
          if (t.suffix) val = val + t.suffix;
          if (t.replace) val = (val as string).replace(new RegExp(t.replace.from, 'g'), t.replace.to);
        }
        localeMap[t.targetLocale] = val;
        changed.push(fieldName);
        break;
      case 'delete':
        if (!t.targetLocale || !(t.targetLocale in localeMap)) break;
        delete localeMap[t.targetLocale];
        changed.push(fieldName);
        break;
      case 'modify':
        if (!t.targetLocale || !(t.targetLocale in localeMap)) break;
        let mval = localeMap[t.targetLocale];
        if (typeof mval === 'string') {
          if (t.replace) mval = mval.replace(new RegExp(t.replace.from, 'g'), t.replace.to);
          if (t.prefix) mval = t.prefix + mval;
          if (t.suffix) mval = mval + t.suffix;
          localeMap[t.targetLocale] = mval;
          changed.push(fieldName);
        }
        break;
    }
  }
  return changed;
}

// ─── FIX BROKEN ASSETS ─────────────────────────────────────

export interface FixBrokenAssetsResult {
  checked: number;
  fixed: number;
  skipped: number;
  failed: number;
}

export async function runFixBrokenAssets(
  token: string,
  spaceId: string,
  envId: string,
  contentType: string,
  replacementEntryId: string,
  filters: { draft?: boolean; published?: boolean; updatedBy?: string; nameContains?: string },
  logger: Logger,
): Promise<FixBrokenAssetsResult> {
  const env = await getEnvironment(token, spaceId, envId);

  logger.info(`Fetching replacement entry ${replacementEntryId}...`);
  let replacementEntry;
  try {
    replacementEntry = await env.getEntry(replacementEntryId);
  } catch {
    logger.error(`Replacement entry ${replacementEntryId} not found in target space.`);
    return { checked: 0, fixed: 0, skipped: 0, failed: 0 };
  }

  const replacementCt = (replacementEntry.sys.contentType as { sys: { id: string } }).sys.id;
  logger.info(`Replacement entry is type "${replacementCt}": ${getDisplayTitle(replacementEntry.fields) || replacementEntryId}`);

  logger.info(`\nQuerying ${contentType} entries...`);
  const response = await env.getEntries({
    content_type: contentType,
    limit: 1000,
    'sys.archivedAt[exists]': false,
  });

  let items = response.items;
  logger.info(`Found ${items.length} entries.`);

  if (filters.draft) items = items.filter((e: { sys: { publishedVersion?: number } }) => !e.sys.publishedVersion);
  if (filters.published) items = items.filter((e: { sys: { publishedVersion?: number } }) => !!e.sys.publishedVersion);
  if (filters.updatedBy) {
    const uid = filters.updatedBy;
    items = items.filter((e: { sys: { updatedBy?: { sys: { id: string } } } }) => e.sys.updatedBy?.sys?.id === uid);
  }
  if (filters.nameContains) {
    const search = filters.nameContains.toLowerCase();
    items = items.filter((e: { fields: Record<string, unknown> }) => {
      const title = getDisplayTitle(e.fields);
      return title != null && title.toLowerCase().includes(search);
    });
    logger.info(`Name filter "${filters.nameContains}": ${items.length} matches.`);
  }

  logger.info(`After filters: ${items.length} entries to check.\n`);

  let checked = 0, fixed = 0, skipped = 0, failed = 0;

  for (let i = 0; i < items.length; i++) {
    const entry = items[i];
    const title = getDisplayTitle(entry.fields) || entry.sys.id;
    const label = `[${i + 1}/${items.length}]`;
    checked++;

    const brokenFields = await findBrokenAssetLinks(env, entry.fields, logger);

    if (brokenFields.length === 0) {
      logger.info(`  ${label} ${title} — all assets OK`);
      skipped++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    logger.warn(`  ${label} ${title} — ${brokenFields.length} broken asset field(s): ${brokenFields.map(b => b.field).join(', ')}`);

    let changed = false;
    for (const { field, locale } of brokenFields) {
      if (entry.fields[field]?.[locale]) {
        entry.fields[field][locale] = {
          sys: { type: 'Link', linkType: 'Entry', id: replacementEntryId },
        };
        changed = true;
      }
    }

    if (!changed) {
      skipped++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    try {
      await entry.update();
      logger.success(`  ${label} ${title} — fixed ${brokenFields.length} field(s)`);
      fixed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  ${label} ${title} — update FAILED: ${msg}`);
      failed++;
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  logger.success(`\nDone: checked ${checked}, fixed ${fixed}, skipped ${skipped}, failed ${failed}.`);
  return { checked, fixed, skipped, failed };
}

async function findBrokenAssetLinks(
  env: Awaited<ReturnType<typeof getEnvironment>>,
  fields: Record<string, Record<string, unknown>>,
  logger: Logger,
): Promise<{ field: string; locale: string; assetId?: string; reason: string }[]> {
  const broken: { field: string; locale: string; assetId?: string; reason: string }[] = [];

  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') continue;

    for (const [locale, value] of Object.entries(localeMap)) {
      if (!value || typeof value !== 'object') continue;
      const sys = (value as Record<string, unknown>).sys as Record<string, unknown> | undefined;
      if (!sys || sys.type !== 'Link') continue;

      if (sys.linkType === 'Asset') {
        const assetId = sys.id as string;
        try {
          const asset = await env.getAsset(assetId);
          const fileField = asset.fields?.file;
          if (!fileField) {
            broken.push({ field: fieldName, locale, assetId, reason: 'no file field' });
            continue;
          }
          const locales = Object.keys(fileField);
          const file = locales.length > 0 ? (fileField as Record<string, { url?: string }>)[locales[0]] : null;
          if (!file || !file.url) {
            broken.push({ field: fieldName, locale, assetId, reason: 'empty/no URL' });
          }
        } catch {
          broken.push({ field: fieldName, locale, assetId, reason: '404 / not found' });
        }
        await sleep(100);
      }

      if (sys.linkType === 'Entry') {
        const entryId = sys.id as string;
        try {
          await env.getEntry(entryId);
        } catch {
          broken.push({ field: fieldName, locale, assetId: entryId, reason: 'linked entry not found' });
        }
        await sleep(100);
      }
    }
  }

  return broken;
}
