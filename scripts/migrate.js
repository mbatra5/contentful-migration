import { getEnvironment, getSpaceConfig, parseArgs, getCdaToken } from './lib/client.js';
import { walkEntryTree } from './lib/walker.js';
import { fetchAllowedLocales } from './lib/mapper.js';
import { loadGlobalRemap, saveGlobalRemap, loadAssetRemap, saveAssetRemap } from './lib/catalog.js';
import { createEntryShells, linkReferences, publishEntries } from './lib/two-pass.js';
import { migrateAssets } from './lib/assets.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.entry) {
    console.error('Usage: npm run migrate -- --entry <entry-id> [options]');
    console.error('\nDirect source-to-target migration (no local storage step).');
    console.error('\nRequired:');
    console.error('  --entry       Root entry ID to migrate');
    console.error('\nOptions:');
    console.error('  --source      Source space alias (default: source)');
    console.error('  --target      Target space alias (default: target)');
    console.error('  --depth       Max traversal depth (default: 1)');
    console.error('                  0 = root entry only');
    console.error('                  1 = root + direct children');
    console.error('  --skip-types  Comma-separated content types to skip (default: page)');
    console.error('  --no-skip     Traverse all content types');
    console.error('  --publish     Auto-publish entries after creation');
    console.error('  --force       Ignore remap — create new even if previously migrated');
    console.error('  --with-assets Migrate referenced assets from source to target');
    console.error('  --dry-run     Show what would be migrated without writing');
    process.exit(1);
  }

  const sourceAlias = args.source || 'source';
  const targetAlias = args.target || 'target';
  const rootEntryId = args.entry;
  const shouldPublish = args.publish === true;
  const forceCreate = args.force === true;
  const withAssets = args['with-assets'] === true;
  const dryRun = args['dry-run'] === true;

  const maxDepth = args.depth !== undefined ? parseInt(args.depth, 10) : 1;
  if (args.depth !== undefined && (isNaN(maxDepth) || maxDepth < 0)) {
    console.error('Error: --depth must be 0 or a positive integer.');
    process.exit(1);
  }

  const DEFAULT_SKIP_TYPES = ['page'];
  let skipTypes;
  if (args['no-skip']) {
    skipTypes = [];
  } else if (args['skip-types']) {
    skipTypes = args['skip-types'].split(',').map(t => t.trim()).filter(Boolean);
  } else {
    skipTypes = DEFAULT_SKIP_TYPES;
  }

  const sourceConfig = getSpaceConfig(sourceAlias);
  const targetConfig = getSpaceConfig(targetAlias);

  console.log(`\nContentful Migrator — Direct Migrate`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Source:      ${sourceAlias} (${sourceConfig.spaceId} / ${sourceConfig.environmentId})`);
  console.log(`Target:      ${targetAlias} (${targetConfig.spaceId} / ${targetConfig.environmentId})`);
  console.log(`Root Entry:  ${rootEntryId}`);
  console.log(`Max depth:   ${maxDepth}`);
  console.log(`Skip types:  ${skipTypes.length > 0 ? skipTypes.join(', ') : '(none)'}`);
  console.log(`Mode:        ${forceCreate ? 'FORCE' : 'DEFAULT'}${dryRun ? ' (DRY RUN)' : ''}`);
  if (withAssets) console.log(`Assets:      YES`);
  if (shouldPublish) console.log(`Publish:     YES`);

  // Step 1: Connect to source and walk
  console.log(`\nConnecting to source...`);
  const sourceEnv = await getEnvironment(sourceAlias);

  console.log(`Walking entry tree from ${rootEntryId}...\n`);
  const { entryData, assetIds, dependencyOrder, skipped, depthCapped } = await walkEntryTree(
    sourceEnv, rootEntryId,
    {
      skipTypes,
      maxDepth,
      onProgress(processed, remaining) {
        process.stdout.write(`\r  Processed: ${processed} entries | Queue: ${remaining} remaining`);
      },
    }
  );

  const entryCount = Object.keys(entryData).length;
  const rootTitle = entryData[rootEntryId]?.title || rootEntryId;

  console.log(`\n\n  Root:      ${rootTitle}`);
  console.log(`  Entries:   ${entryCount}`);
  if (assetIds.length > 0) console.log(`  Assets:    ${assetIds.length}`);
  if (skipped.size > 0) console.log(`  Skipped (type):  ${skipped.size}`);
  if (depthCapped.size > 0) console.log(`  Skipped (depth): ${depthCapped.size}`);

  if (entryCount === 0) {
    console.log('\nNo entries found. Nothing to migrate.\n');
    return;
  }

  const globalRemap = loadGlobalRemap(STORE_DIR);
  const assetRemap = loadAssetRemap(STORE_DIR);

  const entriesToCreate = forceCreate
    ? dependencyOrder
    : dependencyOrder.filter(id => !globalRemap[id]);

  const skippedRemap = dependencyOrder.length - entriesToCreate.length;
  if (skippedRemap > 0 && !forceCreate) {
    console.log(`  Dedup:     ${skippedRemap} already in remap (use --force to override)`);
  }

  if (entriesToCreate.length === 0) {
    console.log('\nAll entries already migrated. Use --force to create new copies.\n');
    return;
  }

  console.log(`  To create: ${entriesToCreate.length}\n`);

  if (dryRun) {
    console.log('Dry run — entries that would be migrated:\n');
    for (const entryId of entriesToCreate) {
      const data = entryData[entryId];
      const prevId = globalRemap[entryId] ? ` (was ${globalRemap[entryId]})` : '';
      console.log(`  ${entryId}  [${data.contentType}]  ${data.title || '(untitled)'}${prevId}`);
    }
    if (withAssets && assetIds.length > 0) {
      console.log(`\n  Assets to migrate: ${assetIds.length}`);
    }
    console.log(`\nTotal: ${entriesToCreate.length} entries. No changes made.\n`);
    return;
  }

  // Step 2: Connect to target
  console.log(`Connecting to target...`);
  const targetEnv = await getEnvironment(targetAlias);

  const allowedLocales = await fetchAllowedLocales(targetEnv);
  console.log(`Target locales: ${[...allowedLocales].join(', ')}\n`);

  // Step 3: Migrate assets (if requested)
  if (withAssets && assetIds.length > 0) {
    console.log(`Migrating ${assetIds.length} referenced assets...\n`);
    const cdaToken = getCdaToken(sourceAlias);
    const result = await migrateAssets(sourceEnv, targetEnv, assetIds, assetRemap, { allowedLocales, cdaToken });
    saveAssetRemap(STORE_DIR, assetRemap);
    console.log(`\nAssets: ${result.migrated} created, ${result.reused} reused, ${result.failed} failed\n`);
  }

  // Step 4: Two-pass entry creation
  const entries = entriesToCreate.map(id => ({
    id,
    contentType: entryData[id].contentType,
    title: entryData[id].title,
    fields: entryData[id].fields,
    entryRefs: entryData[id].entryRefs,
  }));

  console.log(`Pass 1: Creating ${entries.length} entry shells...\n`);
  await createEntryShells(targetEnv, entries, globalRemap, { allowedLocales, forceCreate, assetRemap });
  await linkReferences(targetEnv, entries, globalRemap, { allowedLocales, shouldPublish, assetRemap });
  if (shouldPublish) await publishEntries(targetEnv, entries, globalRemap);

  // Save remap
  saveGlobalRemap(STORE_DIR, globalRemap);
  if (withAssets) saveAssetRemap(STORE_DIR, assetRemap);
  const created = entriesToCreate.filter(id => globalRemap[id]).length;
  console.log(`\nMigration complete. ${created} entries created.`);
  console.log(`Saved remap to store/remap.json (${Object.keys(globalRemap).length} total mappings)\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
