import { getEntry } from '../lib/contentful-client.js';
import { extractLinkReferences, getDisplayTitle, sleep, RATE_LIMIT_DELAY } from '../lib/helpers.js';

export async function runExtract(token, spaceId, envId, entryId, opts, log) {
  const { maxDepth = 1, skipTypes = ['page'] } = opts;
  const skipSet = new Set(skipTypes);
  const visited = new Set(), skipped = new Set();
  const queue = [{ id: entryId, depth: 0 }];
  const entries = {}, assetIds = new Set(), depOrder = [];

  log.info(`Walking entry tree from ${entryId} (depth ${maxDepth}, skip: ${skipTypes.join(', ') || 'none'})...`);

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id) || skipped.has(id)) continue;
    visited.add(id);

    let entry;
    try { entry = await getEntry(token, spaceId, envId, id); } catch (err) {
      if (String(err).includes('404')) { log.warn(`Entry ${id} not found, skipping.`); continue; }
      throw err;
    }

    const ct = entry.sys.contentType.sys.id;
    if (skipSet.has(ct) && id !== entryId) { visited.delete(id); skipped.add(id); continue; }

    const refs = extractLinkReferences(entry.fields);
    entries[id] = { id, contentType: ct, title: getDisplayTitle(entry.fields), fields: entry.fields, entryRefs: refs.entries, assetRefs: refs.assets };
    assetIds.add(...refs.assets);
    depOrder.push(id);

    log.info(`  [${depOrder.length}] ${ct}: ${entries[id].title || id}`);

    if (depth < maxDepth) {
      for (const cid of refs.entries) {
        if (!visited.has(cid) && !skipped.has(cid)) queue.push({ id: cid, depth: depth + 1 });
      }
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  log.success(`\nExtraction complete: ${depOrder.length} entries, ${assetIds.size} assets.`);
  return { entries, dependencyOrder: depOrder, assetIds: [...assetIds], rootTitle: entries[entryId]?.title || entryId };
}
