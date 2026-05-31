import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { RATE_LIMIT_DELAY, sleep, getEntryTitle } from './lib/helpers.js';

function deriveStatus(sys) {
  if (!sys.publishedVersion) return 'Draft';
  return sys.version === sys.publishedVersion + 1 ? 'Published' : 'Changed (draft)';
}

// BCP-47 locale prefix detection: en, en-IN, zh-CN, fr, de, etc.
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

function parsePageUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  // Strip a leading locale segment if present
  const pathSegments = (segments.length > 0 && LOCALE_RE.test(segments[0]))
    ? segments.slice(1)
    : segments;
  return {
    leafSlug: pathSegments[pathSegments.length - 1],
    ancestorSlugs: pathSegments.slice(0, -1), // root → immediate parent
  };
}

function getSlugValue(entry) {
  const slugField = entry.fields?.slug;
  if (!slugField) return null;
  return Object.values(slugField)[0] ?? null;
}

async function getParent(entryId, env) {
  const res = await env.getEntries({
    links_to_entry: entryId,
    content_type: 'page',
    limit: 10,
  });
  await sleep(RATE_LIMIT_DELAY);
  return res.items[0] ?? null;
}

// Walk UP the parent chain and verify slugs match expectedAncestors (root→parent order).
async function verifyAncestors(entry, expectedAncestors, env) {
  let current = entry;
  for (let i = expectedAncestors.length - 1; i >= 0; i--) {
    const parent = await getParent(current.sys.id, env);
    if (!parent) return false;
    if (getSlugValue(parent) !== expectedAncestors[i]) return false;
    current = parent;
  }
  return true;
}

