import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { createObjectCsvWriter } from 'csv-writer';

/**
 * Rebuild the global index.csv from all entries in store/entries/
 * and all extraction manifests in store/extractions/.
 */
export async function rebuildGlobalCsv(storeDir) {
  const entriesDir = resolve(storeDir, 'entries');
  const extractionsDir = resolve(storeDir, 'extractions');

  if (!existsSync(entriesDir)) return;

  const entryToExtractions = buildEntryToExtractionMap(extractionsDir);

  const csvPath = resolve(storeDir, 'index.csv');
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'entryId', title: 'Entry ID' },
      { id: 'contentType', title: 'Content Type' },
      { id: 'title', title: 'Title' },
      { id: 'entryRefs', title: 'Entry Refs' },
      { id: 'assetRefs', title: 'Asset Refs' },
      { id: 'usedBy', title: 'Used By Extractions' },
      { id: 'filePath', title: 'File Path' },
    ],
  });

  const records = [];
  const contentTypeDirs = readdirSync(entriesDir).filter(name => {
    return statSync(resolve(entriesDir, name)).isDirectory();
  });

  for (const contentType of contentTypeDirs) {
    const typeDir = resolve(entriesDir, contentType);
    const files = readdirSync(typeDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const entryId = file.replace('.json', '');
      const entryData = JSON.parse(readFileSync(resolve(typeDir, file), 'utf-8'));
      const usedBy = entryToExtractions[entryId] || [];

      records.push({
        entryId,
        contentType,
        title: entryData.title || '(untitled)',
        entryRefs: entryData.entryRefs?.length || 0,
        assetRefs: entryData.assetRefs?.length || 0,
        usedBy: usedBy.join(', '),
        filePath: `entries/${contentType}/${file}`,
      });
    }
  }

  await csvWriter.writeRecords(records);
  return records.length;
}

/**
 * Build a map of entryId -> [extraction names that include it].
 */
function buildEntryToExtractionMap(extractionsDir) {
  const map = {};
  if (!existsSync(extractionsDir)) return map;

  const files = readdirSync(extractionsDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const extraction = JSON.parse(readFileSync(resolve(extractionsDir, file), 'utf-8'));
    for (const entryId of Object.keys(extraction.entries || {})) {
      if (!map[entryId]) map[entryId] = [];
      map[entryId].push(extraction.name);
    }
  }
  return map;
}

/**
 * Resolve path to an entry JSON file given its ID and content type.
 */
export function getEntryPath(storeDir, contentType, entryId) {
  return resolve(storeDir, 'entries', contentType, `${entryId}.json`);
}

/**
 * Load all extraction manifests from store/extractions/.
 */
export function loadExtractions(storeDir) {
  const extractionsDir = resolve(storeDir, 'extractions');
  if (!existsSync(extractionsDir)) return [];

  return readdirSync(extractionsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(resolve(extractionsDir, f), 'utf-8')));
}

/**
 * Load the global remap file.
 */
export function loadGlobalRemap(storeDir) {
  const remapPath = resolve(storeDir, 'remap.json');
  if (!existsSync(remapPath)) return {};
  return JSON.parse(readFileSync(remapPath, 'utf-8'));
}

/**
 * Save the global remap file.
 */
export function saveGlobalRemap(storeDir, remap) {
  const remapPath = resolve(storeDir, 'remap.json');
  writeFileSync(remapPath, JSON.stringify(remap, null, 2));
}

/**
 * Load the asset remap file (sourceAssetId → targetAssetId).
 */
export function loadAssetRemap(storeDir) {
  const remapPath = resolve(storeDir, 'asset-remap.json');
  if (!existsSync(remapPath)) return {};
  return JSON.parse(readFileSync(remapPath, 'utf-8'));
}

/**
 * Save the asset remap file.
 */
export function saveAssetRemap(storeDir, remap) {
  const remapPath = resolve(storeDir, 'asset-remap.json');
  writeFileSync(remapPath, JSON.stringify(remap, null, 2));
}

/**
 * Search the local catalog for an entry by ID (scans all content type folders).
 * Returns { contentType, title, entryRefs, assetRefs } or null if not found.
 */
export function findEntryInCatalog(storeDir, entryId) {
  const entriesDir = resolve(storeDir, 'entries');
  if (!existsSync(entriesDir)) return null;

  const types = readdirSync(entriesDir).filter(n => statSync(resolve(entriesDir, n)).isDirectory());
  for (const type of types) {
    const filePath = resolve(entriesDir, type, `${entryId}.json`);
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      return {
        contentType: data.contentType,
        title: data.title,
        entryRefs: data.entryRefs || [],
        assetRefs: data.assetRefs || [],
      };
    }
  }
  return null;
}
