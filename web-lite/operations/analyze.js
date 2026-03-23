import { getEntry } from '../lib/contentful-client.js';
import { extractLinkReferences, getDisplayTitle, sleep, RATE_LIMIT_DELAY } from '../lib/helpers.js';

export async function runAnalyze(token, spaceId, envId, entryId, opts, log) {
  const { maxDepth = 1, skipTypes = ['page'] } = opts;
  const skipSet = new Set(skipTypes);
  const visited = new Set(), skipped = new Set();
  const queue = [{ id: entryId, depth: 0 }];
  const analyzed = [], assetIds = new Set(), ctCounts = {};
  let maxD = 0;

  log.info(`Analyzing entry tree from ${entryId} (depth ${maxDepth}, skip: ${skipTypes.join(', ') || 'none'})...`);

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id) || skipped.has(id)) continue;
    visited.add(id);

    let entry;
    try { entry = await getEntry(token, spaceId, envId, id); } catch (err) {
      if (String(err).includes('404')) { log.warn(`  Entry ${id} not found, skipping.`); continue; }
      throw err;
    }

    const ct = entry.sys.contentType.sys.id;
    if (skipSet.has(ct) && id !== entryId) { visited.delete(id); skipped.add(id); continue; }

    const refs = extractLinkReferences(entry.fields);
    const title = getDisplayTitle(entry.fields);
    analyzed.push({ id, contentType: ct, title, depth, refCount: refs.entries.length, assetCount: refs.assets.length });
    ctCounts[ct] = (ctCounts[ct] || 0) + 1;
    refs.assets.forEach(a => assetIds.add(a));
    if (depth > maxD) maxD = depth;

    log.info(`  [${analyzed.length}] ${'  '.repeat(depth)}${ct}: ${title || id} (${refs.entries.length} refs, ${refs.assets.length} assets)`);

    if (depth < maxDepth) {
      for (const cid of refs.entries) {
        if (!visited.has(cid) && !skipped.has(cid)) queue.push({ id: cid, depth: depth + 1 });
      }
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  log.success(`\nAnalysis complete: ${analyzed.length} entries, ${assetIds.size} assets, ${Object.keys(ctCounts).length} content types.`);
  if (skipped.size > 0) log.info(`Skipped ${skipped.size} entries (type filter).`);

  return {
    entries: analyzed,
    totalEntries: analyzed.length,
    totalAssets: assetIds.size,
    contentTypeCounts: ctCounts,
    maxDepthReached: maxD,
    rootTitle: analyzed[0]?.title || entryId,
  };
}
