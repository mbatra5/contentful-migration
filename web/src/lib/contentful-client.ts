import { createClient, type PlainClientAPI } from 'contentful-management';

let cachedClient: PlainClientAPI | null = null;
let cachedToken: string | null = null;

export function getClient(accessToken: string): PlainClientAPI {
  if (cachedClient && cachedToken === accessToken) return cachedClient;
  cachedClient = createClient({ accessToken }, { type: 'plain' });
  cachedToken = accessToken;
  return cachedClient;
}

export async function getEnvironment(accessToken: string, spaceId: string, environmentId: string) {
  const client = createClient({ accessToken });
  const space = await client.getSpace(spaceId);
  return space.getEnvironment(environmentId);
}

export async function listSpaces(accessToken: string) {
  const client = createClient({ accessToken });
  const spaces = await client.getSpaces();
  return spaces.items.map(s => ({ id: s.sys.id, name: s.name }));
}

export async function listEnvironments(accessToken: string, spaceId: string) {
  const client = createClient({ accessToken });
  const space = await client.getSpace(spaceId);
  const envs = await space.getEnvironments();
  return envs.items.map(e => ({ id: e.sys.id, name: e.name }));
}

export async function listContentTypes(accessToken: string, spaceId: string, environmentId: string) {
  const env = await getEnvironment(accessToken, spaceId, environmentId);
  const response = await env.getContentTypes({ limit: 1000 });
  return response.items
    .map(ct => ({ id: ct.sys.id, name: ct.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCurrentUser(accessToken: string) {
  const client = createClient({ accessToken });
  const user = await client.getCurrentUser();
  return { id: user.sys.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
}
