export const RATE_LIMIT_DELAY = 300;

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Extract a human-readable title from Contentful entry fields.
 * Tries common naming fields in priority order.
 */
export function getEntryTitle(fields) {
  const titleFields = ['entryName', 'title', 'name', 'internalName', 'heading', 'label', 'slug', 'quote', 'profileName'];
  for (const key of titleFields) {
    if (!fields[key]) continue;
    const locales = Object.keys(fields[key]);
    if (locales.length > 0 && typeof fields[key][locales[0]] === 'string') {
      return fields[key][locales[0]];
    }
  }
  return null;
}
