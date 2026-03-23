/**
 * Schema and defaults loading, validation, and default-application logic.
 * Extracted from create-content.js for reuse.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '../../config');
const SCHEMA_PATH = resolve(CONFIG_DIR, 'content-schemas.json');
const DEFAULTS_PATH = resolve(CONFIG_DIR, 'content-defaults.json');

export function loadSchemas() {
  if (!existsSync(SCHEMA_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadDefaults() {
  if (!existsSync(DEFAULTS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DEFAULTS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Auto-apply default field values from content-defaults.json.
 * Only fills in fields that are NOT already set in the spec.
 * Also auto-generates slug, pageTitle, and prefixes child entryName.
 */
export function applyDefaults(entries, defaults, defaultLocale, pageName) {
  for (const entry of entries) {
    if (!entry.fields) entry.fields = {};
    const ctDefaults = defaults[entry.contentType]?.defaults;

    if (ctDefaults) {
      for (const [field, value] of Object.entries(ctDefaults)) {
        if (!(field in entry.fields)) {
          entry.fields[field] = value;
        }
      }
    }

    if (entry.contentType === 'page' && !entry.fields.slug && entry.fields.entryName) {
      const name = typeof entry.fields.entryName === 'string'
        ? entry.fields.entryName
        : entry.fields.entryName[defaultLocale] || Object.values(entry.fields.entryName)[0];
      if (name) {
        entry.fields.slug = toSlug(name);
      }
    }

    if (entry.contentType === 'page' && !entry.fields.pageTitle && entry.fields.entryName) {
      entry.fields.pageTitle = entry.fields.entryName;
    }

    if (pageName && entry.fields.entryName && entry.contentType !== 'page') {
      const name = typeof entry.fields.entryName === 'string'
        ? entry.fields.entryName : null;
      if (name && !name.startsWith(pageName) && !name.startsWith('QA ')) {
        entry.fields.entryName = `${pageName} ${name}`;
      }
    }
  }
}

export function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Validate spec entries against cached schemas and defaults.
 * Returns an array of warning strings.
 */
export function validateSpec(entries, schemas, defaults) {
  const warnings = [];
  if (!schemas) return warnings;

  for (const entry of entries) {
    const schema = schemas[entry.contentType];
    if (!schema) {
      warnings.push(`Content type "${entry.contentType}" not in cached schemas`);
      continue;
    }

    for (const [fieldId, fieldDef] of Object.entries(schema.fields)) {
      if (fieldDef.required && (!entry.fields || !(fieldId in entry.fields))) {
        if (!entry.template) {
          warnings.push(`${entry.id}: Missing required field "${fieldId}" (${entry.contentType})`);
        }
      }
    }

    if (entry.fields) {
      for (const fieldId of Object.keys(entry.fields)) {
        if (!schema.fields[fieldId]) {
          warnings.push(`${entry.id}: Unknown field "${fieldId}" for ${entry.contentType}`);
        }
      }
    }

    if (entry.fields && defaults?.[entry.contentType]?.enums) {
      const enums = defaults[entry.contentType].enums;
      for (const [field, allowedValues] of Object.entries(enums)) {
        if (field in entry.fields) {
          const val = entry.fields[field];
          const actualVal = typeof val === 'object' && !Array.isArray(val)
            ? Object.values(val)[0] : val;
          if (typeof actualVal === 'string' && !allowedValues.includes(actualVal)) {
            warnings.push(`${entry.id}: "${actualVal}" is not a valid value for ${field}. Allowed: ${allowedValues.join(', ')}`);
          }
        }
      }
    }
  }

  return warnings;
}
