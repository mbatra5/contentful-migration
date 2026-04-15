import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { walkEntryTree, extractLinkReferences } from './lib/walker.js';
import { RATE_LIMIT_DELAY, sleep, getEntryTitle } from './lib/helpers.js';

const SKIP_TAG_TYPES = new Set(['marketAndLanguage']);

function printUsage() {
  console.error('Usage: npm run tag -- --entry <id> --tag <tagId> [options]');
  console.error('\nAdds a Contentful tag to an entry and all its nested children.');
  console.error('Validates the tag exists before applying. Skips already-tagged entries.\n');
  console.error('Required:');
  console.error('  --entry     Root entry ID (walks all children)');
  console.error('  --tag       Tag ID to apply (must already exist in the space)');
  console.error('\nOptional:');
  console.error('  --space     Space alias (default: target)');
  console.error('  --depth     Max tree walk depth (default: unlimited)');
  console.error('  --dry-run   Preview what would be tagged without making changes');
}

async function validateTag(environment, tagId) {
  try {
    const tag = await environment.getTag(tagId);
    return tag;
  } catch (err) {
    if (err.message?.includes('NotFound') || err.name === 'NotFound') {
      return null;
    }
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.entry || !args.tag) {
    printUsage();
    process.exit(1);
  }

  const rootEntryId = args.entry;
  const tagId = args.tag;
  const spaceAlias = args.space || 'target';
  const maxDepth = args.depth !== undefined ? parseInt(args.depth, 10) : Infinity;
  const dryRun = args['dry-run'] === true;

  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Migrator — Tag Entries`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:       ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Root Entry:  ${rootEntryId}`);
  console.log(`Tag:         ${tagId}`);
  console.log(`Max depth:   ${maxDepth === Infinity ? 'unlimited' : maxDepth}`);
  console.log(`Mode:        ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  console.log(`\nConnecting to ${spaceAlias}...`);
  const environment = await getEnvironment(spaceAlias);

  console.log(`Validating tag "${tagId}" exists...`);
  const tag = await validateTag(environment, tagId);
  if (!tag) {
    console.error(`\nError: Tag "${tagId}" does not exist in space "${spaceAlias}".`);
    console.error(`Create it first in Contentful: Settings → Tags → Create tag`);
    console.error(`Or via API: environment.createTag({ name: "...", sys: { id: "${tagId}" } })`);
    process.exit(1);
  }
  console.log(`Tag found: "${tag.name}" (${tagId})\n`);

  console.log(`Walking entry tree from ${rootEntryId}...\n`);
  const { entryData, dependencyOrder } = await walkEntryTree(
    environment, rootEntryId,
    {
      maxDepth,
      skipTypes: [],
      onProgress(processed, remaining) {
        process.stdout.write(`\r  Processed: ${processed} entries | Queue: ${remaining} remaining`);
      },
    }
  );

  const allEntryIds = dependencyOrder;
  console.log(`\n\n  Total entries to tag: ${allEntryIds.length}\n`);

  const tagLink = { sys: { type: 'Link', linkType: 'Tag', id: tagId } };
  let tagged = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allEntryIds.length; i++) {
    const entryId = allEntryIds[i];
    const data = entryData[entryId];
    const title = data?.title || entryId;
    const contentType = data?.contentType || 'unknown';
    const label = `[${i + 1}/${allEntryIds.length}]`;

    if (SKIP_TAG_TYPES.has(contentType)) {
      console.log(`  ${label} ${contentType}: "${title}" — skipped (excluded type)`);
      skipped++;
      continue;
    }

    try {
      const entry = await environment.getEntry(entryId);
      const existingTags = entry.metadata?.tags || [];
      const alreadyTagged = existingTags.some(t => t.sys.id === tagId);

      if (alreadyTagged) {
        console.log(`  ${label} ${contentType}: "${title}" — already tagged, skipping`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  ${label} ${contentType}: "${title}" — would tag`);
        tagged++;
        continue;
      }

      if (!entry.metadata) entry.metadata = { tags: [] };
      if (!entry.metadata.tags) entry.metadata.tags = [];
      entry.metadata.tags.push(tagLink);
      await entry.update();
      console.log(`  ${label} ${contentType}: "${title}" — tagged`);
      tagged++;
    } catch (err) {
      console.log(`  ${label} ${contentType}: "${title}" — FAILED: ${err.message}`);
      failed++;
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  console.log(`\n${'━'.repeat(37)}`);
  if (dryRun) {
    console.log(`Dry run complete.`);
    console.log(`  Would tag: ${tagged}`);
  } else {
    console.log(`Tagging complete.`);
    console.log(`  Tagged:    ${tagged}`);
  }
  console.log(`  Skipped:   ${skipped} (already tagged)`);
  if (failed > 0) console.log(`  Failed:    ${failed}`);
  console.log();
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
