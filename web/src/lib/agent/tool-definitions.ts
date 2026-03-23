export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'analyze',
      description: 'Dry-run tree walk from a root entry. Always do this first before extract or migrate to preview the entry tree.',
      parameters: { type: 'object', required: ['spaceId', 'envId', 'entryId'], properties: {
        spaceId: { type: 'string', description: 'Contentful space ID' },
        envId: { type: 'string', description: 'Environment ID (e.g. dev, master)', default: 'dev' },
        entryId: { type: 'string', description: 'Root entry ID to start from' },
        maxDepth: { type: 'number', description: 'How deep to traverse (0=root only, default 1)', default: 1 },
        skipTypes: { type: 'array', items: { type: 'string' }, description: 'Content type IDs to skip (default: ["page"])', default: ['page'] },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_and_create',
      description: 'Extract entries from source space and create them in target space. Two-pass: creates shells then links references. Always analyze first.',
      parameters: { type: 'object', required: ['sourceSpaceId', 'sourceEnvId', 'entryId', 'targetSpaceId', 'targetEnvId'], properties: {
        sourceSpaceId: { type: 'string' }, sourceEnvId: { type: 'string', default: 'dev' },
        entryId: { type: 'string' }, maxDepth: { type: 'number', default: 1 },
        skipTypes: { type: 'array', items: { type: 'string' }, default: ['page'] },
        targetSpaceId: { type: 'string' }, targetEnvId: { type: 'string', default: 'master' },
        publish: { type: 'boolean', description: 'Auto-publish after creation', default: false },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'migrate',
      description: 'Walk source entry tree and create directly in target in one step. Combines extract + create. Always analyze first.',
      parameters: { type: 'object', required: ['sourceSpaceId', 'sourceEnvId', 'entryId', 'targetSpaceId', 'targetEnvId'], properties: {
        sourceSpaceId: { type: 'string' }, sourceEnvId: { type: 'string', default: 'dev' },
        entryId: { type: 'string' }, maxDepth: { type: 'number', default: 1 },
        skipTypes: { type: 'array', items: { type: 'string' }, default: ['page'] },
        targetSpaceId: { type: 'string' }, targetEnvId: { type: 'string', default: 'master' },
        publish: { type: 'boolean', default: false },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_entry',
      description: 'Update specific fields on a single entry by ID. Use when the user wants to change a known entry (e.g. rename, update a locale value). Fields use Contentful format: { fieldName: { locale: value } }.',
      parameters: { type: 'object', required: ['spaceId', 'envId', 'entryId', 'fields'], properties: {
        spaceId: { type: 'string', description: 'Contentful space ID' },
        envId: { type: 'string', description: 'Environment ID', default: 'master' },
        entryId: { type: 'string', description: 'The entry ID to update' },
        fields: { type: 'object', description: 'Fields to update in Contentful format, e.g. { "name": { "en": "New Name" } }. Only specified fields are changed; others remain untouched.' },
        publish: { type: 'boolean', description: 'Publish entry after update', default: false },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'transform',
      description: 'Bulk update fields on existing entries of a content type. Rules: "set" replaces a field value, "modify" changes existing value (supports prefix/suffix/replace), "copy" copies between locales (supports prefix/suffix/replace), "delete" removes a locale value.',
      parameters: { type: 'object', required: ['spaceId', 'envId', 'contentType', 'rule', 'targetLocale'], properties: {
        spaceId: { type: 'string' }, envId: { type: 'string', default: 'master' },
        contentType: { type: 'string', description: 'Content type ID to transform' },
        rule: { type: 'string', enum: ['set', 'copy', 'delete', 'modify'] },
        field: { type: 'string', description: 'Field name to update (omit to apply to all text fields)' },
        targetLocale: { type: 'string', default: 'en' },
        sourceLocale: { type: 'string', description: 'Source locale (required for copy rule)' },
        value: { type: 'string', description: 'New value (for set rule)' },
        prefix: { type: 'string', description: 'String to prepend (for modify/copy rules)' },
        suffix: { type: 'string', description: 'String to append (for modify/copy rules)' },
        replace: { type: 'object', description: 'Find-and-replace (for modify/copy rules)', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        draftOnly: { type: 'boolean', default: false },
        nameContains: { type: 'string', description: 'Filter by entry name substring' },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'fix_broken_assets',
      description: 'Find entries with broken/missing asset or entry references and replace them with a working replacement entry.',
      parameters: { type: 'object', required: ['spaceId', 'envId', 'contentType', 'replacementEntryId'], properties: {
        spaceId: { type: 'string' }, envId: { type: 'string', default: 'master' },
        contentType: { type: 'string' },
        replacementEntryId: { type: 'string', description: 'Entry ID to replace broken links with' },
        draftOnly: { type: 'boolean', default: false },
        nameContains: { type: 'string' },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_content_types',
      description: 'List all content types in a space/environment.',
      parameters: { type: 'object', required: ['spaceId', 'envId'], properties: {
        spaceId: { type: 'string' }, envId: { type: 'string', default: 'master' },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_entries',
      description: 'Search and list entries of a specific content type. Supports filtering by name, status, and author.',
      parameters: { type: 'object', required: ['spaceId', 'envId', 'contentType'], properties: {
        spaceId: { type: 'string' }, envId: { type: 'string', default: 'master' },
        contentType: { type: 'string' },
        nameContains: { type: 'string' },
        draftOnly: { type: 'boolean', default: false },
        publishedOnly: { type: 'boolean', default: false },
        updatedByMe: { type: 'boolean', default: false },
        limit: { type: 'number', default: 100 },
      }},
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entry',
      description: 'Get full details of a single entry by its ID.',
      parameters: { type: 'object', required: ['spaceId', 'envId', 'entryId'], properties: {
        spaceId: { type: 'string' }, envId: { type: 'string', default: 'master' },
        entryId: { type: 'string' },
      }},
    },
  },
];
