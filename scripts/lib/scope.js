/**
 * Unified scope resolution — resolves a scope definition to a list of entry IDs.
 * Used by run-transform.js and update-locale.js.
 *
 * Scope sources (pick one):
 *   - scope.entry / args.entries      Direct entry ID(s)
 *   - scope.extraction / args.name    All entries in an extraction manifest
 *   - scope.contentType / args.type   All entries of a content type (catalog or Contentful)
 *   - scope.query                     Contentful query (requires scope.contentType)
 *   - scope.all / args.all            Every entry in the local catalog
 *
 * Post-fetch filters (scope.filters, applied after Contentful query):
 *   - draft: true          Only entries without a published version
 *   - published: true      Only entries with a published version
 *   - updatedBy: "<id>"    Only entries last updated by this user ID ("me" = current token user)
 *   - createdBy: "<id>"    Only entries created by this user ID ("me" = current token user)
 *   - excludeArchived: bool  Exclude archived entries (default: true for Contentful queries)
 */

import { walkEntryTree } from './walker.js';
import { getCurrentUserId } from './client.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

export async function resolveScope(scope, { environment, storeDir, spaceAlias } = {}) {
  if (!scope) {
    console.error('Error: No scope provided.');
    process.exit(1);
  }

  const entriesDir = storeDir ? resolve(storeDir, 'entries') : null;
  const extractionsDir = storeDir ? resolve(storeDir, 'extractions') : null;
  const hasFilters = scope.filters && Object.keys(scope.filters).length > 0;

  // Single entry with optional depth walk
  if (scope.entry) {
    if (scope.depth !== undefined && scope.depth > 0 && environment) {
      console.log(`Walking entry ${scope.entry} to depth ${scope.depth}...`);
      const { dependencyOrder } = await walkEntryTree(environment, scope.entry, {
        maxDepth: scope.depth,
        skipTypes: scope.skipTypes || ['page'],
        onProgress(p, r) {
          process.stdout.write(`\r  Walked: ${p} entries | Queue: ${r} remaining`);
        },
      });
      console.log();
      return dependencyOrder;
    }
    return [scope.entry];
  }

  // Direct entry IDs list
  if (scope.entries) {
    return Array.isArray(scope.entries)
      ? scope.entries
      : scope.entries.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Extraction-based
  if (scope.extraction && extractionsDir) {
    const manifestPath = resolve(extractionsDir, `${scope.extraction}.json`);
    if (!existsSync(manifestPath)) {
      console.error(`Error: Extraction "${scope.extraction}" not found.`);
      process.exit(1);
    }
    const extraction = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    let ids = Object.keys(extraction.entries);
    if (scope.contentType) {
      ids = ids.filter(id => extraction.entries[id].contentType === scope.contentType);
    }
    return ids;
  }

  // Contentful query (requires contentType or query+contentType)
  if (scope.contentType && environment && (scope.query || hasFilters)) {
    return await queryContentful(scope, environment, spaceAlias);
  }

  // Content type from local catalog (fallback to Contentful query)
  if (scope.contentType && entriesDir) {
    const typeDir = resolve(entriesDir, scope.contentType);
    if (existsSync(typeDir)) {
      return readdirSync(typeDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    }
    if (environment) {
      return await queryContentful(scope, environment, spaceAlias);
    }
  }

  // All entries in local catalog
  if (scope.all && entriesDir) {
    const ids = [];
    if (existsSync(entriesDir)) {
      const types = readdirSync(entriesDir).filter(n => statSync(resolve(entriesDir, n)).isDirectory());
      for (const type of types) {
        const files = readdirSync(resolve(entriesDir, type)).filter(f => f.endsWith('.json'));
        for (const f of files) ids.push(f.replace('.json', ''));
      }
    }
    return ids;
  }

  return [];
}

/**
 * Query Contentful and apply post-fetch filters.
 * Excludes archived entries by default unless scope.filters.excludeArchived === false.
 */
async function queryContentful(scope, environment, spaceAlias) {
  const filters = scope.filters || {};
  const excludeArchived = filters.excludeArchived !== false;

  const queryParams = {
    content_type: scope.contentType,
    limit: 1000,
    ...(excludeArchived ? { 'sys.archivedAt[exists]': false } : {}),
    ...(scope.query || {}),
  };

  console.log(`Querying Contentful for ${scope.contentType} entries...`);
  const response = await environment.getEntries(queryParams);
  let items = response.items;
  console.log(`  Found ${items.length} entries from API.`);

  if (Object.keys(filters).length === 0) {
    return items.map(e => e.sys.id);
  }

  // Resolve "me" to actual user ID
  let currentUserId = null;
  if ((filters.updatedBy === 'me' || filters.createdBy === 'me') && spaceAlias) {
    currentUserId = await getCurrentUserId(spaceAlias);
    console.log(`  Resolved "me" → user ${currentUserId}`);
  }

  const beforeCount = items.length;

  if (filters.draft) {
    items = items.filter(e => !e.sys.publishedVersion);
  }
  if (filters.published) {
    items = items.filter(e => !!e.sys.publishedVersion);
  }
  if (filters.updatedBy) {
    const targetId = filters.updatedBy === 'me' ? currentUserId : filters.updatedBy;
    items = items.filter(e => e.sys.updatedBy?.sys?.id === targetId);
  }
  if (filters.createdBy) {
    const targetId = filters.createdBy === 'me' ? currentUserId : filters.createdBy;
    items = items.filter(e => e.sys.createdBy?.sys?.id === targetId);
  }

  if (items.length !== beforeCount) {
    console.log(`  After filters: ${items.length} entries (filtered ${beforeCount - items.length}).`);
  }

  return items.map(e => e.sys.id);
}

/**
 * Build a scope object from CLI args (for update-locale.js style args).
 * Maps --name, --type, --entries, --all to the unified scope format.
 */
export function scopeFromArgs(args) {
  if (args.entries) return { entries: args.entries.split(',').map(s => s.trim()).filter(Boolean) };
  if (args.name) return { extraction: args.name };
  if (args.type) return { contentType: args.type };
  if (args.all) return { all: true };
  return {};
}
