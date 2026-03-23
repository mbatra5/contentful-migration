import { getEntry, getEntries, getAsset, updateEntry } from '../lib/contentful-client.js';
import { getDisplayTitle, applyPostFilters, sleep, RATE_LIMIT_DELAY } from '../lib/helpers.js';

async function findBrokenAssetLinks(token, spaceId, envId, fields) {
  const broken = [];
  for (const [fn, lm] of Object.entries(fields)) {
    if (!lm || typeof lm !== 'object') continue;
    for (const [locale, value] of Object.entries(lm)) {
      if (!value || typeof value !== 'object' || !value.sys || value.sys.type !== 'Link') continue;

      if (value.sys.linkType === 'Asset') {
        try {
          const a = await getAsset(token, spaceId, envId, value.sys.id);
          const ff = a.fields?.file;
          if (!ff) { broken.push({ field: fn, locale, reason: 'no file field' }); continue; }
          const lk = Object.keys(ff);
          const f = lk.length > 0 ? ff[lk[0]] : null;
          if (!f || !f.url) broken.push({ field: fn, locale, reason: 'empty/no URL' });
        } catch {
          broken.push({ field: fn, locale, reason: '404 / not found' });
        }
        await sleep(100);
      }

      if (value.sys.linkType === 'Entry') {
        try { await getEntry(token, spaceId, envId, value.sys.id); } catch {
          broken.push({ field: fn, locale, reason: 'linked entry not found' });
        }
        await sleep(100);
      }
    }
  }
  return broken;
}

export async function runFixBrokenAssets(token, spaceId, envId, contentType, replacementEntryId, filters, log) {
  log.info(`Fetching replacement entry ${replacementEntryId}...`);
  let re;
  try { re = await getEntry(token, spaceId, envId, replacementEntryId); } catch {
    log.error(`Replacement entry ${replacementEntryId} not found.`);
    return { checked: 0, fixed: 0, skipped: 0, failed: 0 };
  }
  log.info(`Replacement: "${re.sys.contentType.sys.id}": ${getDisplayTitle(re.fields) || replacementEntryId}`);

  log.info(`\nQuerying ${contentType} entries...`);
  const res = await getEntries(token, spaceId, envId, { content_type: contentType, limit: 1000 });
  let items = res.items;
  log.info(`Found ${items.length} entries.`);

  items = applyPostFilters(items, filters, log);
  log.info(`After filters: ${items.length} entries to check.\n`);

  let checked = 0, fixed = 0, skipped = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i], title = getDisplayTitle(entry.fields) || entry.sys.id, lbl = `[${i + 1}/${items.length}]`;
    checked++;

    const brk = await findBrokenAssetLinks(token, spaceId, envId, entry.fields);
    if (brk.length === 0) { log.info(`  ${lbl} ${title} — all assets OK`); skipped++; await sleep(RATE_LIMIT_DELAY); continue; }

    log.warn(`  ${lbl} ${title} — ${brk.length} broken: ${brk.map(b => b.field).join(', ')}`);
    let changed = false;
    for (const { field, locale } of brk) {
      if (entry.fields[field]?.[locale]) {
        entry.fields[field][locale] = { sys: { type: 'Link', linkType: 'Entry', id: replacementEntryId } };
        changed = true;
      }
    }
    if (!changed) { skipped++; await sleep(RATE_LIMIT_DELAY); continue; }

    try {
      await updateEntry(token, spaceId, envId, entry.sys.id, entry.sys.version, entry.fields);
      log.success(`  ${lbl} ${title} — fixed ${brk.length} field(s)`);
      fixed++;
    } catch (err) {
      log.error(`  ${lbl} ${title} — FAILED: ${err.message || err}`);
      failed++;
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  log.success(`\nDone: checked ${checked}, fixed ${fixed}, skipped ${skipped}, failed ${failed}.`);
  return { checked, fixed, skipped, failed };
}
