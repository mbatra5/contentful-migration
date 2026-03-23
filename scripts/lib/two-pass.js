/**
 * Shared two-pass entry creation logic.
 *
 * Pass 1: Create "shell" entries (non-reference fields only).
 * Pass 2: Update shells with remapped entry + asset references.
 *
 * Used by create.js, migrate.js, and create-content.js.
 */

import { RATE_LIMIT_DELAY, sleep } from './helpers.js';
import { remapFields, cleanFieldsForCreate, stripReferenceFields, filterLocales } from './mapper.js';

/**
 * Pass 1 — Create shell entries in the target environment.
 *
 * @param {object} environment   - Contentful target environment
 * @param {Array}  entries       - Array of { id, contentType, title, fields }
 * @param {object} globalRemap   - Mutable source→target entry ID map
 * @param {object} opts          - { allowedLocales, forceCreate, assetRemap }
 * @returns {number} count of successfully created entries
 */
export async function createEntryShells(environment, entries, globalRemap, opts = {}) {
  const { allowedLocales, forceCreate = false, assetRemap = {} } = opts;
  let created = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const label = `[${i + 1}/${entries.length}]`;
    const prevId = forceCreate && globalRemap[entry.id] ? ` (was ${globalRemap[entry.id]})` : '';

    // Strip entry refs but keep asset refs (remapped if needed)
    let fields = stripReferenceFields(cleanFieldsForCreate(entry.fields));
    if (Object.keys(assetRemap).length > 0) {
      fields = remapFields(fields, {}, assetRemap);
    }
    if (allowedLocales) {
      fields = filterLocales(fields, allowedLocales);
    }

    process.stdout.write(`  ${label} Creating ${entry.contentType}: ${entry.title || entry.id}${prevId}...`);

    try {
      const newEntry = await environment.createEntry(entry.contentType, { fields });
      globalRemap[entry.id] = newEntry.sys.id;
      console.log(` -> ${newEntry.sys.id}`);
      created++;
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      if (err.details?.errors) {
        for (const e of err.details.errors) {
          console.log(`    ${e.name}: ${e.details || e.value || ''}`);
        }
      }
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  return created;
}

/**
 * Pass 2 — Wire entry + asset references into previously created shells.
 *
 * @param {object} environment  - Contentful target environment
 * @param {Array}  entries      - Array of { id, contentType, title, fields, entryRefs }
 * @param {object} globalRemap  - source→target entry ID map
 * @param {object} opts         - { allowedLocales, shouldPublish, assetRemap }
 * @returns {number} count of successfully linked entries
 */
export async function linkReferences(environment, entries, globalRemap, opts = {}) {
  const { allowedLocales, shouldPublish = false, assetRemap = {} } = opts;
  const entriesWithRefs = entries.filter(e => e.entryRefs?.length > 0 && globalRemap[e.id]);

  if (entriesWithRefs.length === 0) return 0;

  console.log(`\nPass 2: Linking references for ${entriesWithRefs.length} entries...\n`);

  let linked = 0;

  for (let i = 0; i < entriesWithRefs.length; i++) {
    const entry = entriesWithRefs[i];
    const newId = globalRemap[entry.id];
    const label = `[${i + 1}/${entriesWithRefs.length}]`;

    let fields = remapFields(cleanFieldsForCreate(entry.fields), globalRemap, assetRemap);
    if (allowedLocales) {
      fields = filterLocales(fields, allowedLocales);
    }

    process.stdout.write(`  ${label} Linking ${entry.contentType}: ${entry.title || entry.id}...`);

    try {
      const targetEntry = await environment.getEntry(newId);
      targetEntry.fields = fields;
      await targetEntry.update();
      console.log(` done (${entry.entryRefs.length} refs)`);
      linked++;

      if (shouldPublish) {
        const fresh = await environment.getEntry(newId);
        await fresh.publish();
      }
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  return linked;
}

/**
 * Publish entries that have no entry references (already fully formed after Pass 1).
 *
 * @param {object} environment - Contentful target environment
 * @param {Array}  entries     - Full entry list
 * @param {object} globalRemap - source→target entry ID map
 * @returns {number} count of published entries
 */
export async function publishEntries(environment, entries, globalRemap) {
  const noRefEntries = entries.filter(e => (!e.entryRefs || e.entryRefs.length === 0) && globalRemap[e.id]);
  if (noRefEntries.length === 0) return 0;

  console.log(`\nPublishing ${noRefEntries.length} entries without references...\n`);
  let published = 0;

  for (const entry of noRefEntries) {
    try {
      const e = await environment.getEntry(globalRemap[entry.id]);
      await e.publish();
      published++;
    } catch (err) {
      console.log(`  Warning: Could not publish ${globalRemap[entry.id]}: ${err.message}`);
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  return published;
}
