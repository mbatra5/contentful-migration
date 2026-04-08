/**
 * Taxonomy helpers — resolve concept IDs to labels, collections, and hierarchy.
 *
 * Contentful taxonomy concepts live at the organization level, not inside a space.
 * They're stored on entries in `entry.metadata.concepts` as TaxonomyConcept links.
 *
 * API base: GET /organizations/{orgId}/taxonomy/concepts[/{id}]
 * API base: GET /organizations/{orgId}/taxonomy/concept-schemes
 */

import contentfulManagement from 'contentful-management';
import { getSpaceConfig } from './client.js';
import 'dotenv/config';

const ORG_ID = '18tjDnAnlLyLxa98utIUPY';

// In-memory cache for resolved concepts (keyed by concept ID)
const conceptCache = {};

/**
 * Get the CMA token for a given space alias.
 */
function getToken(alias) {
  const space = getSpaceConfig(alias);
  const token = process.env[space.tokenEnvVar];
  if (!token) throw new Error(`Token not found for ${alias}. Set ${space.tokenEnvVar} in .env`);
  return token;
}

/**
 * Fetch a single taxonomy concept by ID from the org-level API.
 * Results are cached in-memory.
 */
export async function fetchConcept(conceptId, token) {
  if (conceptCache[conceptId]) return conceptCache[conceptId];

  const res = await fetch(
    `https://api.contentful.com/organizations/${ORG_ID}/taxonomy/concepts/${conceptId}`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch concept ${conceptId}: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  conceptCache[conceptId] = data;
  return data;
}

/**
 * Fetch ALL taxonomy concepts from the org. Returns a Map of id → concept.
 * Handles pagination (Contentful returns max 100 per request, uses pageNext cursor).
 */
export async function fetchAllConcepts(token) {
  const BASE = `https://api.contentful.com/organizations/${ORG_ID}/taxonomy/concepts`;
  const all = new Map();
  let url = `${BASE}?limit=100`;

  while (url) {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Failed to fetch concepts: ${res.status}`);

    const data = await res.json();
    for (const c of data.items || []) {
      all.set(c.sys.id, c);
      conceptCache[c.sys.id] = c;
    }

    // Contentful taxonomy uses cursor-based pagination via `pages.next`
    // The next URL can be relative — normalize it to absolute
    if (data.pages?.next) {
      const next = data.pages.next;
      url = next.startsWith('http') ? next : `https://api.contentful.com${next}`;
    } else {
      url = null;
    }
  }

  return all;
}

/**
 * Fetch all concept schemes from the org.
 */
export async function fetchConceptSchemes(token) {
  const res = await fetch(
    `https://api.contentful.com/organizations/${ORG_ID}/taxonomy/concept-schemes?limit=100`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  if (!res.ok) throw new Error(`Failed to fetch concept schemes: ${res.status}`);

  const data = await res.json();
  return data.items || [];
}

/**
 * Get the preferred label (en → en-US fallback) for a concept.
 */
export function getConceptLabel(concept) {
  return concept.prefLabel?.en || concept.prefLabel?.['en-US'] || concept.sys.id;
}

/**
 * Extract an entry's assigned taxonomy concept IDs from its metadata.
 * Returns an array of concept ID strings.
 */
export function getEntryConceptIds(entry) {
  const concepts = entry.metadata?.concepts;
  if (!Array.isArray(concepts) || concepts.length === 0) return [];
  return concepts
    .filter(c => c?.sys?.linkType === 'TaxonomyConcept')
    .map(c => c.sys.id);
}

/**
 * Resolve an entry's taxonomy concepts to rich objects with labels and collection info.
 *
 * Returns: [{
 *   id, label, definition,
 *   collection: { id, label },   // the parent collection (broader) this concept belongs to
 *   scheme: { id, label },       // the concept scheme
 * }]
 */
export async function resolveEntryConcepts(entry, token) {
  const conceptIds = getEntryConceptIds(entry);
  if (conceptIds.length === 0) return [];

  const resolved = [];

  for (const id of conceptIds) {
    const concept = await fetchConcept(id, token);
    const label = getConceptLabel(concept);
    const definition = concept.definition?.en || concept.definition?.['en-US'] || null;

    // Resolve the parent collection (broader)
    let collection = null;
    if (concept.broader?.length > 0) {
      const parentId = concept.broader[0].sys.id;
      try {
        const parent = await fetchConcept(parentId, token);
        collection = { id: parentId, label: getConceptLabel(parent) };
      } catch {
        collection = { id: parentId, label: parentId };
      }
    }

    // Scheme info
    let scheme = null;
    if (concept.conceptSchemes?.length > 0) {
      scheme = { id: concept.conceptSchemes[0].sys.id };
    }

    resolved.push({ id, label, definition, collection, scheme });
  }

  return resolved;
}

/**
 * Build a tree structure from all concepts, grouped by collection.
 * Returns: { collectionId: { label, children: [{ id, label, children: [...] }] } }
 */
export function buildConceptTree(allConcepts) {
  const tree = {};

  // First pass: identify root collections (no broader parent)
  for (const [id, concept] of allConcepts) {
    if (!concept.broader || concept.broader.length === 0) {
      tree[id] = {
        label: getConceptLabel(concept),
        children: [],
      };
    }
  }

  // Second pass: attach children to their parent
  // We do multiple passes to handle nesting (e.g. Region → Europe → UK → Teesside)
  const assigned = new Set(Object.keys(tree));
  const remaining = [...allConcepts.entries()].filter(([id]) => !assigned.has(id));

  function attachChildren(parentId, parentNode) {
    const children = remaining.filter(([, c]) => c.broader?.[0]?.sys?.id === parentId);
    for (const [childId, childConcept] of children) {
      const childNode = {
        id: childId,
        label: getConceptLabel(childConcept),
        children: [],
      };
      parentNode.children.push(childNode);
      assigned.add(childId);
      attachChildren(childId, childNode);
    }
    // Sort children alphabetically
    parentNode.children.sort((a, b) => a.label.localeCompare(b.label));
  }

  for (const [rootId, rootNode] of Object.entries(tree)) {
    attachChildren(rootId, rootNode);
  }

  return tree;
}
