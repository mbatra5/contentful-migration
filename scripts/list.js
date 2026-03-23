import { parseArgs } from './lib/client.js';
import { loadExtractions, loadGlobalRemap } from './lib/catalog.js';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');
const ENTRIES_DIR = resolve(STORE_DIR, 'entries');
const EXTRACTIONS_DIR = resolve(STORE_DIR, 'extractions');

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.name) {
    showExtraction(args.name);
  } else if (args.type) {
    showContentType(args.type);
  } else {
    showOverview();
  }
}

function showOverview() {
  console.log(`\nContentful Migrator — Store Overview`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Content type catalog
  if (existsSync(ENTRIES_DIR)) {
    const types = readdirSync(ENTRIES_DIR)
      .filter(n => statSync(resolve(ENTRIES_DIR, n)).isDirectory())
      .sort();

    if (types.length > 0) {
      let totalEntries = 0;
      console.log('  Content Catalog:\n');
      for (const type of types) {
        const count = readdirSync(resolve(ENTRIES_DIR, type)).filter(f => f.endsWith('.json')).length;
        totalEntries += count;
        console.log(`    ${type.padEnd(35)} ${String(count).padStart(4)} entries`);
      }
      console.log(`    ${'─'.repeat(44)}`);
      console.log(`    ${'TOTAL'.padEnd(35)} ${String(totalEntries).padStart(4)} entries`);
      console.log();
    }
  } else {
    console.log('  No entries in catalog yet.\n');
  }

  // Extractions
  const extractions = loadExtractions(STORE_DIR);
  if (extractions.length > 0) {
    console.log('  Extractions:\n');
    for (const ext of extractions) {
      console.log(`    ${ext.name}`);
      console.log(`      Root:       ${ext.rootTitle || ext.rootEntryId}`);
      console.log(`      Source:     ${ext.source.spaceId} / ${ext.source.environmentId}`);
      console.log(`      Entries:    ${ext.totalEntries}`);
      console.log(`      Extracted:  ${ext.extractedAt}`);
      console.log();
    }
  } else {
    console.log('  No extractions yet. Run: npm run extract -- --entry <id>\n');
  }

  // Global remap
  const remap = loadGlobalRemap(STORE_DIR);
  const remapCount = Object.keys(remap).length;
  if (remapCount > 0) {
    console.log(`  Global Remap: ${remapCount} entries mapped to target space\n`);
  }

  console.log('  Commands:');
  console.log('    npm run list -- --name <extraction>   Show extraction details');
  console.log('    npm run list -- --type <contentType>  Show entries of a content type');
  console.log();
}

function showExtraction(name) {
  const manifestPath = resolve(EXTRACTIONS_DIR, `${name}.json`);

  if (!existsSync(manifestPath)) {
    console.error(`Error: Extraction "${name}" not found.`);
    console.error('Available extractions:');
    const extractions = loadExtractions(STORE_DIR);
    for (const ext of extractions) {
      console.error(`  - ${ext.name}`);
    }
    process.exit(1);
  }

  const extraction = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const remap = loadGlobalRemap(STORE_DIR);

  console.log(`\nContentful Migrator — Extraction: ${name}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Root:       ${extraction.rootTitle || extraction.rootEntryId}`);
  console.log(`Source:     ${extraction.source.spaceId} / ${extraction.source.environmentId}`);
  console.log(`Extracted:  ${extraction.extractedAt}`);
  console.log(`\nEntries (${extraction.totalEntries}):\n`);

  const contentTypes = {};
  for (const [entryId, info] of Object.entries(extraction.entries)) {
    if (!contentTypes[info.contentType]) contentTypes[info.contentType] = [];
    contentTypes[info.contentType].push({ entryId, ...info });
  }

  for (const [type, entries] of Object.entries(contentTypes).sort()) {
    console.log(`  [${type}] (${entries.length})`);
    for (const entry of entries) {
      const isRoot = entry.entryId === extraction.rootEntryId ? ' (ROOT)' : '';
      const mapped = remap[entry.entryId] ? ` -> ${remap[entry.entryId]}` : '';
      const refs = entry.entryRefs.length > 0 ? ` | ${entry.entryRefs.length} refs` : '';
      console.log(`    ${entry.entryId}  ${entry.title || '(untitled)'}${refs}${isRoot}${mapped}`);
    }
    console.log();
  }

  if (extraction.assetIds?.length > 0) {
    console.log(`  Asset references: ${extraction.assetIds.length}\n`);
  }

  console.log(`  Dependency order (creation sequence):`);
  for (let i = 0; i < extraction.dependencyOrder.length; i++) {
    const id = extraction.dependencyOrder[i];
    const info = extraction.entries[id];
    if (!info) continue;
    console.log(`    ${i + 1}. ${id}  [${info.contentType}]  ${info.title || '(untitled)'}`);
  }
  console.log();
}

function showContentType(type) {
  const typeDir = resolve(ENTRIES_DIR, type);

  if (!existsSync(typeDir)) {
    console.error(`Error: Content type "${type}" not found in catalog.`);
    if (existsSync(ENTRIES_DIR)) {
      const available = readdirSync(ENTRIES_DIR).filter(n => statSync(resolve(ENTRIES_DIR, n)).isDirectory());
      console.error('Available content types:', available.join(', '));
    }
    process.exit(1);
  }

  const remap = loadGlobalRemap(STORE_DIR);
  const files = readdirSync(typeDir).filter(f => f.endsWith('.json'));

  console.log(`\nContentful Migrator — Content Type: ${type}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Entries: ${files.length}\n`);

  for (const file of files) {
    const entryId = file.replace('.json', '');
    const data = JSON.parse(readFileSync(resolve(typeDir, file), 'utf-8'));
    const mapped = remap[entryId] ? ` -> ${remap[entryId]}` : '';
    const refs = data.entryRefs?.length > 0 ? ` | ${data.entryRefs.length} refs` : '';
    console.log(`  ${entryId}  ${data.title || '(untitled)'}${refs}${mapped}`);
  }
  console.log();
}

main();
