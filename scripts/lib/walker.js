/**
 * BFS walker that discovers all entries linked from a root entry.
 * Handles any nesting depth and circular references via visited set.
 */

export function extractLinkReferences(fields) {
  const refs = { entries: [], assets: [] };

  function walk(value) {
    if (!value || typeof value !== 'object') return;

    if (value.sys?.type === 'Link') {
      if (value.sys.linkType === 'Entry') {
        refs.entries.push(value.sys.id);
      } else if (value.sys.linkType === 'Asset') {
        refs.assets.push(value.sys.id);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    for (const v of Object.values(value)) {
      walk(v);
    }
  }

  walk(fields);
  return refs;
}

function getDisplayTitle(fields) {
  const titleFields = ['entryName', 'title', 'name', 'internalName', 'heading', 'label', 'slug', 'quote', 'profileName'];
  for (const key of titleFields) {
    if (!fields[key]) continue;
    const locales = Object.keys(fields[key]);
    if (locales.length > 0 && typeof fields[key][locales[0]] === 'string') {
      return fields[key][locales[0]];
    }
  }
  return null;
}

export async function walkEntryTree(environment, rootEntryId, { onProgress, skipTypes = [], maxDepth = Infinity } = {}) {
  const visited = new Set();
  const skipped = new Map();
  const depthCapped = new Map();
  const queue = [{ id: rootEntryId, depth: 0 }];
  const graph = {};
  const entryData = {};
  const assetIds = new Set();
  const skipSet = new Set(skipTypes);
  let processed = 0;

  while (queue.length > 0) {
    const { id: entryId, depth } = queue.shift();
    if (visited.has(entryId) || skipped.has(entryId)) continue;
    visited.add(entryId);

    let entry;
    try {
      entry = await environment.getEntry(entryId);
    } catch (err) {
      if (err.message?.includes('NotFound') || err.name === 'NotFound') {
        console.warn(`  Warning: Entry ${entryId} not found (may be deleted or in another env), skipping.`);
        continue;
      }
      throw err;
    }

    const contentType = entry.sys.contentType.sys.id;

    if (skipSet.has(contentType) && entryId !== rootEntryId) {
      visited.delete(entryId);
      skipped.set(entryId, contentType);
      continue;
    }

    const refs = extractLinkReferences(entry.fields);
    const title = getDisplayTitle(entry.fields);

    graph[entryId] = refs.entries;
    entryData[entryId] = {
      contentType,
      title,
      entryRefs: refs.entries,
      assetRefs: refs.assets,
      fields: entry.fields,
      sys: {
        id: entry.sys.id,
        contentType: entry.sys.contentType,
        createdAt: entry.sys.createdAt,
        updatedAt: entry.sys.updatedAt,
      },
    };

    for (const assetId of refs.assets) {
      assetIds.add(assetId);
    }

    if (depth < maxDepth) {
      for (const refId of refs.entries) {
        if (!visited.has(refId) && !skipped.has(refId)) {
          queue.push({ id: refId, depth: depth + 1 });
        }
      }
    } else {
      for (const refId of refs.entries) {
        if (!visited.has(refId) && !skipped.has(refId)) {
          depthCapped.set(refId, depth + 1);
        }
      }
    }

    processed++;
    if (onProgress) onProgress(processed, queue.length);
  }

  const dependencyOrder = topologicalSort(graph);

  return { graph, entryData, assetIds: [...assetIds], dependencyOrder, skipped, depthCapped };
}

/**
 * Topological sort with cycle detection. Returns entries ordered so that
 * dependencies come before dependents (leaf nodes first).
 */
function topologicalSort(graph) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(node) {
    if (visited.has(node)) return;
    if (visiting.has(node)) return; // cycle detected — break it
    visiting.add(node);
    for (const dep of (graph[node] || [])) {
      if (graph[dep] !== undefined) {
        visit(dep);
      }
    }
    visiting.delete(node);
    visited.add(node);
    sorted.push(node);
  }

  for (const node of Object.keys(graph)) {
    visit(node);
  }

  return sorted;
}
