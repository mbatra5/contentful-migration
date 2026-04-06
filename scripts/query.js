// READ-ONLY: This script never modifies Contentful data.
// It fetches entries via CMA getEntry/getEntries and outputs structured JSON.

import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { RATE_LIMIT_DELAY, sleep, getEntryTitle } from './lib/helpers.js';
import { extractLinkReferences } from './lib/walker.js';

const JSON_ONLY = process.env.QUERY_JSON === '1';

function log(...args) {
  if (!JSON_ONLY) console.error(...args);
}

function deriveStatus(sys) {
  if (!sys.publishedVersion) return 'Draft';
  return sys.version === sys.publishedVersion + 1 ? 'Published' : 'Changed (draft)';
}

function buildLocaleCoverage(fields) {
  const coverage = {};
  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (typeof localeMap !== 'object' || localeMap === null) continue;
    for (const locale of Object.keys(localeMap)) {
      if (!coverage[locale]) coverage[locale] = [];
      coverage[locale].push(fieldName);
    }
  }
  return coverage;
}

function summarizeSys(sys) {
  return {
    id: sys.id,
    contentType: sys.contentType?.sys?.id || 'unknown',
    createdAt: sys.createdAt || null,
    firstPublishedAt: sys.firstPublishedAt || null,
    publishedAt: sys.publishedAt || null,
    updatedAt: sys.updatedAt || null,
    version: sys.version ?? null,
    publishedVersion: sys.publishedVersion ?? null,
    publishedCounter: sys.publishedCounter ?? null,
    status: deriveStatus(sys),
    createdBy: sys.createdBy?.sys?.id || null,
    updatedBy: sys.updatedBy?.sys?.id || null,
  };
}

function serializeFieldValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value.sys?.type === 'Link') {
    return { _link: true, linkType: value.sys.linkType, id: value.sys.id };
  }
  if (Array.isArray(value)) return value.map(serializeFieldValue);
  if (value.nodeType === 'document') return { _richText: true, preview: extractRichTextPreview(value) };
  return value;
}

function extractRichTextPreview(doc) {
  const texts = [];
  function walk(node) {
    if (node.nodeType === 'text' && node.value) texts.push(node.value);
    if (node.content) node.content.forEach(walk);
  }
  walk(doc);
  const joined = texts.join(' ');
  return joined.length > 200 ? joined.slice(0, 200) + '…' : joined;
}

function serializeFields(fields) {
  const result = {};
  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (typeof localeMap !== 'object' || localeMap === null) continue;
    result[fieldName] = {};
    for (const [locale, value] of Object.entries(localeMap)) {
      result[fieldName][locale] = serializeFieldValue(value);
    }
  }
  return result;
}

