import { getEntries, updateEntry } from '../lib/contentful-client.js';
import { getDisplayTitle, applyPostFilters, sleep, RATE_LIMIT_DELAY } from '../lib/helpers.js';

function applyTransform(fields, t) {
  const changed = [];
  const pairs = t.field ? (fields[t.field] ? [[t.field, fields[t.field]]] : []) : Object.entries(fields);

  for (const [fn, lm] of pairs) {
    if (typeof lm !== 'object' || lm === null) continue;
    switch (t.rule) {
      case 'set':
        if (t.targetLocale && t.value !== undefined) { lm[t.targetLocale] = t.value; changed.push(fn); }
        break;
      case 'copy':
        if (t.sourceLocale && t.targetLocale && t.sourceLocale in lm) {
          let v = structuredClone(lm[t.sourceLocale]);
          if (typeof v === 'string') {
            if (t.prefix) v = t.prefix + v;
            if (t.suffix) v = v + t.suffix;
            if (t.replace) v = v.replace(new RegExp(t.replace.from, 'g'), t.replace.to);
          }
          lm[t.targetLocale] = v; changed.push(fn);
        }
        break;
      case 'delete':
        if (t.targetLocale && t.targetLocale in lm) { delete lm[t.targetLocale]; changed.push(fn); }
        break;
      case 'modify':
        if (t.targetLocale && t.targetLocale in lm) {
          let v = lm[t.targetLocale];
          if (typeof v === 'string') {
            if (t.replace) v = v.replace(new RegExp(t.replace.from, 'g'), t.replace.to);
            if (t.prefix) v = t.prefix + v;
            if (t.suffix) v = v + t.suffix;
            lm[t.targetLocale] = v; changed.push(fn);
          }
        }
        break;
    }
  }
  return changed;
}

export async function runTransform(token, spaceId, envId, contentType, transforms, filters, log) {
  log.info(`Querying ${contentType} entries...`);
  const res = await getEntries(token, spaceId, envId, { content_type: contentType, limit: 1000 });
  let items = res.items;
  log.info(`Found ${items.length} entries.`);

  items = applyPostFilters(items, filters, log);
  log.info(`After filters: ${items.length} entries.`);

  let updated = 0, skipped = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i], title = getDisplayTitle(entry.fields) || entry.sys.id, lbl = `[${i + 1}/${items.length}]`;
    const changed = [];
    for (const t of transforms) changed.push(...applyTransform(entry.fields, t));

    if (changed.length === 0) { log.info(`  ${lbl} ${title} — no changes`); skipped++; await sleep(RATE_LIMIT_DELAY); continue; }

    try {
      await updateEntry(token, spaceId, envId, entry.sys.id, entry.sys.version, entry.fields);
      log.success(`  ${lbl} ${title} — updated: ${changed.join(', ')}`);
      updated++;
    } catch (err) {
      log.error(`  ${lbl} ${title} — FAILED: ${err.message || err}`);
      failed++;
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  log.success(`\nTransform complete: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
  return { updated, skipped, failed };
}
