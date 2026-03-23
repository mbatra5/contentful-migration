import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { RATE_LIMIT_DELAY, sleep, getEntryTitle } from './lib/helpers.js';
import { resolveScope } from './lib/scope.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.spec) {
    console.error('Usage: npm run transform -- --spec <path-to-spec.json> [--dry-run]');
    console.error('\nThe spec file defines scope (which entries) and transforms (what to change).');
    console.error('See USAGE.md for spec format and examples.');
    console.error('\nOptions:');
    console.error('  --spec      Path to transform spec JSON file (required)');
    console.error('  --dry-run   Preview changes without writing to Contentful');
    console.error('  --publish   Auto-publish entries after update');
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
  const spaceAlias = spec.space || 'source';

  if (!spec.transforms || spec.transforms.length === 0) {
    console.error('Error: Spec must include at least one transform.');
    process.exit(1);
  }

  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Migrator — Transform`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:       ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Spec:        ${args.spec}`);
  console.log(`Transforms:  ${spec.transforms.length}`);
  console.log(`Mode:        ${dryRun ? 'DRY RUN' : 'LIVE'}${shouldPublish ? ' + PUBLISH' : ''}`);
  if (spec.scope?.filters) {
    const f = spec.scope.filters;
    const parts = [];
    if (f.draft) parts.push('draft only');
    if (f.published) parts.push('published only');
    if (f.updatedBy) parts.push(`updatedBy: ${f.updatedBy}`);
    if (f.createdBy) parts.push(`createdBy: ${f.createdBy}`);
    if (f.excludeArchived === false) parts.push('include archived');
    if (parts.length > 0) console.log(`Filters:     ${parts.join(', ')}`);
  }

  const environment = await getEnvironment(spaceAlias);
  console.log(`Connected.\n`);

  const entryIds = await resolveScope(spec.scope, { environment, storeDir: STORE_DIR, spaceAlias });
  console.log(`Resolved ${entryIds.length} entries.\n`);

  if (entryIds.length === 0) {
    console.log('No entries matched the scope. Nothing to do.\n');
    return;
  }

  for (const t of spec.transforms) {
    const fieldLabel = t.field ? `field "${t.field}"` : 'all fields';
    console.log(`  Transform: ${t.rule} ${fieldLabel} — ${t.sourceLocale || '*'} → ${t.targetLocale || '*'}${t.suffix ? ` + suffix "${t.suffix}"` : ''}${t.prefix ? ` + prefix "${t.prefix}"` : ''}${t.value !== undefined ? ` = "${t.value}"` : ''}`);
  }
  console.log();

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

    if (spec.scope.contentType && contentType !== spec.scope.contentType) {
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    const changedFields = [];
    for (const transform of spec.transforms) {
      const changed = applyTransform(entry.fields, transform);
      changedFields.push(...changed);
    }

    if (changedFields.length === 0) {
      console.log(`  ${label} ${contentType}: ${title} — no changes`);
      skipped++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    if (dryRun) {
      console.log(`  ${label} ${contentType}: ${title} — WOULD UPDATE: ${changedFields.join(', ')}`);
      updated++;
      await sleep(RATE_LIMIT_DELAY);
      continue;
    }

    process.stdout.write(`  ${label} ${contentType}: ${title} — ${changedFields.join(', ')}...`);

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

  console.log(`\nTransform complete.`);
  console.log(`  ${dryRun ? 'Would update' : 'Updated'}: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  if (failed > 0) console.log(`  Failed:  ${failed}`);
  console.log();
}

function applyTransform(fields, transform) {
  const changed = [];
  const { rule, field: targetField, sourceLocale, targetLocale, suffix, prefix, value, replace } = transform;

  const fieldsToProcess = targetField
    ? (fields[targetField] ? [[targetField, fields[targetField]]] : [])
    : Object.entries(fields);

  for (const [fieldName, localeMap] of fieldsToProcess) {
    if (typeof localeMap !== 'object' || localeMap === null) continue;

    switch (rule) {
      case 'copy': {
        if (!sourceLocale || !targetLocale) break;
        if (!(sourceLocale in localeMap)) break;
        const val = structuredClone(localeMap[sourceLocale]);
        localeMap[targetLocale] = applyStringTransforms(val, { suffix, prefix, replace });
        changed.push(fieldName);
        break;
      }

      case 'set': {
        if (!targetLocale || value === undefined) break;
        localeMap[targetLocale] = value;
        changed.push(fieldName);
        break;
      }

      case 'delete': {
        if (!targetLocale) break;
        if (targetLocale in localeMap) {
          delete localeMap[targetLocale];
          changed.push(fieldName);
        }
        break;
      }

      case 'rename-locale': {
        if (!sourceLocale || !targetLocale) break;
        if (sourceLocale in localeMap) {
          localeMap[targetLocale] = localeMap[sourceLocale];
          delete localeMap[sourceLocale];
          changed.push(fieldName);
        }
        break;
      }

      case 'modify': {
        if (!targetLocale) break;
        if (!(targetLocale in localeMap)) break;
        localeMap[targetLocale] = applyStringTransforms(localeMap[targetLocale], { suffix, prefix, replace });
        changed.push(fieldName);
        break;
      }

      default:
        console.warn(`  Warning: Unknown transform rule "${rule}"`);
    }
  }

  return changed;
}

function applyStringTransforms(val, { suffix, prefix, replace } = {}) {
  if (typeof val !== 'string') return val;
  let result = val;
  if (replace) {
    result = result.replace(new RegExp(replace.from, 'g'), replace.to);
  }
  if (prefix) result = prefix + result;
  if (suffix) result = result + suffix;
  return result;
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