async function resolveByUrl(rawUrl, env, spaceConfig, spaceAlias) {
  const { leafSlug, ancestorSlugs } = parsePageUrl(rawUrl);

  console.log(`  Parsed path:  /${[...ancestorSlugs, leafSlug].join('/')}`);
  console.log(`  Leaf slug:    ${leafSlug}`);
  if (ancestorSlugs.length > 0) {
    console.log(`  Ancestors:    ${ancestorSlugs.join(' → ')}`);
  }
  console.log();

  // Step 1 — fetch all pages sharing the leaf slug
  let response;
  try {
    response = await env.getEntries({
      content_type: 'page',
      'fields.slug': leafSlug,
      limit: 200,
    });
  } catch (err) {
    console.error(`Error querying Contentful: ${err.message}`);
    process.exit(1);
  }
  await sleep(RATE_LIMIT_DELAY);

  // Exact client-side slug match (CMA tokenises on dashes)
  const candidates = response.items.filter(e => {
    const slugField = e.fields?.slug;
    if (!slugField) return false;
    return Object.values(slugField).some(v => v === leafSlug);
  });

  if (candidates.length === 0) {
    console.error(`  No page found with slug "${leafSlug}" in ${spaceAlias} (${spaceConfig.environmentId}).`);
    process.exit(1);
  }

  // If no ancestors in URL or only one candidate, skip ancestor walk
  if (ancestorSlugs.length === 0 || candidates.length === 1) {
    return candidates;
  }

  // Step 2 — verify ancestor chain for each candidate
  console.log(`  Verifying ancestor chain for ${candidates.length} slug matches...\n`);
  const matched = [];
  for (const candidate of candidates) {
    const title = getEntryTitle(candidate.fields) || '(untitled)';
    process.stdout.write(`  Checking "${title}" (${candidate.sys.id})...`);
    const ok = await verifyAncestors(candidate, ancestorSlugs, env);
    console.log(ok ? ' ✓ matches' : ' ✗ different path');
    if (ok) matched.push(candidate);
  }
  console.log();

  if (matched.length === 0) {
    console.error(`  No page found at path /${[...ancestorSlugs, leafSlug].join('/')}.`);
    process.exit(1);
  }

  return matched;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] === true;

  if (!args.slug && !args.entry && !args.url) {
    console.error('Usage: npm run unpublish -- --url  <full-page-url>  [options]  (most precise)');
    console.error('       npm run unpublish -- --slug <page-slug>      [options]');
    console.error('       npm run unpublish -- --entry <entry-id>      [options]  (bypass lookup)');
    console.error('\nOptions:');
    console.error('  --url        Full page URL — resolves exact entry via ancestor chain');
    console.error('  --slug       Last URL segment slug (may be ambiguous across different paths)');
    console.error('  --entry      Entry ID to unpublish directly (always unambiguous)');
    console.error('  --space      Space alias from config/spaces.json (default: source)');
    console.error('  --dry-run    Preview what would be unpublished without making changes');
    process.exit(1);
  }

  const spaceAlias = args.space || 'source';
  const slug = args.slug;
  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Unpublish`);
  console.log(`━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Space:       ${spaceConfig.spaceId} (${spaceAlias})`);
  console.log(`  Environment: ${spaceConfig.environmentId}`);
  if (args.url)   console.log(`  URL:         ${args.url}`);
  if (args.entry) console.log(`  Entry ID:    ${args.entry}`);
  if (args.slug)  console.log(`  Slug:        ${slug}`);
  if (dryRun) console.log(`  Mode:        DRY RUN (no changes will be made)`);
  console.log();

  const env = await getEnvironment(spaceAlias);

  let items;

  // --- Mode 1: Direct entry ID (always unambiguous) ---
  if (args.entry) {
    let entry;
    try {
      entry = await env.getEntry(args.entry);
    } catch (err) {
      if (err?.sys?.id === 'NotFound' || err?.statusCode === 404 || err?.message?.includes('404')) {
        console.error(`  Entry ${args.entry} not found in ${spaceAlias} (${spaceConfig.environmentId}).`);
        process.exit(1);
      }
      throw err;
    }
    await sleep(RATE_LIMIT_DELAY);
    items = [entry];

  // --- Mode 2: Full URL with ancestor-chain verification ---
  } else if (args.url) {
    items = await resolveByUrl(args.url, env, spaceConfig, spaceAlias);

  // --- Mode 3: Slug only ---
  } else {
    let response;
    try {
      response = await env.getEntries({
        content_type: 'page',
        'fields.slug': slug,
        limit: 200,
      });
    } catch (err) {
      console.error(`Error querying Contentful: ${err.message}`);
      process.exit(1);
    }
    await sleep(RATE_LIMIT_DELAY);

    // Exact client-side match (CMA tokenises on dashes)
    items = response.items.filter(e => {
      const slugField = e.fields?.slug;
      if (!slugField) return false;
      return Object.values(slugField).some(v => v === slug);
    });

    if (items.length === 0) {
      console.error(`  No page found with slug "${slug}" in ${spaceAlias} (${spaceConfig.environmentId}).`);
      process.exit(1);
    }

    if (items.length > 1) {
      console.log(`  Found ${items.length} entries with slug "${slug}" — checking each for published status.\n`);
    }
  }

  const published = items.filter(e => deriveStatus(e.sys) !== 'Draft');
  const alreadyDraft = items.filter(e => deriveStatus(e.sys) === 'Draft');

  for (const entry of alreadyDraft) {
    const title = getEntryTitle(entry.fields) || '(untitled)';
    console.log(`  Skipping  "${title}" (${entry.sys.id}) — already a draft.`);
  }

  if (published.length === 0) {
    console.log(`  All matching entries are already drafts — nothing to unpublish.`);
    process.exit(0);
  }

  if (published.length > 1 && !args.entry && !args.url) {
    console.error(`  Ambiguous: ${published.length} published entries share slug "${slug}".`);
    console.error(`  Slug fields only store the last URL segment — pages at different URL paths`);
    console.error(`  can collide on the same slug. Use --url for precise resolution, or --entry:\n`);
    for (const e of published) {
      const t = getEntryTitle(e.fields) || '(untitled)';
      console.error(`    --entry ${e.sys.id}   (${t})`);
    }
    console.error();
    process.exit(1);
  }

  let failed = 0;
  for (const entry of published) {
    const title = getEntryTitle(entry.fields) || '(untitled)';
    const status = deriveStatus(entry.sys);

    console.log(`  Entry ID:    ${entry.sys.id}`);
    console.log(`  Entry Name:  ${title}`);
    console.log(`  Status:      ${status}`);

    if (dryRun) {
      console.log(`  [DRY RUN] Would unpublish "${title}" (${entry.sys.id}).`);
      console.log();
      continue;
    }

    try {
      await entry.unpublish();
      console.log(`  Unpublished  "${title}" successfully.`);
    } catch (err) {
      console.error(`  Failed to unpublish "${title}": ${err.message}`);
      failed++;
    }
    console.log();
    await sleep(RATE_LIMIT_DELAY);
  }

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
