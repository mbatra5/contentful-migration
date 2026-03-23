import { getEntry, getLocales, createEntry, updateEntry, publishEntry } from '../lib/contentful-client.js';
import { stripReferenceFields, remapFields, filterLocales, sleep, RATE_LIMIT_DELAY } from '../lib/helpers.js';

export async function runCreate(token, extraction, target, opts, log) {
  const { entries, dependencyOrder: depOrder } = extraction;
  const { spaceId: ts, envId: te } = target;

  if (depOrder.length === 0) {
    log.warn('No entries to create.');
    return { created: 0, skipped: 0, failed: 0, remap: {} };
  }

  log.info('Connecting to target...');
  const locales = new Set(await getLocales(token, ts, te));
  log.info(`Target locales: ${[...locales].join(', ')}`);

  const remap = {};
  let created = 0, skipped = 0, failed = 0;

  log.info(`\nPass 1: Creating ${depOrder.length} entry shells...`);
  for (let i = 0; i < depOrder.length; i++) {
    const id = depOrder[i], e = entries[id], lbl = `[${i + 1}/${depOrder.length}]`;
    try {
      const ne = await createEntry(token, ts, te, e.contentType, filterLocales(stripReferenceFields(e.fields), locales));
      remap[id] = ne.sys.id;
      log.success(`  ${lbl} ${e.contentType}: ${e.title || id} -> ${ne.sys.id}`);
      created++;
    } catch (err) {
      log.error(`  ${lbl} ${e.contentType}: ${e.title || id} FAILED: ${err.message || err}`);
      failed++;
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  const withRefs = depOrder.filter(id => remap[id] && entries[id].entryRefs.length > 0);
  if (withRefs.length > 0) {
    log.info(`\nPass 2: Linking references for ${withRefs.length} entries...`);
    for (let i = 0; i < withRefs.length; i++) {
      const id = withRefs[i], e = entries[id], tid = remap[id], lbl = `[${i + 1}/${withRefs.length}]`;
      try {
        const te2 = await getEntry(token, ts, te, tid);
        await updateEntry(token, ts, te, tid, te2.sys.version, filterLocales(remapFields(e.fields, remap), locales));
        log.success(`  ${lbl} ${e.contentType}: ${e.title || id} linked (${e.entryRefs.length} refs)`);
      } catch (err) {
        log.error(`  ${lbl} Linking failed: ${err.message || err}`);
      }
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  if (opts.publish) {
    log.info(`\nPublishing ${created} entries...`);
    for (const tid of Object.values(remap)) {
      try {
        const pe = await getEntry(token, ts, te, tid);
        await publishEntry(token, ts, te, tid, pe.sys.version);
      } catch { /* skip publish failures */ }
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  log.success(`\nCreate complete: ${created} created, ${skipped} skipped, ${failed} failed.`);
  return { created, skipped, failed, remap };
}
