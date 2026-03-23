import { getEnvironment, getSpaceConfig, parseArgs, getCdaToken } from './lib/client.js';
import { remapFields, cleanFieldsForCreate, stripReferenceFields, filterLocales, fetchAllowedLocales } from './lib/mapper.js';
import { getEntryPath, loadGlobalRemap, saveGlobalRemap, loadAssetRemap, saveAssetRemap, findEntryInCatalog } from './lib/catalog.js';
import { RATE_LIMIT_DELAY, sleep } from './lib/helpers.js';
import { createEntryShells, linkReferences, publishEntries } from './lib/two-pass.js';
import { migrateAssets, collectAssetIds } from './lib/assets.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, '../store');
const EXTRACTIONS_DIR = resolve(STORE_DIR, 'extractions');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name && !args.entries) {
    console.error('Usage:');
    console.error('  npm run create -- --name <extraction-name> --space <alias> [options]');
    console.error('  npm run create -- --entries <id1,id2> --space <alias> [options]');
    console.error('\nOptions:');
    console.error('  --name        Extraction name to create from');
    console.error('  --entries     Comma-separated entry IDs to create');
    console.error('  --space       Target space alias (default: target)');
    console.error('  --source      Source space alias for asset migration (default: source)');
    console.error('  --publish     Auto-publish entries after creation');
    console.error('  --update      Update existing entries in-place (auto-creates if deleted)');
    console.error('  --force       Ignore remap — create new entries for everything');
    console.error('  --with-assets Migrate referenced assets from source to target');
    console.error('  --dry-run     Show what would be created without making changes');
    process.exit(1);
  }

  const spaceAlias = args.space || 'target';
  const sourceAlias = args.source || 'source';
  const shouldPublish = args.publish === true;
  const shouldUpdate = args.update === true;
  const forceCreate = args.force === true;
  const withAssets = args['with-assets'] === true;
  const dryRun = args['dry-run'] === true;

  let extraction = null;
  let entriesToProcess = [];
  let entryMetadata = {};

  if (args.name) {
    const manifestPath = resolve(EXTRACTIONS_DIR, `${args.name}.json`);
    if (!existsSync(manifestPath)) {
      console.error(`Error: Extraction "${args.name}" not found at store/extractions/${args.name}.json`);
      console.error('Run: npm run list  to see available extractions.');
      process.exit(1);
    }
    extraction = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    entryMetadata = extraction.entries;

    if (args.entries) {
      const selected = args.entries.split(',').map(s => s.trim());
      entriesToProcess = extraction.dependencyOrder.filter(id => selected.includes(id));
    } else {
      entriesToProcess = extraction.dependencyOrder;
    }
  } else if (args.entries) {
    const selected = args.entries.split(',').map(s => s.trim());
    entriesToProcess = selected;
    for (const id of selected) {
      const found = findEntryInCatalog(STORE_DIR, id);
      if (found) {
        entryMetadata[id] = found;
      } else {
        console.error(`Warning: Entry ${id} not found in store/entries/. Skipping.`);
      }
    }
    entriesToProcess = entriesToProcess.filter(id => entryMetadata[id]);
  }

  if (entriesToProcess.length === 0) {
    console.error('Error: No entries to process.');
    process.exit(1);
  }

  const globalRemap = loadGlobalRemap(STORE_DIR);
  const assetRemap = loadAssetRemap(STORE_DIR);

  const modeLabel = shouldUpdate && forceCreate
    ? 'FORCE + UPDATE (overwrite existing, create all unmapped)'
    : shouldUpdate
    ? 'UPDATE (overwrite existing, auto-create if deleted)'
    : forceCreate
    ? 'FORCE CREATE (ignore remap, create everything fresh)'
    : 'CREATE (skip entries already in remap)';

  console.log(`\nContentful Migrator — Create`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (extraction) {
    console.log(`Extraction:  ${extraction.name} (${extraction.source.spaceId})`);
  }
  console.log(`Target:      ${spaceAlias}`);
  console.log(`Entries:     ${entriesToProcess.length}`);
  console.log(`Mode:        ${modeLabel}${dryRun ? ' (DRY RUN)' : ''}`);
  if (withAssets) console.log(`Assets:      YES (migrate from ${sourceAlias})`);
  if (shouldPublish) console.log(`Publish:     YES`);

  const alreadyMapped = entriesToProcess.filter(id => globalRemap[id]);
  if (alreadyMapped.length > 0 && !shouldUpdate && !forceCreate) {
    console.log(`Dedup:       ${alreadyMapped.length} entries already in target (will skip)`);
  } else if (alreadyMapped.length > 0 && forceCreate) {
    console.log(`Force:       ${alreadyMapped.length} remap entries will be ignored`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run — entries that would be processed:\n');
    for (const entryId of entriesToProcess) {
      const info = entryMetadata[entryId];
      const mapped = globalRemap[entryId];
      let status;
      if (forceCreate && mapped) status = `(remap ignored, will create new — was ${mapped})`;
      else if (shouldUpdate && mapped) status = `(will update ${mapped})`;
      else if (mapped && !forceCreate) status = `(skip — exists: ${mapped})`;
      else status = '(new)';
      console.log(`  ${entryId}  [${info.contentType}]  ${info.title || '(untitled)'}  ${status}`);
    }
    console.log(`\nTotal: ${entriesToProcess.length} entries. No changes made.\n`);
    return;
  }

  const spaceConfig = getSpaceConfig(spaceAlias);
  const environment = await getEnvironment(spaceAlias);
  console.log(`Connected to target space ${spaceConfig.spaceId} (${spaceConfig.environmentId})`);

  const allowedLocales = await fetchAllowedLocales(environment);
  console.log(`Locales:     ${[...allowedLocales].join(', ')}\n`);

  // Asset migration (if requested)
  if (withAssets) {
    const allAssetIds = collectAssetIds(
      Object.fromEntries(entriesToProcess.map(id => [id, entryMetadata[id]]))
    );

    if (allAssetIds.length > 0) {
      console.log(`Migrating ${allAssetIds.length} referenced assets...\n`);
      const sourceEnv = await getEnvironment(sourceAlias);
      const cdaToken = getCdaToken(sourceAlias);
      const result = await migrateAssets(sourceEnv, environment, allAssetIds, assetRemap, {
        allowedLocales, cdaToken,
      });
      saveAssetRemap(STORE_DIR, assetRemap);
      console.log(`Assets: ${result.migrated} created, ${result.reused} reused, ${result.failed} failed\n`);
    } else {
      console.log('No asset references found.\n');
    }
  }

  if (shouldUpdate) {
    await updateEntries(environment, entryMetadata, entriesToProcess, globalRemap, shouldPublish, allowedLocales, forceCreate, assetRemap);
  } else {
    await createEntries(environment, entryMetadata, entriesToProcess, globalRemap, shouldPublish, allowedLocales, forceCreate, assetRemap);
  }

  saveGlobalRemap(STORE_DIR, globalRemap);
  if (withAssets) saveAssetRemap(STORE_DIR, assetRemap);
  console.log(`\nSaved global remap to store/remap.json (${Object.keys(globalRemap).length} total mappings)\n`);
}

function loadEntryData(contentType, entryId) {
  const filePath = getEntryPath(STORE_DIR, contentType, entryId);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

async function createEntries(environment, entryMetadata, entriesToProcess, globalRemap, shouldPublish, allowedLocales, forceCreate, assetRemap) {
  let entriesToCreate;
  if (forceCreate) {
    entriesToCreate = entriesToProcess;
    console.log(`Force mode: creating all ${entriesToCreate.length} entries (ignoring remap)\n`);
  } else {
    entriesToCreate = entriesToProcess.filter(id => !globalRemap[id]);
    const skippedCount = entriesToProcess.length - entriesToCreate.length;
    if (skippedCount > 0) {
      console.log(`Skipping ${skippedCount} entries already in remap.json\n`);
    }
  }

  if (entriesToCreate.length === 0) {
    console.log('All entries already exist in target. Nothing to create.\n');
    console.log('  Use --force to create new copies regardless, or --update to overwrite.\n');
    return;
  }

  // Build entry array for two-pass module
  const entries = entriesToCreate.map(id => {
    const info = entryMetadata[id];
    const data = loadEntryData(info.contentType, id);
    return { id, contentType: info.contentType, title: info.title, fields: data.fields, entryRefs: info.entryRefs };
  });

  console.log(`Pass 1: Creating ${entries.length} entry shells...\n`);
  await createEntryShells(environment, entries, globalRemap, { allowedLocales, forceCreate, assetRemap });
  await linkReferences(environment, entries, globalRemap, { allowedLocales, shouldPublish, assetRemap });
  if (shouldPublish) await publishEntries(environment, entries, globalRemap);

  const created = entriesToCreate.filter(id => globalRemap[id]).length;
  console.log(`\nCreation complete. ${created} entries created.`);
}

async function updateEntries(environment, entryMetadata, entriesToProcess, globalRemap, shouldPublish, allowedLocales, forceCreate, assetRemap) {
  let entriesToUpdate;
  let unmappedEntries = [];

  if (forceCreate) {
    entriesToUpdate = entriesToProcess.filter(id => globalRemap[id]);
    unmappedEntries = entriesToProcess.filter(id => !globalRemap[id]);
  } else {
    entriesToUpdate = entriesToProcess.filter(id => globalRemap[id]);
    const skippedCount = entriesToProcess.length - entriesToUpdate.length;
    if (skippedCount > 0) {
      console.log(`Skipping ${skippedCount} unmapped entries (run without --update to create them first)\n`);
    }
  }

  if (entriesToUpdate.length === 0 && unmappedEntries.length === 0) {
    console.log('No entries to process. Run without --update first to create them.\n');
    return;
  }

  let updated = 0;
  let recreated = 0;
  let failed = 0;

  if (entriesToUpdate.length > 0) {
    console.log(`Updating ${entriesToUpdate.length} existing entries...\n`);

    for (let i = 0; i < entriesToUpdate.length; i++) {
      const entryId = entriesToUpdate[i];
      const targetId = globalRemap[entryId];
      const info = entryMetadata[entryId];
      const entryData = loadEntryData(info.contentType, entryId);
      const remappedFields = filterLocales(
        remapFields(cleanFieldsForCreate(entryData.fields), globalRemap, assetRemap),
        allowedLocales
      );

      const label = `[${i + 1}/${entriesToUpdate.length}]`;
      process.stdout.write(`  ${label} Updating ${info.contentType}: ${info.title || entryId} (${targetId})...`);

      try {
        const targetEntry = await environment.getEntry(targetId);
        targetEntry.fields = remappedFields;
        await targetEntry.update();
        console.log(` done`);
        updated++;

        if (shouldPublish) {
          const fresh = await environment.getEntry(targetId);
          await fresh.publish();
        }
      } catch (err) {
        const isNotFound = err.message?.includes('NotFound') || err.name === 'NotFound'
          || err.message?.includes('404') || err.message?.includes('The resource could not be found');

        if (isNotFound) {
          console.log(` NOT FOUND — recreating...`);
          try {
            const strippedFields = filterLocales(
              stripReferenceFields(cleanFieldsForCreate(entryData.fields)),
              allowedLocales
            );
            const newEntry = await environment.createEntry(info.contentType, { fields: strippedFields });
            globalRemap[entryId] = newEntry.sys.id;
            console.log(`    Recreated -> ${newEntry.sys.id}`);
            recreated++;
          } catch (createErr) {
            console.log(`    Recreate FAILED: ${createErr.message}`);
            failed++;
          }
        } else {
          console.log(` FAILED: ${err.message}`);
          failed++;
        }
      }

      await sleep(RATE_LIMIT_DELAY);
    }
  }

  // --force --update: also create entries not yet in remap
  if (unmappedEntries.length > 0) {
    const entries = unmappedEntries.map(id => {
      const info = entryMetadata[id];
      const data = loadEntryData(info.contentType, id);
      return { id, contentType: info.contentType, title: info.title, fields: data.fields, entryRefs: info.entryRefs };
    });

    console.log(`\nCreating ${entries.length} unmapped entries (force + update)...\n`);
    await createEntryShells(environment, entries, globalRemap, { allowedLocales, assetRemap });
    recreated += entries.filter(e => globalRemap[e.id]).length;
  }

  // Pass 2 for any recreated entries that have references
  const allProcessed = [...entriesToUpdate, ...unmappedEntries];
  const recreatedWithRefs = allProcessed.filter(id =>
    globalRemap[id] && entryMetadata[id].entryRefs.length > 0
  );

  if (recreatedWithRefs.length > 0 && recreated > 0) {
    const entries = recreatedWithRefs.map(id => {
      const info = entryMetadata[id];
      const data = loadEntryData(info.contentType, id);
      return { id, contentType: info.contentType, title: info.title, fields: data.fields, entryRefs: info.entryRefs };
    });
    await linkReferences(environment, entries, globalRemap, { allowedLocales, shouldPublish, assetRemap });
  }

  console.log(`\nUpdate complete. Updated: ${updated}, Recreated: ${recreated}${failed > 0 ? `, Failed: ${failed}` : ''}`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
