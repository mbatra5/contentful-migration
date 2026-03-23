import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { RATE_LIMIT_DELAY, sleep, getEntryTitle } from './lib/helpers.js';
import { scopeFromArgs } from './lib/scope.js';
import { findEntryInCatalog } from './lib/catalog.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');
const ENTRIES_DIR = resolve(STORE_DIR, 'entries');
const EXTRACTIONS_DIR = resolve(STORE_DIR, 'extractions');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.from || !args.to) {
    console.error('Usage:');
    console.error('  npm run locale -- --from <locale> --to <locale> --name <extraction> [options]');
    console.error('  npm run locale -- --from <locale> --to <locale> --type <contentType> [options]');
    console.error('  npm run locale -- --from <locale> --to <locale> --entries <id1,id2> [options]');
    console.error('\nRequired:');
    console.error('  --from       Source locale code (e.g. en, en-US)');
    console.error('  --to         Target locale code to create/overwrite (e.g. en-IN)');
    console.error('\nScope (pick one):');
    console.error('  --name       Update all entries in an extraction');
    console.error('  --type       Update all entries of a content type in the catalog');
    console.error('  --entries    Comma-separated entry IDs');
    console.error('  --all        Update every entry in the catalog');
    console.error('\nOptions:');
    console.error('  --space      Space alias from config/spaces.json (default: source)');
    console.error('  --overwrite  Overwrite target locale even if it already has a value');
    console.error('  --publish    Auto-publish entries after update');
    console.error('  --dry-run    Preview changes without writing to Contentful');
    console.error('\nExamples:');
    console.error('  npm run locale -- --from en --to en-IN --name qa-bento-cards');
    console.error('  npm run locale -- --from en --to en-IN --type richTextEditor --overwrite');
    console.error('  npm run locale -- --from en-US --to en-IN --entries abc123,def456 --publish');
    process.exit(1);
  }

  const fromLocale = args.from;
  const toLocale = args.to;
  const spaceAlias = args.space || 'source';
  const shouldOverwrite = args.overwrite === true;
  const shouldPublish = args.publish === true;
  const dryRun = args['dry-run'] === true;

  if (fromLocale === toLocale) {
    console.error('Error: --from and --to locales must be different.');
    process.exit(1);
  }

  const entryIds = resolveEntryIds(args);

  if (entryIds.length === 0) {
    console.error('Error: No entries matched. Provide --name, --type, --entries, or --all.');
    process.exit(1);
  }

  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Migrator — Locale Update`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:       ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Copy:        ${fromLocale} → ${toLocale}`);
  console.log(`Overwrite:   ${shouldOverwrite ? 'YES (replaces existing)' : 'NO (skip if target locale exists)'}`);
  console.log(`Entries:     ${entryIds.length}`);
  console.log(`Mode:        ${dryRun ? 'DRY RUN' : 'LIVE'}${shouldPublish ? ' + PUBLISH' : ''}\n`);

  if (dryRun) {
    dryRunPreview(entryIds, fromLocale, toLocale, shouldOverwrite);
    return;
  }

  const environment = await getEnvironment(spaceAlias);
  console.log(`Connected.\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < entryIds.length; i++) {
    const entryId = entryIds[i];
    const label = `[${i + 1}/${entryIds.length}]`;

    let entry;
    try {
      entry = await environment.getEntry(entryId);
    } catch (err) {
      console.log(`  ${label} ${entryId} — FETCH FAILED: ${err.message}`);
      failed++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    const contentType = entry.sys.contentType.sys.id;
    const title = getEntryTitle(entry.fields) || entryId;
    const { fieldsChanged, fieldsSkipped } = copyLocaleFields(entry.fields, fromLocale, toLocale, shouldOverwrite);

    if (fieldsChanged === 0) {
      console.log(`  ${label} ${contentType}: ${title} — skipped (${fieldsSkipped > 0 ? `${fieldsSkipped} fields already have ${toLocale}` : `no ${fromLocale} fields`})`);
      skipped++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    process.stdout.write(`  ${label} ${contentType}: ${title} — ${fieldsChanged} fields...`);

    try {
      await entry.update();
      console.log(` done`);

      if (shouldPublish) {
        const fresh = await environment.getEntry(entryId);
        await fresh.publish();
      }

      updated++;
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      failed++;
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  console.log(`\nLocale update complete.`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  if (failed > 0) console.log(`  Failed:  ${failed}`);
  console.log();
}

function resolveEntryIds(args) {
  if (args.entries) {
    return args.entries.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (args.name) {
    const manifestPath = resolve(EXTRACTIONS_DIR, `${args.name}.json`);
    if (!existsSync(manifestPath)) {
      console.error(`Error: Extraction "${args.name}" not found.`);
      process.exit(1);
    }
    const extraction = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return Object.keys(extraction.entries);
  }

  if (args.type) {
    const typeDir = resolve(ENTRIES_DIR, args.type);
    if (!existsSync(typeDir)) {
      console.error(`Error: Content type "${args.type}" not found in catalog.`);
      if (existsSync(ENTRIES_DIR)) {
        const available = readdirSync(ENTRIES_DIR).filter(n => statSync(resolve(ENTRIES_DIR, n)).isDirectory());
        console.error('Available:', available.join(', '));
      }
      process.exit(1);
    }
    return readdirSync(typeDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  }

  if (args.all) {
    if (!existsSync(ENTRIES_DIR)) return [];
    const ids = [];
    const types = readdirSync(ENTRIES_DIR).filter(n => statSync(resolve(ENTRIES_DIR, n)).isDirectory());
    for (const type of types) {
      const files = readdirSync(resolve(ENTRIES_DIR, type)).filter(f => f.endsWith('.json'));
      for (const f of files) ids.push(f.replace('.json', ''));
    }
    return ids;
  }

  return [];
}

function copyLocaleFields(fields, fromLocale, toLocale, overwrite) {
  let fieldsChanged = 0;
  let fieldsSkipped = 0;

  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (typeof localeMap !== 'object' || localeMap === null) continue;
    if (!(fromLocale in localeMap)) continue;

    if (toLocale in localeMap && !overwrite) {
      fieldsSkipped++;
      continue;
    }

    localeMap[toLocale] = structuredClone(localeMap[fromLocale]);
    fieldsChanged++;
  }

  return { fieldsChanged, fieldsSkipped };
}

function dryRunPreview(entryIds, fromLocale, toLocale, overwrite) {
  console.log('Dry run — preview of entries that would be updated:\n');

  for (const entryId of entryIds) {
    const entryData = findEntryInStore(entryId);
    if (!entryData) {
      console.log(`  ${entryId}  (not in local store — will be fetched live)`);
      continue;
    }

    const fields = entryData.fields;
    let wouldChange = 0;
    let wouldSkip = 0;
    const changedFields = [];

    for (const [fieldName, localeMap] of Object.entries(fields)) {
      if (typeof localeMap !== 'object' || localeMap === null) continue;
      if (!(fromLocale in localeMap)) continue;
      if (toLocale in localeMap && !overwrite) {
        wouldSkip++;
        continue;
      }
      wouldChange++;
      changedFields.push(fieldName);
    }

    const status = wouldChange > 0
      ? `WOULD UPDATE ${wouldChange} fields (${changedFields.join(', ')})`
      : `skip (${wouldSkip > 0 ? `already has ${toLocale}` : `no ${fromLocale}`})`;
    console.log(`  ${entryId}  [${entryData.contentType}]  ${entryData.title || '(untitled)'}  — ${status}`);
  }

  console.log(`\nTotal: ${entryIds.length} entries. No changes made.\n`);
}

function findEntryInStore(entryId) {
  if (!existsSync(ENTRIES_DIR)) return null;
  const types = readdirSync(ENTRIES_DIR).filter(n => statSync(resolve(ENTRIES_DIR, n)).isDirectory());
  for (const type of types) {
    const filePath = resolve(ENTRIES_DIR, type, `${entryId}.json`);
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  }
  return null;
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
