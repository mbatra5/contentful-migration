import contentfulManagement from 'contentful-management';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPACES_PATH = resolve(__dirname, '../../config/spaces.json');

let spacesConfig;

function loadSpacesConfig() {
  if (!spacesConfig) {
    spacesConfig = JSON.parse(readFileSync(SPACES_PATH, 'utf-8'));
  }
  return spacesConfig;
}

export function getSpaceConfig(alias) {
  const config = loadSpacesConfig();
  const space = config[alias];
  if (!space) {
    const available = Object.keys(config).join(', ');
    throw new Error(`Space alias "${alias}" not found in config/spaces.json. Available: ${available}`);
  }
  return space;
}

export async function getEnvironment(alias) {
  const space = getSpaceConfig(alias);
  const token = process.env[space.tokenEnvVar];

  if (!token) {
    throw new Error(
      `Token not found. Set ${space.tokenEnvVar} in your .env file.\n` +
      `Generate a CMA token at: https://app.contentful.com/account/profile/cma_tokens`
    );
  }

  const client = contentfulManagement.createClient({ accessToken: token });
  const spaceClient = await client.getSpace(space.spaceId);
  return spaceClient.getEnvironment(space.environmentId);
}

/**
 * Get the CDA (Content Delivery API) token for a space, if configured.
 * Used for authenticated CDN access when migrating assets from secure spaces.
 */
export function getCdaToken(alias) {
  const space = getSpaceConfig(alias);
  if (!space.cdaTokenEnvVar) return null;
  return process.env[space.cdaTokenEnvVar] || null;
}

/**
 * Get the current authenticated user's ID. Cached per token.
 * Used for "updatedBy: me" / "createdBy: me" scope filters.
 */
const userCache = {};
export async function getCurrentUserId(alias) {
  const space = getSpaceConfig(alias);
  const token = process.env[space.tokenEnvVar];
  if (userCache[token]) return userCache[token];
  const client = contentfulManagement.createClient({ accessToken: token });
  const user = await client.getCurrentUser();
  userCache[token] = user.sys.id;
  return user.sys.id;
}

export function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      parsed[key] = (!next || next.startsWith('--')) ? true : next;
      if (parsed[key] !== true) i++;
    }
  }
  return parsed;
}
