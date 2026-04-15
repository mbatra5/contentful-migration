import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { walkEntryTree } from './lib/walker.js';
import { writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');

const PAGE_TYPES = new Set(['page']);
const IMAGE_TYPES = new Set(['imageWithFocalPoint']);
const REUSE_TYPES = new Set(['marketAndLanguage']);

function printUsage() {
  console.error('Usage: npm run generate-spec -- --entry <id> [options]');
  console.error('\nGenerates a create-content spec JSON from a source entry tree.');
  console.error('Walks the full tree, classifies entries, replaces page links,');
  console.error('image assets, and file assets with provided target IDs.\n');
  console.error('Required:');
  console.error('  --entry          Source entry ID to generate spec from');
  console.error('\nOptional:');
  console.error('  --blank-page     Target page ID for internal page links (default: 1UN2htPDDQMm2CbbxFS6PU)');
  console.error('  --image-asset    Target asset ID for images (default: 3SNgZAJXRVBqLYbGQNJ8xI)');
  console.error('  --file-asset     Target asset ID for downloadable files (default: 2L3c0dHZcVdBGPZMOUlG0h)');
  console.error('  --market-lang    Target marketAndLanguage entry ID (default: 23Okp9wZhcfC9vr7K6z7zK)');
  console.error('  --space          Source space alias (default: source)');
  console.error('  --target-space   Target space alias (default: target)');
  console.error('  --suffix         Suffix appended to entryName fields (default: " - RMA")');
  console.error('  --output         Output file path (default: specs/<entryId>.json)');
  console.error('  --depth          Max tree walk depth (default: unlimited)');
  console.error('  --skip-types     Extra content types to skip (comma-separated)');
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function generateLocalId(contentType, entryName, usedIds) {
  let base = slugify(entryName || contentType);
  if (base.length > 40) base = base.substring(0, 40);
  let id = base;
  let counter = 2;
  while (usedIds.has(id)) {
    id = `${base}-${counter}`;
    counter++;
  }
  usedIds.add(id);
  return id;
}

function processFieldValue(value, idMap, blankPageId, imageAssetId, fileAssetId) {
  if (!value || typeof value !== 'object') return value;

  if (value.sys?.type === 'Link') {
    if (value.sys.linkType === 'Entry') {
      const mapped = idMap[value.sys.id];
      if (mapped) return mapped;
      return value;
    }
    if (value.sys.linkType === 'Asset') {
      return `asset:${imageAssetId}`;
    }
    return value;
  }

  if (value.nodeType === 'document') {
    return processRichText(value, idMap, blankPageId, imageAssetId);
  }

  if (Array.isArray(value)) {
    return value.map(v => processFieldValue(v, idMap, blankPageId, imageAssetId, fileAssetId));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = processFieldValue(v, idMap, blankPageId, imageAssetId, fileAssetId);
    }
    return result;
  }

  return value;
}

function processRichText(doc, idMap, blankPageId, imageAssetId) {
  const clone = JSON.parse(JSON.stringify(doc));
  walkRichTextNodes(clone, idMap, blankPageId, imageAssetId);
  return clone;
}

function walkRichTextNodes(node, idMap, blankPageId, imageAssetId) {
  if (!node || typeof node !== 'object') return;

  if (node.data?.target?.sys?.type === 'Link' && node.data.target.sys.linkType === 'Entry') {
    const sourceId = node.data.target.sys.id;
    const mapped = idMap[sourceId];
    if (mapped) {
      if (mapped.startsWith('existing:')) {
        node.data.target.sys.id = mapped.replace('existing:', '');
      } else if (mapped.startsWith('@')) {
        node.data.target.sys.id = mapped;
      }
    }
  }

  if (node.data?.target?.sys?.type === 'Link' && node.data.target.sys.linkType === 'Asset') {
    node.data.target.sys.id = imageAssetId;
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walkRichTextNodes(child, idMap, blankPageId, imageAssetId);
    }
  }
}

