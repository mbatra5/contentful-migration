import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';

function slugify(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-_.#]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
}

function printUsage() {
  console.error('Usage: npm run create-tag -- --name <tagName> [options]');
  console.error('\nCreates a new tag in a Contentful space.\n');
  console.error('Required:');
  console.error('  --name        Tag name (e.g. "qacardsandvideo", "rel12")');
  console.error('\nOptional:');
  console.error('  --space       Space alias (default: target)');
  console.error('  --visibility  Tag visibility: private (default) or public');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name) {
    printUsage();
    process.exit(1);
  }

  const tagName = args.name;
  const tagId = slugify(tagName);
  const spaceAlias = args.space || 'target';
  const isPublic = args.visibility === 'public';

  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Migrator — Create Tag`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:       ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Tag Name:    ${tagName}`);
  console.log(`Tag ID:      ${tagId}`);
  console.log(`Visibility:  ${isPublic ? 'public' : 'private'}`);

  console.log(`\nConnecting...`);
  const environment = await getEnvironment(spaceAlias);

  try {
    const existing = await environment.getTag(tagId);
    console.log(`\nTag already exists: "${existing.name}" (${tagId})`);
    console.log(`No action needed.\n`);
    return;
  } catch (err) {
    if (!err.message?.includes('NotFound') && err.name !== 'NotFound') {
      throw err;
    }
  }

  const tag = await environment.createTag(tagId, tagName, isPublic ? 'public' : 'private');
  console.log(`\nTag created successfully!`);
  console.log(`  Name: ${tag.name}`);
  console.log(`  ID:   ${tag.sys.id}`);
  console.log(`\nUse it with:`);
  console.log(`  npm run create-content -- --spec <spec.json> --tag ${tag.sys.id}`);
  console.log(`  npm run tag -- --entry <id> --tag ${tag.sys.id}\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
