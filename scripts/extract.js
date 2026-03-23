import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { walkEntryTree } from './lib/walker.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rebuildGlobalCsv } from './lib/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');
const ENTRIES_DIR = resolve(STORE_DIR, 'entries');
const EXTRACTIONS_DIR = resolve(STORE_DIR, 'extractions');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.entry) {
    console.error('Usage: npm run extract -- --entry <entry-id> [options]');
    console.error('\nOptions:');
    console.error('  --entry       Root entry ID to extract (required)');
    console.error('  --name        Name for this extraction (auto-detected from entry title if omitted)');
    console.error('  --space       Space alias from config/spaces.json (default: source)');
    console.error('  --depth       Max depth of reference traversal (default: unlimited)');
    console.error('                  0 = root entry only (no linked entries)');
    console.error('                  1 = root + direct children only');
    console.error('                  2 = root + children + grandchildren, etc.');
    console.error('  --skip-types  Comma-separated content types to skip traversal into (default: page)');
    console.error('  --no-skip     Disable default skip behavior and traverse everything');
    process.exit(1);
  }

  const spaceAlias = args.space || 'source';
  const rootEntryId = args.entry;

  const DEFAULT_SKIP_TYPES = ['page'];
  let skipTypes;
  if (args['no-skip']) {
    skipTypes = [];
  } else if (args['skip-types']) {
    skipTypes = args['skip-types'].split(',').map(t => t.trim()).filter(Boolean);
  } else {
    skipTypes = DEFAULT_SKIP_TYPES;
  }

  const maxDepth = args.depth !== undefined ? parseInt(args.depth, 10) : Infinity;
  if (args.depth !== undefined && (isNaN(maxDepth) || maxDepth < 0)) {
    console.error('Error: --depth must be 0 or a positive integer (0 = root only, 1 = root + direct children).');
    process.exit(1);
  }

  const spaceConfig = getSpaceConfig(spaceAlias);
  const environment = await getEnvironment(spaceAlias);

  console.log(`\nContentful Migrator — Extract`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:       ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Root Entry:  ${rootEntryId}`);
  console.log(`Max depth:   ${maxDepth === Infinity ? 'unlimited' : maxDepth}`);
  console.log(`Skip types:  ${skipTypes.length > 0 ? skipTypes.join(', ') : '(none — traverse everything)'}\n`);

  console.log(`Connected. Walking entry tree from ${rootEntryId}...\n`);

  const { graph, entryData, assetIds, dependencyOrder, skipped, depthCapped } = await walkEntryTree(
    environment,
    rootEntryId,
    {
      skipTypes,
      maxDepth,
      onProgress(processed, remaining) {
        process.stdout.write(`\r  Processed: ${processed} entries | Queue: ${remaining} remaining`);
      },
    }
  );

  const rootTitle = entryData[rootEntryId]?.title || rootEntryId;
  const extractionName = args.name || slugify(rootTitle);

  console.log(`\n\n  Extraction name: ${extractionName} (from: "${rootTitle}")`);
  console.log(`  Total entries found: ${Object.keys(entryData).length}`);
  console.log(`  Total asset references: ${assetIds.length}`);
  console.log(`  Dependency order: ${dependencyOrder.length} entries`);

  if (skipped.size > 0) {
    console.log(`  Skipped (type):    ${skipped.size} (nav links to: ${[...new Set(skipped.values())].join(', ')})`);
    for (const [id, ct] of skipped) {
      console.log(`    ↳ ${id} (${ct})`);
    }
  }

  if (depthCapped.size > 0) {
    console.log(`  Skipped (depth):   ${depthCapped.size} entries beyond depth ${maxDepth}`);
    for (const [id, d] of depthCapped) {
      console.log(`    ↳ ${id} (would be depth ${d})`);
    }
  }
  console.log();

  mkdirSync(ENTRIES_DIR, { recursive: true });
  mkdirSync(EXTRACTIONS_DIR, { recursive: true });

  let newCount = 0;
  let skipCount = 0;

  for (const [entryId, data] of Object.entries(entryData)) {
    const typeDir = resolve(ENTRIES_DIR, data.contentType);
    mkdirSync(typeDir, { recursive: true });

    const entryPath = resolve(typeDir, `${entryId}.json`);
    if (existsSync(entryPath)) {
      skipCount++;
    } else {
      newCount++;
    }
    // Always write (updates stale data from re-extractions)
    writeFileSync(entryPath, JSON.stringify(data, null, 2));
  }

  console.log(`  Wrote entries: ${newCount} new, ${skipCount} updated`);
  console.log(`  Location: store/entries/{contentType}/{id}.json`);

  const extraction = {
    name: extractionName,
    source: {
      spaceId: spaceConfig.spaceId,
      environmentId: spaceConfig.environmentId,
      spaceAlias,
    },
    rootEntryId,
    rootTitle,
    extractedAt: new Date().toISOString(),
    totalEntries: Object.keys(entryData).length,
    totalAssetRefs: assetIds.length,
    entries: {},
    assetIds,
    dependencyOrder,
  };

  for (const [entryId, data] of Object.entries(entryData)) {
    extraction.entries[entryId] = {
      contentType: data.contentType,
      title: data.title,
      entryRefs: data.entryRefs,
      assetRefs: data.assetRefs,
    };
  }

  writeFileSync(
    resolve(EXTRACTIONS_DIR, `${extractionName}.json`),
    JSON.stringify(extraction, null, 2)
  );
  console.log(`  Wrote extraction manifest: store/extractions/${extractionName}.json`);

  await rebuildGlobalCsv(STORE_DIR);
  console.log(`  Updated global index.csv`);

  console.log(`\nExtraction complete. View with: npm run list -- --name ${extractionName}\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  if (err.message?.includes('Token not found') || err.message?.includes('not found in config')) {
    console.error('\nSetup help:');
    console.error('  1. Copy .env.example to .env and fill in your CMA tokens');
    console.error('  2. Update config/spaces.json with your space IDs');
  }
  process.exit(1);
});