function processFields(fields, contentType, idMap, blankPageId, imageAssetId, fileAssetId, suffix) {
  const processed = {};

  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (typeof localeMap !== 'object' || localeMap === null) continue;

    const localeKeys = Object.keys(localeMap);
    if (localeKeys.length === 0) continue;

    const slugSuffix = suffix.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');

    if (localeKeys.length === 1 && localeKeys[0] === 'en') {
      const val = processFieldValue(localeMap['en'], idMap, blankPageId, imageAssetId, fileAssetId);
      if (fieldName === 'entryName' && typeof val === 'string') {
        processed[fieldName] = val + suffix;
      } else if (fieldName === 'slug' && typeof val === 'string') {
        processed[fieldName] = val + slugSuffix;
      } else if (fieldName === 'title' && contentType === 'imageWithFocalPoint' && typeof val === 'string') {
        processed[fieldName] = val + suffix;
      } else {
        processed[fieldName] = val;
      }
    } else {
      const multiLocale = {};
      for (const [locale, val] of Object.entries(localeMap)) {
        multiLocale[locale] = processFieldValue(val, idMap, blankPageId, imageAssetId, fileAssetId);
      }
      if (fieldName === 'entryName' && typeof multiLocale['en'] === 'string') {
        multiLocale['en'] = multiLocale['en'] + suffix;
      }
      if (fieldName === 'slug' && typeof multiLocale['en'] === 'string') {
        multiLocale['en'] = multiLocale['en'] + slugSuffix;
      }
      processed[fieldName] = multiLocale;
    }
  }

  return processed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const DEFAULT_BLANK_PAGE = '1UN2htPDDQMm2CbbxFS6PU';
  const DEFAULT_IMAGE_ASSET = '3SNgZAJXRVBqLYbGQNJ8xI';
  const DEFAULT_FILE_ASSET = '2L3c0dHZcVdBGPZMOUlG0h';
  const DEFAULT_MARKET_LANG = '1INgk6D7VAJ2RB4RbGGLwp';

  if (!args.entry) {
    printUsage();
    process.exit(1);
  }

  const rootEntryId = args.entry;
  const blankPageId = args['blank-page'] || DEFAULT_BLANK_PAGE;
  const imageAssetId = args['image-asset'] || DEFAULT_IMAGE_ASSET;
  const fileAssetId = args['file-asset'] || DEFAULT_FILE_ASSET;
  const marketLangId = args['market-lang'] || DEFAULT_MARKET_LANG;
  const sourceAlias = args.space || 'source';
  const targetAlias = args['target-space'] || 'target';
  const suffix = args.suffix !== undefined ? args.suffix : ' - RMA';
  const outputPath = args.output || `specs/${rootEntryId}.json`;
  const maxDepth = args.depth !== undefined ? parseInt(args.depth, 10) : Infinity;

  const extraSkip = args['skip-types'] ? args['skip-types'].split(',').map(t => t.trim()) : [];
  const skipTypes = [...PAGE_TYPES, ...REUSE_TYPES, ...extraSkip];

  const sourceConfig = getSpaceConfig(sourceAlias);

  console.log(`\nContentful Migrator — Generate Spec`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Source:       ${sourceAlias} (${sourceConfig.spaceId} / ${sourceConfig.environmentId})`);
  console.log(`Root Entry:   ${rootEntryId}`);
  console.log(`Blank Page:   ${blankPageId}`);
  console.log(`Image Asset:  ${imageAssetId}`);
  if (fileAssetId !== imageAssetId) console.log(`File Asset:   ${fileAssetId}`);
  console.log(`Market&Lang:  ${marketLangId}`);
  console.log(`Suffix:       "${suffix}"`);
  console.log(`Output:       ${outputPath}`);
  console.log(`Max depth:    ${maxDepth === Infinity ? 'unlimited' : maxDepth}`);

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
  console.log(`\n\n  Entries found: ${entryCount}`);
  console.log(`  Assets found:  ${assetIds.length}`);
  if (skipped.size > 0) console.log(`  Skipped (type): ${skipped.size} (${[...new Set(skipped.values())].join(', ')})`);
  if (depthCapped.size > 0) console.log(`  Skipped (depth): ${depthCapped.size}`);

  const usedLocalIds = new Set();
  const sourceToLocalId = {};
  const idMap = {};

  for (const sourceId of dependencyOrder) {
    const data = entryData[sourceId];
    const localId = generateLocalId(data.contentType, data.title, usedLocalIds);
    sourceToLocalId[sourceId] = localId;
    idMap[sourceId] = `@${localId}`;
  }

  for (const [sourceId, contentType] of skipped.entries()) {
    if (PAGE_TYPES.has(contentType)) {
      idMap[sourceId] = `existing:${blankPageId}`;
    } else if (REUSE_TYPES.has(contentType)) {
      idMap[sourceId] = `existing:${marketLangId}`;
    }
  }

  for (const [sourceId] of depthCapped.entries()) {
    idMap[sourceId] = `existing:${blankPageId}`;
  }

  const specEntries = [];

  for (const sourceId of dependencyOrder) {
    const data = entryData[sourceId];
    const localId = sourceToLocalId[sourceId];

    const processedFields = processFields(
      data.fields, data.contentType, idMap, blankPageId, imageAssetId, fileAssetId, suffix
    );

    specEntries.push({
      id: localId,
      contentType: data.contentType,
      fields: processedFields,
    });
  }

  const spec = {
    space: targetAlias,
    locale: 'en',
    entries: specEntries,
  };

  const resolvedOutput = resolve(process.cwd(), outputPath);
  writeFileSync(resolvedOutput, JSON.stringify(spec, null, 2) + '\n');

  console.log(`\nSpec generated: ${outputPath}`);
  console.log(`  Entries in spec: ${specEntries.length}`);
  console.log(`  Page links replaced: ${[...skipped.values()].filter(t => PAGE_TYPES.has(t)).length + [...depthCapped.keys()].length}`);
  console.log(`  Image assets wired to: ${imageAssetId}`);
  if (fileAssetId !== imageAssetId) console.log(`  File assets wired to: ${fileAssetId}`);
  console.log(`\nNext steps:`);
  console.log(`  Dry run:  npm run create-content:preview -- --spec ${outputPath}`);
  console.log(`  Create:   npm run create-content -- --spec ${outputPath}\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
