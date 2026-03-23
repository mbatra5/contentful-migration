const CMA_BASE = 'https://api.contentful.com';

export async function cmaFetch(token, path, opts = {}) {
  const { method = 'GET', body, headers: extra = {}, params } = opts;
  let url = `${CMA_BASE}${path}`;
  if (params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
    url += '?' + sp.toString();
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function getCurrentUser(token) {
  const u = await cmaFetch(token, '/users/me');
  return { id: u.sys.id, email: u.email, firstName: u.firstName, lastName: u.lastName };
}

export async function listContentTypes(token, spaceId, envId) {
  const res = await cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/content_types`, { params: { limit: 1000 } });
  return res.items.map(ct => ({ id: ct.sys.id, name: ct.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getEntry(token, spaceId, envId, entryId) {
  return cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/entries/${entryId}`);
}

export async function getEntries(token, spaceId, envId, params) {
  return cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/entries`, { params });
}

export async function createEntry(token, spaceId, envId, contentType, fields) {
  return cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/entries`, {
    method: 'POST', body: { fields }, headers: { 'X-Contentful-Content-Type': contentType },
  });
}

export async function updateEntry(token, spaceId, envId, entryId, version, fields) {
  return cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/entries/${entryId}`, {
    method: 'PUT', body: { fields }, headers: { 'X-Contentful-Version': String(version) },
  });
}

export async function publishEntry(token, spaceId, envId, entryId, version) {
  return cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/entries/${entryId}/published`, {
    method: 'PUT', headers: { 'X-Contentful-Version': String(version) },
  });
}

export async function getAsset(token, spaceId, envId, assetId) {
  return cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/assets/${assetId}`);
}

export async function getLocales(token, spaceId, envId) {
  const res = await cmaFetch(token, `/spaces/${spaceId}/environments/${envId}/locales`);
  return res.items.map(l => l.code);
}