async function resolveReferences(refs, environment) {
  const resolved = { entries: [], assets: [] };

  const uniqueEntryIds = [...new Set(refs.entries)];
  const uniqueAssetIds = [...new Set(refs.assets)];

  for (const id of uniqueEntryIds) {
    try {
      const entry = await environment.getEntry(id);
      const title = getEntryTitle(entry.fields) || '(untitled)';
      resolved.entries.push({
        id,
        contentType: entry.sys.contentType?.sys?.id || 'unknown',
        title,
        status: deriveStatus(entry.sys),
      });
    } catch {
      resolved.entries.push({ id, contentType: 'unknown', title: '(not found)', status: 'error' });
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  for (const id of uniqueAssetIds) {
    try {
      const asset = await environment.getAsset(id);
      const title = asset.fields?.title
        ? Object.values(asset.fields.title)[0]
        : '(untitled)';
      const fileName = asset.fields?.file
        ? Object.values(asset.fields.file)[0]?.fileName
        : null;
      resolved.assets.push({ id, title, fileName });
    } catch {
      resolved.assets.push({ id, title: '(not found)', fileName: null });
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  return resolved;
}

// --- Entry mode: full dump of a single entry ---
async function queryEntry(entryId, environment, spaceConfig, spaceAlias, args) {
  log(`Fetching entry ${entryId}...`);

  let entry;
  try {
    entry = await environment.getEntry(entryId);
  } catch (err) {
    if (err?.sys?.id === 'NotFound' || err?.statusCode === 404
      || err?.message?.includes('404') || err?.details?.type === 'Entry') {
      return { error: `Entry ${entryId} not found in ${spaceAlias} (${spaceConfig.environmentId}).` };
    }
    throw err;
  }

  const refs = extractLinkReferences(entry.fields);
  log(`  Found ${refs.entries.length} entry refs, ${refs.assets.length} asset refs.`);

  const resolveRefs = args['no-resolve'] !== true;
  let resolvedRefs = null;
  if (resolveRefs && (refs.entries.length > 0 || refs.assets.length > 0)) {
    log(`  Resolving references...`);
    resolvedRefs = await resolveReferences(refs, environment);
  }

  const result = {
    mode: 'entry',
    space: spaceAlias,
    environment: spaceConfig.environmentId,
    sys: summarizeSys(entry.sys),
    fields: serializeFields(entry.fields),
    localeCoverage: buildLocaleCoverage(entry.fields),
    references: {
      entryCount: refs.entries.length,
      assetCount: refs.assets.length,
      ...(resolvedRefs ? { entries: resolvedRefs.entries, assets: resolvedRefs.assets } : {}),
    },
  };

  if (args.field) {
    const fieldName = args.field;
    const locale = args.locale;
    const fieldData = entry.fields[fieldName];
    if (!fieldData) {
      result.fieldQuery = { field: fieldName, locale: locale || null, found: false, value: null };
    } else if (locale) {
      result.fieldQuery = {
        field: fieldName,
        locale,
        found: locale in fieldData,
        value: locale in fieldData ? serializeFieldValue(fieldData[locale]) : null,
        availableLocales: Object.keys(fieldData),
      };
    } else {
      result.fieldQuery = {
        field: fieldName,
        locale: null,
        found: true,
        value: Object.fromEntries(
          Object.entries(fieldData).map(([loc, val]) => [loc, serializeFieldValue(val)])
        ),
      };
    }
  }

  return result;
}

// --- Search mode: query by content type + filters ---
async function querySearch(contentType, environment, spaceConfig, spaceAlias, args) {
  const queryParams = {
    content_type: contentType,
    limit: 1000,
    'sys.archivedAt[exists]': false,
  };

  if (args.match && args.field) {
    queryParams[`fields.${args.field}[match]`] = args.match;
  }
  if (args.query) {
    try {
      const extra = JSON.parse(args.query);
      Object.assign(queryParams, extra);
    } catch {
      return { error: `Invalid --query JSON: ${args.query}` };
    }
  }

  log(`Querying ${contentType} entries...`);
  const response = await environment.getEntries(queryParams);
  const items = response.items;
  log(`  Found ${items.length} entries (total: ${response.total}).`);

  const countOnly = args.count === true;
  if (countOnly) {
    return {
      mode: 'count',
      space: spaceAlias,
      environment: spaceConfig.environmentId,
      contentType,
      total: response.total,
      returned: items.length,
    };
  }

  const locale = args.locale;
  const fieldName = args.field;

  const entries = items.map(item => {
    const title = getEntryTitle(item.fields) || '(untitled)';
    const summary = {
      id: item.sys.id,
      contentType: item.sys.contentType?.sys?.id,
      title,
      status: deriveStatus(item.sys),
      createdAt: item.sys.createdAt,
      firstPublishedAt: item.sys.firstPublishedAt || null,
      updatedAt: item.sys.updatedAt,
    };

    if (fieldName) {
      const fieldData = item.fields[fieldName];
      if (locale && fieldData) {
        summary.fieldValue = { [fieldName]: { [locale]: serializeFieldValue(fieldData[locale] ?? null) } };
        summary.hasLocale = locale in (fieldData || {});
      } else if (fieldData) {
        summary.fieldValue = {
          [fieldName]: Object.fromEntries(
            Object.entries(fieldData).map(([loc, val]) => [loc, serializeFieldValue(val)])
          ),
        };
      } else {
        summary.fieldValue = { [fieldName]: null };
      }
    }

    return summary;
  });

  const result = {
    mode: 'search',
    space: spaceAlias,
    environment: spaceConfig.environmentId,
    contentType,
    total: response.total,
    returned: items.length,
    entries,
  };

  if (fieldName && locale) {
    result.filter = { field: fieldName, locale, match: args.match || null };
    result.localeStats = {
      withLocale: entries.filter(e => e.hasLocale).length,
      withoutLocale: entries.filter(e => !e.hasLocale).length,
    };
  }

  return result;
}

// --- Children mode: entry + its direct linked entries summarized ---
async function queryChildren(entryId, environment, spaceConfig, spaceAlias) {
  log(`Fetching entry ${entryId} + children...`);

  let entry;
  try {
    entry = await environment.getEntry(entryId);
  } catch (err) {
    if (err?.sys?.id === 'NotFound' || err?.statusCode === 404
      || err?.message?.includes('404')) {
      return { error: `Entry ${entryId} not found in ${spaceAlias}.` };
    }
    throw err;
  }

  const title = getEntryTitle(entry.fields) || '(untitled)';
  const refs = extractLinkReferences(entry.fields);

  log(`  Resolving ${refs.entries.length} child entries...`);
  const children = [];
  const byType = {};

  for (const childId of [...new Set(refs.entries)]) {
    try {
      const child = await environment.getEntry(childId);
      const ct = child.sys.contentType?.sys?.id || 'unknown';
      const childTitle = getEntryTitle(child.fields) || '(untitled)';
      children.push({ id: childId, contentType: ct, title: childTitle, status: deriveStatus(child.sys) });
      byType[ct] = (byType[ct] || 0) + 1;
    } catch {
      children.push({ id: childId, contentType: 'unknown', title: '(not found)', status: 'error' });
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  return {
    mode: 'children',
    space: spaceAlias,
    environment: spaceConfig.environmentId,
    parent: {
      id: entryId,
      contentType: entry.sys.contentType?.sys?.id,
      title,
      status: deriveStatus(entry.sys),
    },
    children,
    childrenByType: byType,
    totalChildren: children.length,
    totalAssetRefs: refs.assets.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.entry && !args.type) {
    const usage = [
      'Usage:',
      '',
      '  Entry mode (full dump):',
      '    npm run query -- --entry <id> [--space <alias>]',
      '    npm run query -- --entry <id> --field entryName --locale en-IN',
      '    npm run query -- --entry <id> --no-resolve',
      '',
      '  Children mode:',
      '    npm run query -- --entry <id> --children',
      '',
      '  Search mode:',
      '    npm run query -- --type <contentType> [--count]',
      '    npm run query -- --type <contentType> --field entryName --locale en-IN',
      '    npm run query -- --type <contentType> --field entryName --match "Hero-IN"',
      '    npm run query -- --type <contentType> --query \'{"fields.slug[match]":"news"}\'',
      '',
      '  Options:',
      '    --space        Space alias (default: source)',
      '    --field        Filter to a specific field name',
      '    --locale       Filter to a specific locale',
      '    --match        Match field value (requires --field)',
      '    --count        Return count only (search mode)',
      '    --children     Show linked child entries (entry mode)',
      '    --no-resolve   Skip resolving references (faster)',
      '    --query        Extra Contentful query params as JSON',
    ];
    console.error(usage.join('\n'));
    process.exit(1);
  }

  const spaceAlias = args.space || 'source';
  const spaceConfig = getSpaceConfig(spaceAlias);
  const environment = await getEnvironment(spaceAlias);

  let result;

  if (args.entry && args.children) {
    result = await queryChildren(args.entry, environment, spaceConfig, spaceAlias);
  } else if (args.entry) {
    result = await queryEntry(args.entry, environment, spaceConfig, spaceAlias, args);
  } else if (args.type) {
    result = await querySearch(args.type, environment, spaceConfig, spaceAlias, args);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  const output = { error: err.message };
  if (JSON_ONLY) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.error('\nError:', err.message);
  }
  process.exit(1);
});
