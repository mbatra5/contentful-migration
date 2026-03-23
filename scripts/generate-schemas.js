import { getEnvironment, getSpaceConfig, parseArgs } from './lib/client.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '../config');
const SCHEMA_PATH = resolve(CONFIG_DIR, 'content-schemas.json');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spaceAlias = args.space || 'source';

  const spaceConfig = getSpaceConfig(spaceAlias);

  console.log(`\nContentful Migrator — Generate Content Schemas`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Space:   ${spaceAlias} (${spaceConfig.spaceId} / ${spaceConfig.environmentId})`);
  console.log(`Output:  config/content-schemas.json\n`);

  const environment = await getEnvironment(spaceAlias);
  console.log(`Connected. Fetching content types...\n`);

  const response = await environment.getContentTypes({ limit: 1000 });
  const contentTypes = response.items;

  console.log(`Found ${contentTypes.length} content types.\n`);

  const schemas = {};

  for (const ct of contentTypes) {
    const schema = {
      name: ct.name,
      description: ct.description || undefined,
      displayField: ct.displayField || undefined,
      fields: {},
    };

    for (const field of ct.fields) {
      const fieldDef = buildFieldDef(field);
      schema.fields[field.id] = fieldDef;
    }

    schemas[ct.sys.id] = schema;
    console.log(`  ${ct.sys.id} — ${ct.name} (${ct.fields.length} fields)`);
  }

  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SCHEMA_PATH, JSON.stringify(schemas, null, 2));

  console.log(`\nWritten ${Object.keys(schemas).length} content type schemas to config/content-schemas.json`);
  console.log(`File size: ${(Buffer.byteLength(JSON.stringify(schemas, null, 2)) / 1024).toFixed(1)} KB\n`);
}

function buildFieldDef(field) {
  const def = {
    name: field.name,
    type: field.type,
    required: field.required || undefined,
    localized: field.localized || undefined,
    disabled: field.disabled || undefined,
  };

  if (field.type === 'Array' && field.items) {
    def.itemType = field.items.type;
    if (field.items.linkType) def.itemLinkType = field.items.linkType;

    const itemValidations = extractValidations(field.items.validations || []);
    if (itemValidations.linkContentType) def.linkContentTypes = itemValidations.linkContentType;
    if (itemValidations.in) def.in = itemValidations.in;
    if (itemValidations.linkMimetypeGroup) def.mimeTypes = itemValidations.linkMimetypeGroup;
  }

  if (field.type === 'Link') {
    def.linkType = field.linkType;
    const validations = extractValidations(field.validations || []);
    if (validations.linkContentType) def.linkContentTypes = validations.linkContentType;
    if (validations.linkMimetypeGroup) def.mimeTypes = validations.linkMimetypeGroup;
  }

  const validations = extractValidations(field.validations || []);
  if (validations.in) def.in = validations.in;
  if (validations.size) def.size = validations.size;
  if (validations.regexp) def.regexp = validations.regexp;
  if (validations.unique) def.unique = true;
  if (validations.range) def.range = validations.range;

  // Strip undefined keys
  for (const key of Object.keys(def)) {
    if (def[key] === undefined) delete def[key];
  }

  return def;
}

function extractValidations(validations) {
  const result = {};
  for (const v of validations) {
    if (v.linkContentType) result.linkContentType = v.linkContentType;
    if (v.in) result.in = v.in;
    if (v.size) result.size = v.size;
    if (v.regexp) result.regexp = v.regexp.pattern;
    if (v.unique) result.unique = true;
    if (v.linkMimetypeGroup) result.linkMimetypeGroup = v.linkMimetypeGroup;
    if (v.range) result.range = v.range;
  }
  return result;
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
