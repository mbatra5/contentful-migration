/**
 * Taxonomy Inspector — view taxonomy concepts assigned to an entry.
 *
 * Usage:
 *   npm run taxonomy -- --entry <id>                   Show concepts for an entry
 *   npm run taxonomy -- --entry <id> --space target     Inspect in a specific space
 *   npm run taxonomy -- --list                          List all taxonomy collections + concepts
 *   npm run taxonomy -- --list --tree                   Show full hierarchy tree
 */

import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { getEntryTitle } from './lib/helpers.js';
import {
  fetchAllConcepts,
  fetchConceptSchemes,
  resolveEntryConcepts,
  getEntryConceptIds,
  getConceptLabel,
  buildConceptTree,
} from './lib/taxonomy.js';

function getToken(alias) {
  const space = getSpaceConfig(alias);
  const token = process.env[space.tokenEnvVar];
  if (!token) throw new Error(`Token not found. Set ${space.tokenEnvVar} in .env`);
  return token;
}

// ── Entry mode: show taxonomy concepts for a single entry ──────────────

async function showEntryTaxonomy(entryId, spaceAlias) {
  const spaceConfig = getSpaceConfig(spaceAlias);
  const env = await getEnvironment(spaceAlias);
  const token = getToken(spaceAlias);

  let entry;
  try {
    entry = await env.getEntry(entryId);
  } catch (err) {
    if (err?.sys?.id === 'NotFound' || err?.statusCode === 404
      || err?.message?.includes('404')) {
      console.error(`  Entry ${entryId} not found in ${spaceAlias}.`);
      process.exit(1);
    }
    throw err;
  }

  const title = getEntryTitle(entry.fields) || '(untitled)';
  const contentType = entry.sys.contentType?.sys?.id || 'unknown';

  console.log(`\nTaxonomy Inspector`);
  console.log(`━━━━━━━━━━━━━━━━━━\n`);
  console.log(`  Entry ID:       ${entry.sys.id}`);
  console.log(`  Entry Name:     ${title}`);
  console.log(`  Content Type:   ${contentType}`);
  console.log(`  Space:          ${spaceConfig.spaceId} (${spaceAlias})\n`);

  const conceptIds = getEntryConceptIds(entry);

  if (conceptIds.length === 0) {
    console.log(`  Taxonomy:       No concepts assigned\n`);
    return;
  }

  console.log(`  Concepts:       ${conceptIds.length} assigned\n`);

  // Resolve each concept with its collection/parent info
  const resolved = await resolveEntryConcepts(entry, token);

  // Group by collection
  const byCollection = {};
  for (const concept of resolved) {
    const collKey = concept.collection?.label || '(No collection)';
    if (!byCollection[collKey]) byCollection[collKey] = [];
    byCollection[collKey].push(concept);
  }

  for (const [collLabel, concepts] of Object.entries(byCollection)) {
    console.log(`  ┌─ ${collLabel}`);
    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i];
      const isLast = i === concepts.length - 1;
      const prefix = isLast ? '  └──' : '  ├──';
      console.log(`${prefix} ${c.label}  (id: ${c.id})`);
    }
    console.log();
  }

  // Raw metadata JSON for reference
  console.log(`  Raw metadata.concepts:`);
  console.log(`  ${JSON.stringify(entry.metadata.concepts, null, 2).split('\n').join('\n  ')}`);
  console.log();
}

// ── List mode: show all taxonomy collections and concepts ──────────────

async function listAllTaxonomy(spaceAlias, showTree) {
  const token = getToken(spaceAlias);

  console.log(`\nTaxonomy Inspector — All Concepts`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Fetch schemes
  const schemes = await fetchConceptSchemes(token);
  console.log(`  Concept Schemes: ${schemes.length}`);
  for (const s of schemes) {
    const label = s.prefLabel?.en || s.prefLabel?.['en-US'] || s.sys.id;
    console.log(`    • ${label}  (id: ${s.sys.id}, concepts: ${s.totalConcepts})\n`);
  }

  // Fetch all concepts
  const allConcepts = await fetchAllConcepts(token);
  console.log(`  Total Concepts:  ${allConcepts.size}\n`);

  if (showTree) {
    // Show full tree
    const tree = buildConceptTree(allConcepts);
    for (const [rootId, root] of Object.entries(tree)) {
      printTreeNode(root.label, root.children, '', true);
      console.log();
    }
  } else {
    // Flat grouped view
    const tree = buildConceptTree(allConcepts);
    for (const [rootId, root] of Object.entries(tree)) {
      const childCount = countDescendants(root);
      console.log(`  ┌─ ${root.label}  (${childCount} concepts)`);
      for (let i = 0; i < root.children.length; i++) {
        const child = root.children[i];
        const isLast = i === root.children.length - 1;
        const prefix = isLast ? '  └──' : '  ├──';
        const subCount = child.children.length > 0 ? ` (+${countDescendants(child)} sub)` : '';
        console.log(`${prefix} ${child.label}${subCount}  (${child.id})`);
      }
      console.log();
    }
  }
}

function countDescendants(node) {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}

function printTreeNode(label, children, indent, isRoot) {
  if (isRoot) {
    console.log(`${indent}📂 ${label}`);
  }
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isLast = i === children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childIndent = indent + (isLast ? '    ' : '│   ');
    console.log(`${indent}${connector}${child.label}  (${child.id})`);
    if (child.children.length > 0) {
      printTreeNode(child.label, child.children, childIndent, false);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.entry && !args.list) {
    console.error('Usage:');
    console.error('  npm run taxonomy -- --entry <id>               Show concepts for an entry');
    console.error('  npm run taxonomy -- --entry <id> --space target Inspect in a specific space');
    console.error('  npm run taxonomy -- --list                     List all collections + concepts');
    console.error('  npm run taxonomy -- --list --tree               Show full hierarchy tree');
    process.exit(1);
  }

  const spaceAlias = args.space || 'source';

  if (args.list) {
    await listAllTaxonomy(spaceAlias, args.tree === true);
  } else {
    await showEntryTaxonomy(args.entry, spaceAlias);
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
