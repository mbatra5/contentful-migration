export const RATE_LIMIT_DELAY = 300;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function extractLinkReferences(fields) {
  const refs = { entries: [], assets: [] };
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (v.sys?.type === 'Link') {
      if (v.sys.linkType === 'Entry') refs.entries.push(v.sys.id);
      else if (v.sys.linkType === 'Asset') refs.assets.push(v.sys.id);
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    for (const val of Object.values(v)) walk(val);
  }
  walk(fields);
  return refs;
}

const TITLE_FIELDS = ['entryName', 'title', 'name', 'internalName', 'heading', 'label', 'slug'];

export function getDisplayTitle(fields) {
  for (const key of TITLE_FIELDS) {
    const f = fields[key];
    if (!f) continue;
    const locales = Object.keys(f);
    if (locales.length > 0 && typeof f[locales[0]] === 'string') return f[locales[0]];
  }
  return null;
}

export function isLink(v) { return v && typeof v === 'object' && v.sys?.type === 'Link'; }
export function isLinkArray(v) { return Array.isArray(v) && v.length > 0 && isLink(v[0]); }

export function stripReferenceFields(fields) {
  const clean = {};
  for (const [key, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') { clean[key] = localeMap; continue; }
    const cleaned = {};
    for (const [locale, value] of Object.entries(localeMap)) {
      if (isLink(value) || isLinkArray(value)) continue;
      cleaned[locale] = value;
    }
    if (Object.keys(cleaned).length > 0) clean[key] = cleaned;
  }
  return clean;
}

export function remapFields(fields, idMap) {
  return JSON.parse(JSON.stringify(fields), (_k, v) => {
    if (v && typeof v === 'object' && v.sys?.type === 'Link' && v.sys?.linkType === 'Entry') {
      const mapped = idMap[v.sys.id];
      if (mapped) return { sys: { ...v.sys, id: mapped } };
    }
    return v;
  });
}

export function filterLocales(fields, allowed) {
  const filtered = {};
  for (const [key, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') { filtered[key] = localeMap; continue; }
    const kept = {};
    for (const [locale, val] of Object.entries(localeMap)) {
      if (allowed.has(locale)) kept[locale] = val;
    }
    if (Object.keys(kept).length > 0) filtered[key] = kept;
  }
  return filtered;
}

export function applyPostFilters(items, filters, log) {
  if (filters.draft) items = items.filter(e => !e.sys.publishedVersion);
  if (filters.published) items = items.filter(e => !!e.sys.publishedVersion);
  if (filters.updatedBy) { const uid = filters.updatedBy; items = items.filter(e => e.sys.updatedBy?.sys?.id === uid); }
  if (filters.nameContains) {
    const s = filters.nameContains.toLowerCase();
    items = items.filter(e => { const t = getDisplayTitle(e.fields); return t != null && t.toLowerCase().includes(s); });
    log.info(`Name filter "${filters.nameContains}": ${items.length} matches.`);
  }
  return items;
}
