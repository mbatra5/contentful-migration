/**
 * Asset migration with deduplication.
 *
 * Transfers assets from source to target Contentful space without local download.
 * Uses Contentful CDN URL as the upload source (Contentful servers fetch the file).
 *
 * Dedup cascade on cold start (no asset-remap.json):
 *   1. Check asset-remap.json cache
 *   2. Search target space by exact filename match
 *   3. Fallback: search by title
 *   4. Only create new asset if no match found
 */

import { RATE_LIMIT_DELAY, sleep } from './helpers.js';

/**
 * Migrate a set of assets from source to target space.
 * Populates assetRemap (sourceId → targetId) for each processed asset.
 *
 * @param {object} sourceEnv  - Source Contentful environment
 * @param {object} targetEnv  - Target Contentful environment
 * @param {string[]} assetIds - Source asset IDs to migrate
 * @param {object} assetRemap - Mutable map of sourceAssetId → targetAssetId
 * @param {object} opts       - { dryRun, allowedLocales, cdaToken }
 * @returns {{ migrated, reused, failed }} counts
 */
export async function migrateAssets(sourceEnv, targetEnv, assetIds, assetRemap, opts = {}) {
  const { dryRun = false, allowedLocales = null, cdaToken = null } = opts;
  let migrated = 0;
  let reused = 0;
  let failed = 0;

  const toProcess = assetIds.filter(id => !assetRemap[id]);

  if (toProcess.length === 0) {
    const cached = assetIds.filter(id => assetRemap[id]).length;
    if (cached > 0) console.log(`  All ${cached} assets already in asset-remap — skipping.\n`);
    return { migrated: 0, reused: cached, failed: 0 };
  }

  const cachedCount = assetIds.length - toProcess.length;
  if (cachedCount > 0) {
    console.log(`  ${cachedCount} assets already mapped (cached). Processing ${toProcess.length} remaining.\n`);
  }

  for (let i = 0; i < toProcess.length; i++) {
    const sourceAssetId = toProcess[i];
    const label = `[${i + 1}/${toProcess.length}]`;

    let sourceAsset;
    try {
      sourceAsset = await sourceEnv.getAsset(sourceAssetId);
    } catch (err) {
      console.log(`  ${label} ${sourceAssetId} — FETCH FAILED: ${err.message}`);
      failed++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    const assetTitle = getAssetTitle(sourceAsset);
    const fileInfo = getAssetFileInfo(sourceAsset);

    if (!fileInfo) {
      console.log(`  ${label} ${assetTitle} — no file attached, skipping`);
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    process.stdout.write(`  ${label} ${assetTitle} (${fileInfo.fileName})...`);

    // Step 1: Try to find existing asset in target by filename
    const existing = await findExistingAsset(targetEnv, fileInfo.fileName, assetTitle);

    if (existing) {
      assetRemap[sourceAssetId] = existing.id;
      console.log(` REUSED → ${existing.id} (matched by ${existing.matchedBy})`);
      reused++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    if (dryRun) {
      console.log(` WOULD CREATE (${fileInfo.contentType}, ${formatBytes(fileInfo.size)})`);
      migrated++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    // Step 2: Create new asset in target using source CDN URL
    try {
      const newAsset = await createAssetFromUrl(targetEnv, sourceAsset, fileInfo, allowedLocales, cdaToken);
      assetRemap[sourceAssetId] = newAsset.sys.id;
      console.log(` CREATED → ${newAsset.sys.id}`);
      migrated++;
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      failed++;
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  return { migrated, reused: reused + cachedCount, failed };
}

/**
 * Search target space for an existing asset that matches by filename (primary)
 * or title (fallback).
 */
async function findExistingAsset(targetEnv, fileName, title) {
  // Primary: exact filename match (skip broken assets with no URL or errors)
  try {
    const byFile = await targetEnv.getAssets({
      'fields.file.fileName': fileName,
      limit: 5,
    });
    const healthy = byFile.items.find(a => {
      const f = getAssetFileInfo(a);
      return f && f.url && !getAssetError(a);
    });
    if (healthy) {
      return { id: healthy.sys.id, matchedBy: 'filename' };
    }
  } catch {
    // Some spaces don't support this query filter — fall through
  }

  await sleep(RATE_LIMIT_DELAY);

  // Fallback: title match (also skip broken assets)
  if (title) {
    try {
      const byTitle = await targetEnv.getAssets({
        'fields.title[match]': title,
        limit: 5,
      });
      const healthyByTitle = byTitle.items.filter(a => {
        const f = getAssetFileInfo(a);
        return f && f.url && !getAssetError(a);
      });
      if (healthyByTitle.length > 0) {
        const exactFile = healthyByTitle.find(a => {
          const f = getAssetFileInfo(a);
          return f && f.fileName === fileName;
        });
        const match = exactFile || healthyByTitle[0];
        return { id: match.sys.id, matchedBy: exactFile ? 'title+filename' : 'title' };
      }
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Create an asset in the target space using the source asset's CDN URL.
 * No local download — Contentful servers fetch from the URL directly.
 */
async function createAssetFromUrl(targetEnv, sourceAsset, fileInfo, allowedLocales, cdaToken) {
  const fields = buildAssetFields(sourceAsset, fileInfo, allowedLocales, cdaToken);

  const newAsset = await targetEnv.createAsset({ fields });
  await sleep(RATE_LIMIT_DELAY);

  // Process the asset (tells Contentful to download and host the file)
  const processing = await newAsset.processForAllLocales();
  await sleep(1000);

  // Poll until processing completes (max 30s)
  let ready = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const check = await targetEnv.getAsset(processing.sys.id);
      const fileField = check.fields.file;
      const allProcessed = Object.values(fileField).every(f => f.url && !f.upload);
      if (allProcessed) {
        ready = true;
        break;
      }
    } catch {
      // still processing
    }
    await sleep(3000);
  }

  if (!ready) {
    console.log(`\n    Warning: Asset ${processing.sys.id} may still be processing.`);
  }

  return processing;
}

/**
 * Build Contentful asset fields from source asset data.
 * Uses the source CDN URL as the upload URL.
 * For spaces with secure media, appends the CDA token for authenticated access.
 */
function buildAssetFields(sourceAsset, fileInfo, allowedLocales, cdaToken) {
  const fields = {};

  if (sourceAsset.fields.title) {
    fields.title = filterAssetLocales(sourceAsset.fields.title, allowedLocales);
  }

  if (sourceAsset.fields.description) {
    fields.description = filterAssetLocales(sourceAsset.fields.description, allowedLocales);
  }

  const fileField = {};
  for (const [locale, file] of Object.entries(sourceAsset.fields.file)) {
    if (allowedLocales && !allowedLocales.has(locale)) continue;

    let cdnUrl = file.url.startsWith('//') ? `https:${file.url}` : file.url;

    // Append CDA token for spaces with secure/private media delivery
    if (cdaToken && !cdnUrl.includes('access_token')) {
      cdnUrl += (cdnUrl.includes('?') ? '&' : '?') + `access_token=${cdaToken}`;
    }

    fileField[locale] = {
      contentType: file.contentType,
      fileName: file.fileName,
      upload: cdnUrl,
    };
  }
  fields.file = fileField;

  return fields;
}

function filterAssetLocales(localeMap, allowedLocales) {
  if (!allowedLocales) return { ...localeMap };
  const filtered = {};
  for (const [locale, value] of Object.entries(localeMap)) {
    if (allowedLocales.has(locale)) filtered[locale] = value;
  }
  return Object.keys(filtered).length > 0 ? filtered : { ...localeMap };
}

function getAssetTitle(asset) {
  if (!asset.fields.title) return asset.sys.id;
  const locales = Object.keys(asset.fields.title);
  return locales.length > 0 ? asset.fields.title[locales[0]] : asset.sys.id;
}

function getAssetFileInfo(asset) {
  if (!asset.fields.file) return null;
  const locales = Object.keys(asset.fields.file);
  if (locales.length === 0) return null;
  const file = asset.fields.file[locales[0]];
  return {
    fileName: file.fileName,
    contentType: file.contentType,
    url: file.url,
    size: file.details?.size || 0,
  };
}

function getAssetError(asset) {
  if (!asset.fields.file) return null;
  const locales = Object.keys(asset.fields.file);
  if (locales.length === 0) return null;
  return asset.fields.file[locales[0]]?.error || null;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Collect all unique asset IDs referenced in entry fields.
 * Works with both walker output (entryData map) and local catalog data.
 */
export function collectAssetIds(entries) {
  const assetIds = new Set();

  for (const entry of Object.values(entries)) {
    if (entry.assetRefs) {
      for (const id of entry.assetRefs) assetIds.add(id);
    }
    if (entry.fields) {
      walkFieldsForAssets(entry.fields, assetIds);
    }
  }

  return [...assetIds];
}

function walkFieldsForAssets(value, assetIds) {
  if (!value || typeof value !== 'object') return;

  if (value.sys?.type === 'Link' && value.sys?.linkType === 'Asset') {
    assetIds.add(value.sys.id);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => walkFieldsForAssets(item, assetIds));
    return;
  }

  for (const v of Object.values(value)) {
    walkFieldsForAssets(v, assetIds);
  }
}
