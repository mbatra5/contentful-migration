import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { getEntryTitle } from './lib/helpers.js';
import { loadGlobalRemap } from './lib/catalog.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.entry) {
    console.error('Usage: npm run inspect -- --entry <entry-id> [options]');
    console.error('\nOptions:');
    console.error('  --entry    Entry ID to inspect (required)');
    console.error('  --space    Space alias from config/spaces.json (default: source)');
    process.exit(1);
  }

  const spaceAlias = args.space || 'source';
  const entryId = args.entry;

  console.log(`\nContentful Entry Inspector`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const spaceConfig = getSpaceConfig(spaceAlias);
  const env = await getEnvironment(spaceAlias);

  let entry;
  try {
    entry = await env.getEntry(entryId);
  } catch (err) {
    if (err?.sys?.id === 'NotFound' || err?.statusCode === 404
      || err?.message?.includes('404') || err?.details?.type === 'Entry') {
      console.error(`  Entry ${entryId} not found in ${spaceAlias} (${spaceConfig.environmentId}).`);
      process.exit(1);
    }
    throw err;
  }

  const title = getEntryTitle(entry.fields) || '(untitled)';
  const sys = entry.sys;
  const contentType = sys.contentType?.sys?.id || 'unknown';

  console.log(`  Entry ID:         ${sys.id}`);
  console.log(`  Entry Name:       ${title}`);
  console.log(`  Content Type:     ${contentType}`);
  console.log(`  Space:            ${spaceConfig.spaceId} (${spaceAlias})`);
  console.log(`  Environment:      ${spaceConfig.environmentId}`);
  console.log();
  console.log(`  Created At:       ${sys.createdAt || 'N/A'}`);
  console.log(`  First Published:  ${sys.firstPublishedAt || 'Never published'}`);
  console.log(`  Last Published:   ${sys.publishedAt || 'N/A'}`);
  console.log(`  Last Updated:     ${sys.updatedAt || 'N/A'}`);
  console.log();
  console.log(`  Version:          ${sys.version ?? 'N/A'}`);
  console.log(`  Published Ver:    ${sys.publishedVersion ?? 'N/A'}`);
  console.log(`  Published Count:  ${sys.publishedCounter ?? 'N/A'}`);

  const status = sys.publishedVersion
    ? (sys.version === sys.publishedVersion + 1 ? 'Published' : 'Changed (draft)')
    : 'Draft';
  console.log(`  Status:           ${status}`);

  if (sys.createdBy?.sys?.id) {
    console.log(`  Created By:       ${sys.createdBy.sys.id}`);
  }
  if (sys.updatedBy?.sys?.id) {
    console.log(`  Updated By:       ${sys.updatedBy.sys.id}`);
  }

  const locales = new Set();
  for (const field of Object.values(entry.fields)) {
    for (const loc of Object.keys(field)) locales.add(loc);
  }
  if (locales.size > 0) {
    console.log(`\n  Locales:          ${[...locales].sort().join(', ')}`);
  }

  const fieldNames = Object.keys(entry.fields);
  let refCount = 0;
  for (const field of Object.values(entry.fields)) {
    for (const val of Object.values(field)) {
      if (val?.sys?.type === 'Link') refCount++;
      if (Array.isArray(val)) {
        refCount += val.filter(v => v?.sys?.type === 'Link').length;
      }
    }
  }
  console.log(`  Fields:           ${fieldNames.length} (${refCount} references)`);

  const remap = loadGlobalRemap(STORE_DIR);
  if (remap[entryId]) {
    console.log(`\n  Remap:            ${entryId} → ${remap[entryId]} (target)`);
  }

  console.log();
}

main();
