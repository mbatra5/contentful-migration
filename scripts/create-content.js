import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { filterLocales, fetchAllowedLocales } from './lib/mapper.js';
import { RATE_LIMIT_DELAY, sleep } from './lib/helpers.js';
import { loadSchemas, loadDefaults, applyDefaults, validateSpec } from './lib/schema.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.spec) {
    printUsage();
    process.exit(1);
  }

  const specPath = resolve(process.cwd(), args.spec);
  if (!existsSync(specPath)) {
    console.error(`Error: Spec file not found: ${specPath}`);
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
  const dryRun = args['dry-run'] === true || spec.dryRun === true;
  const shouldPublish = args.publish === true || spec.publish === true;
  const spaceAlias = args.space || spec.space || 'target';
  const defaultLocale = spec.locale || 'en';

  if (!spec.entries || spec.entries.length === 0) {
    console.error('Error: Spec must include at least one entry in the "entries" array.');
    process.exit(1);
  }

  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Migrator — Create Content`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:       ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Spec:        ${args.spec}`);
  console.log(`Locale:      ${defaultLocale}`);
  console.log(`Entries:     ${spec.entries.length}`);
  console.log(`Mode:        ${dryRun ? 'DRY RUN' : 'LIVE'}${shouldPublish ? ' + PUBLISH' : ''}\n`);

  const schemas = loadSchemas();
  const defaults = loadDefaults();

  if (schemas) {
    console.log(`Schemas:     ${Object.keys(schemas).length} content types loaded`);
  } else {
    console.log(`Schemas:     Not cached (will skip validation). Run: npm run generate-schemas`);
  }
  if (defaults) {
    console.log(`Defaults:    Loaded (config/content-defaults.json)`);
  }

  const pageName = spec.pageName || null;
  if (defaults) {
    applyDefaults(spec.entries, defaults, defaultLocale, pageName);
  }

  const environment = await getEnvironment(spaceAlias);
  console.log(`Connected.\n`);

  const allowedLocales = await fetchAllowedLocales(environment);
  console.log(`Locales:     ${[...allowedLocales].join(', ')}\n`);

  const warnings = validateSpec(spec.entries, schemas, defaults);
  if (warnings.length > 0) {
    console.log(`Validation warnings:`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    console.log();
  }

  // Pre-resolve all lookup: references
  const lookupCache = {};
  const lookups = collectLookups(spec.entries);
  if (lookups.length > 0) {
    console.log(`Resolving ${lookups.length} lookup references...\n`);
    for (const { contentType, name } of lookups) {
      const key = `lookup:${contentType}:${name}`;
      if (lookupCache[key]) continue;

      process.stdout.write(`  Looking up ${contentType}: "${name}"...`);
      try {
        const result = await environment.getEntries({
          content_type: contentType,
          'fields.entryName[match]': name,
          limit: 1,
        });

        if (result.items.length === 0) {
          for (const field of ['title', 'name', 'internalName']) {
            const fallback = await environment.getEntries({
              content_type: contentType,
              [`fields.${field}[match]`]: name,
              limit: 1,
            });
            if (fallback.items.length > 0) {
              lookupCache[key] = fallback.items[0].sys.id;
              console.log(` found: ${lookupCache[key]} (via ${field})`);
              break;
            }
            await sleep(RATE_LIMIT_DELAY);
          }

          if (!lookupCache[key]) {
            console.log(` NOT FOUND`);
          }
        } else {
          lookupCache[key] = result.items[0].sys.id;
          console.log(` found: ${lookupCache[key]}`);
        }
      } catch (err) {
        console.log(` FAILED: ${err.message}`);
      }
      await sleep(RATE_LIMIT_DELAY);
    }
    console.log();
  }

  const newEntries = spec.entries.filter(e => e.id);

  if (dryRun) {
    printDryRun(newEntries, lookupCache, schemas, defaults);
    return;
  }

  // Pass 1: Create shell entries (non-reference fields only)
  const idMap = {};

  console.log(`Pass 1: Creating ${newEntries.length} entries (non-reference fields)...\n`);

  for (let i = 0; i < newEntries.length; i++) {
    const entry = newEntries[i];
    const label = `[${i + 1}/${newEntries.length}]`;
    const entryName = entry.fields?.entryName || entry.id;

    const fields = buildFieldsForCreate(entry.fields, defaultLocale, allowedLocales, {
      stripRefs: true, idMap, lookupCache,
    });

    if (entry.template) {
      const templateFields = await fetchTemplateFields(environment, entry.template, entry.overrides, defaultLocale, allowedLocales);
      if (templateFields) Object.assign(fields, templateFields);
    }

    process.stdout.write(`  ${label} ${entry.contentType}: ${entryName}...`);

    try {
      const newEntry = await environment.createEntry(entry.contentType, { fields });
      idMap[entry.id] = newEntry.sys.id;
      console.log(` -> ${newEntry.sys.id}`);
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      if (err.details?.errors) {
        for (const e of err.details.errors) {
          console.log(`    Field: ${e.name} — ${e.details || e.value || ''}`);
        }
      }
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  // Pass 2: Wire all references
  const entriesWithRefs = newEntries.filter(e => hasReferences(e.fields));

  if (entriesWithRefs.length > 0) {
    console.log(`\nPass 2: Linking references for ${entriesWithRefs.length} entries...\n`);

    for (let i = 0; i < entriesWithRefs.length; i++) {
      const entry = entriesWithRefs[i];
      const targetId = idMap[entry.id];
      if (!targetId) continue;

      const label = `[${i + 1}/${entriesWithRefs.length}]`;
      const entryName = entry.fields?.entryName || entry.id;

      const fullFields = buildFieldsForCreate(entry.fields, defaultLocale, allowedLocales, {
        stripRefs: false, idMap, lookupCache,
      });

      if (entry.template) {
        const templateFields = await fetchTemplateFields(environment, entry.template, entry.overrides, defaultLocale, allowedLocales);
        if (templateFields) {
          for (const [k, v] of Object.entries(templateFields)) {
            if (!fullFields[k]) fullFields[k] = v;
          }
        }
      }

      process.stdout.write(`  ${label} ${entry.contentType}: ${entryName}...`);

      try {
        const targetEntry = await environment.getEntry(targetId);
        targetEntry.fields = fullFields;
        await targetEntry.update();
        console.log(` done`);

        if (shouldPublish) {
          const fresh = await environment.getEntry(targetId);
          await fresh.publish();
        }
      } catch (err) {
        console.log(` FAILED: ${err.message}`);
      }

      await sleep(RATE_LIMIT_DELAY);
    }
  }

  if (shouldPublish) {
    const noRefEntries = newEntries.filter(e => !hasReferences(e.fields) && idMap[e.id]);
    if (noRefEntries.length > 0) {
      console.log(`\nPublishing ${noRefEntries.length} entries without references...\n`);
      for (const entry of noRefEntries) {
        try {
          const e = await environment.getEntry(idMap[entry.id]);
          await e.publish();
        } catch (err) {
          console.log(`  Warning: Could not publish ${idMap[entry.id]}: ${err.message}`);
        }
        await sleep(RATE_LIMIT_DELAY);
      }
    }
  }

  const created = Object.keys(idMap).length;
  console.log(`\nContent creation complete. ${created}/${newEntries.length} entries created.\n`);

  if (created > 0) {
    console.log(`Entry ID mapping:`);
    for (const [localId, contentfulId] of Object.entries(idMap)) {
      const entry = newEntries.find(e => e.id === localId);
      console.log(`  ${localId} → ${contentfulId}  (${entry?.contentType})`);
    }
    console.log();
  }
}

// ── Field building ──

function buildFieldsForCreate(specFields, defaultLocale, allowedLocales, { stripRefs, idMap, lookupCache }) {
  if (!specFields) return {};

  const fields = {};
  for (const [fieldName, value] of Object.entries(specFields)) {
    if (isAlreadyLocaleWrapped(value)) {
      const processed = {};
      for (const [locale, localeVal] of Object.entries(value)) {
        const resolved = resolveFieldValue(localeVal, stripRefs, idMap, lookupCache);
        if (resolved !== undefined) processed[locale] = resolved;
      }
      if (Object.keys(processed).length > 0) fields[fieldName] = processed;
    } else {
      const resolved = resolveFieldValue(value, stripRefs, idMap, lookupCache);
      if (resolved !== undefined) fields[fieldName] = { [defaultLocale]: resolved };
    }
  }

  return filterLocales(fields, allowedLocales);
}

function isAlreadyLocaleWrapped(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(k => /^[a-z]{2}(-[A-Z]{2})?$/.test(k));
}

function resolveFieldValue(value, stripRefs, idMap, lookupCache) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string' && value.startsWith('@')) {
    if (stripRefs) return undefined;
    const contentfulId = idMap[value.slice(1)];
    return contentfulId ? { sys: { type: 'Link', linkType: 'Entry', id: contentfulId } } : undefined;
  }

  if (typeof value === 'string' && value.startsWith('existing:')) {
    return { sys: { type: 'Link', linkType: 'Entry', id: value.slice('existing:'.length) } };
  }

  if (typeof value === 'string' && value.startsWith('lookup:')) {
    const contentfulId = lookupCache[value];
    return contentfulId ? { sys: { type: 'Link', linkType: 'Entry', id: contentfulId } } : undefined;
  }

  if (typeof value === 'string' && value.startsWith('asset:')) {
    return { sys: { type: 'Link', linkType: 'Asset', id: value.slice('asset:'.length) } };
  }

  if (Array.isArray(value)) {
    const resolved = value.map(item => resolveFieldValue(item, stripRefs, idMap, lookupCache)).filter(item => item !== undefined);
    return resolved.length > 0 ? resolved : undefined;
  }

  return value;
}

