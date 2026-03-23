/**
 * Remaps all Link references in entry fields from source IDs to target IDs.
 * Handles nested objects, arrays, and all locale wrappers.
 */

/**
 * Remap both entry and asset references.
 * @param {object} fields     - Entry fields in { fieldName: { locale: value } } format
 * @param {object} entryIdMap - sourceEntryId → targetEntryId
 * @param {object} assetIdMap - sourceAssetId → targetAssetId (optional)
 */
export function remapFields(fields, entryIdMap, assetIdMap) {
  return deepRemap(fields, entryIdMap, assetIdMap);
}

function deepRemap(value, entryIdMap, assetIdMap) {
  if (!value || typeof value !== 'object') return value;

  if (value.sys?.type === 'Link') {
    const oldId = value.sys.id;
    if (value.sys.linkType === 'Entry') {
      const newId = entryIdMap[oldId];
      if (newId) return { sys: { ...value.sys, id: newId } };
    } else if (value.sys.linkType === 'Asset' && assetIdMap) {
      const newId = assetIdMap[oldId];
      if (newId) return { sys: { ...value.sys, id: newId } };
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => deepRemap(item, entryIdMap, assetIdMap));
  }

  const result = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = deepRemap(val, entryIdMap, assetIdMap);
  }
  return result;
}

/**
 * Strip fields down to just values (remove sys metadata, keep only locale-wrapped field values).
 * Contentful CMA expects fields in { fieldName: { locale: value } } format.
 */
export function cleanFieldsForCreate(fields) {
  const cleaned = {};
  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (localeMap && typeof localeMap === 'object') {
      cleaned[fieldName] = localeMap;
    }
  }
  return cleaned;
}

/**
 * Remove reference fields from entry fields (for Pass 1 shell creation).
 * Returns fields with all Link references replaced by undefined/removed.
 */
export function stripReferenceFields(fields) {
  const stripped = {};
  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') continue;
    const strippedLocale = {};
    let hasNonRefValue = false;

    for (const [locale, value] of Object.entries(localeMap)) {
      const cleaned = stripRefs(value);
      if (cleaned !== undefined) {
        strippedLocale[locale] = cleaned;
        hasNonRefValue = true;
      }
    }

    if (hasNonRefValue) {
      stripped[fieldName] = strippedLocale;
    }
  }
  return stripped;
}

function stripRefs(value) {
  if (!value || typeof value !== 'object') return value;

  if (value.sys?.type === 'Link' && value.sys?.linkType === 'Entry') {
    return undefined;
  }

  if (value.sys?.type === 'Link' && value.sys?.linkType === 'Asset') {
    return value;
  }

  if (Array.isArray(value)) {
    const filtered = value
      .map(item => stripRefs(item))
      .filter(item => item !== undefined);
    return filtered.length > 0 ? filtered : undefined;
  }

  // For rich text nodes and other nested objects
  if (value.nodeType && value.content) {
    return stripRefsFromRichText(value);
  }

  const result = {};
  for (const [key, val] of Object.entries(value)) {
    const cleaned = stripRefs(val);
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function stripRefsFromRichText(node) {
  if (!node || typeof node !== 'object') return node;

  if (node.nodeType === 'embedded-entry-block' || node.nodeType === 'embedded-entry-inline') {
    return undefined;
  }

  if (node.content && Array.isArray(node.content)) {
    const filtered = node.content
      .map(child => stripRefsFromRichText(child))
      .filter(child => child !== undefined);
    return { ...node, content: filtered };
  }

  return node;
}

/**
 * Remove locale keys from fields that aren't in the target space's allowlist.
 * Prevents "Invalid field locale code" errors when source and target have
 * different locale configurations.
 */
export function filterLocales(fields, allowedLocales) {
  if (!allowedLocales || allowedLocales.size === 0) return fields;

  const filtered = {};
  for (const [fieldName, localeMap] of Object.entries(fields)) {
    if (!localeMap || typeof localeMap !== 'object') continue;

    const cleanedLocale = {};
    for (const [locale, value] of Object.entries(localeMap)) {
      if (allowedLocales.has(locale)) {
        cleanedLocale[locale] = value;
      }
    }

    if (Object.keys(cleanedLocale).length > 0) {
      filtered[fieldName] = cleanedLocale;
    }
  }
  return filtered;
}

/**
 * Fetch the set of locale codes enabled in a Contentful environment.
 */
export async function fetchAllowedLocales(environment) {
  const response = await environment.getLocales();
  const codes = response.items.map(l => l.code);
  return new Set(codes);
}