function hasReferences(fields) {
  if (!fields) return false;
  const s = JSON.stringify(fields);
  return s.includes('"@') || s.includes('"lookup:') || s.includes('"existing:');
}

// ── Template handling ──

async function fetchTemplateFields(environment, templateId, overrides, defaultLocale, allowedLocales) {
  try {
    const entry = await environment.getEntry(templateId);
    const fields = { ...entry.fields };

    if (overrides) {
      for (const [fieldName, value] of Object.entries(overrides)) {
        fields[fieldName] = isAlreadyLocaleWrapped(value) ? value : { [defaultLocale]: value };
      }
    }

    return filterLocales(fields, allowedLocales);
  } catch (err) {
    console.log(`\n  Warning: Template ${templateId} fetch failed: ${err.message}`);
    return null;
  }
}

// ── Lookup collection ──

function collectLookups(entries) {
  const lookups = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.fields) continue;
    const jsonStr = JSON.stringify(entry.fields);
    const matches = jsonStr.matchAll(/"lookup:([^:]+):([^"]+)"/g);
    for (const m of matches) {
      const key = `lookup:${m[1]}:${m[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        lookups.push({ contentType: m[1], name: m[2] });
      }
    }
  }

  return lookups;
}

// ── Dry run ──

function printDryRun(entries, lookupCache, schemas, defaults) {
  console.log('Dry run — entries that would be created:\n');

  for (const entry of entries) {
    const entryName = entry.fields?.entryName || entry.id;
    const schema = schemas?.[entry.contentType];
    const fieldCount = entry.fields ? Object.keys(entry.fields).length : 0;
    const schemaFieldCount = schema ? Object.keys(schema.fields).length : '?';
    const hasTemplate = entry.template ? ` (template: ${entry.template})` : '';

    console.log(`  ${entry.id}  [${entry.contentType}]  "${entryName}"  ${fieldCount}/${schemaFieldCount} fields${hasTemplate}`);

    if (entry.fields) {
      const ctDefaults = defaults?.[entry.contentType]?.defaults || {};
      for (const [fieldName, value] of Object.entries(entry.fields)) {
        const display = formatValue(value, lookupCache);
        const isDefault = fieldName in ctDefaults && ctDefaults[fieldName] === value ? ' (default)' : '';
        console.log(`    ${fieldName}: ${display}${isDefault}`);
      }
    }
    console.log();
  }

  console.log(`Total: ${entries.length} entries. No changes made.\n`);
}

function formatValue(value, lookupCache) {
  if (typeof value === 'string') {
    if (value.startsWith('@')) return `→ @${value.slice(1)} (new entry)`;
    if (value.startsWith('existing:')) return `→ ${value.slice('existing:'.length)} (existing)`;
    if (value.startsWith('lookup:')) {
      const resolved = lookupCache[value];
      return resolved ? `→ ${resolved} (lookup)` : `→ UNRESOLVED (lookup)`;
    }
    if (value.startsWith('asset:')) return `→ asset ${value.slice('asset:'.length)}`;
    return `"${value.length > 60 ? value.slice(0, 57) + '...' : value}"`;
  }
  if (Array.isArray(value)) return `[${value.map(v => formatValue(v, lookupCache)).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    if (value.nodeType === 'document') return '[Rich Text]';
    return JSON.stringify(value).slice(0, 80);
  }
  return String(value);
}

function printUsage() {
  console.error('Usage: npm run create-content -- --spec <path-to-spec.json> [options]');
  console.error('\nCreates new Contentful entries from a content spec JSON file.');
  console.error('The spec defines entries to create and how they reference each other.\n');
  console.error('Options:');
  console.error('  --spec      Path to content spec JSON file (required)');
  console.error('  --space     Target space alias (overrides spec.space, default: target)');
  console.error('  --publish   Auto-publish entries after creation');
  console.error('  --dry-run   Preview what would be created\n');
  console.error('Reference types in field values:');
  console.error('  @localId              Link to a new entry defined in the same spec');
  console.error('  existing:<id>         Link to an existing Contentful entry by ID');
  console.error('  lookup:<type>:<name>  Live-search Contentful for an entry by name');
  console.error('  asset:<id>            Link to an existing Contentful asset\n');
  console.error('See USAGE.md for full spec format and examples.');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
