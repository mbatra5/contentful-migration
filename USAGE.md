# Contentful Migrator — Team Usage Guide

Everything you need to extract, migrate, create, and bulk-update Contentful content across spaces.

---

## Table of Contents

1. [Setup (one-time)](#setup)
2. [Extract content](#extract-content)
3. [Browse the catalog](#browse-the-catalog)
4. [Create/recreate in target space](#create-in-target-space)
5. [Direct migration (no local storage)](#direct-migration)
6. [Create content from scratch](#create-content-from-scratch)
7. [Bulk locale updates](#bulk-locale-updates)
8. [Agentic transforms (JSON specs)](#agentic-transforms)
9. [Prompt templates for AI agents](#prompt-templates)
10. [FAQ / Troubleshooting](#faq)

---

## Setup

### 1. Install

```bash
cd contentful-migrator
npm install
```

### 2. Get a Contentful API token

1. Go to https://app.contentful.com/account/profile/cma_tokens
2. Click **Generate personal token**
3. Copy the token (`CFPAT-xxxx...`)

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
SOURCE_CMA_TOKEN=CFPAT-your-source-token
TARGET_CMA_TOKEN=CFPAT-your-target-token
```

### 4. Configure spaces

Edit `config/spaces.json`:

```json
{
  "source": {
    "spaceId": "your-source-space-id",
    "environmentId": "dev",
    "tokenEnvVar": "SOURCE_CMA_TOKEN"
  },
  "target": {
    "spaceId": "your-target-space-id",
    "environmentId": "master",
    "tokenEnvVar": "TARGET_CMA_TOKEN"
  }
}
```

Find space/environment IDs from the Contentful URL:
`https://app.contentful.com/spaces/SPACE_ID/environments/ENV_ID/`

---

## Extract Content

Point at any Contentful entry and the tool walks all linked references automatically.

### Commands

| Command | What it does |
|---------|-------------|
| `npm run extract -- --entry <id>` | Unlimited depth, skips page nav links (recommended) |
| `npm run extract:shallow -- --entry <id>` | Depth 1 — root + direct children only |
| `npm run extract:medium -- --entry <id>` | Depth 3 |
| `npm run extract:deep -- --entry <id>` | Depth 5 |
| `npm run extract:full -- --entry <id>` | Unlimited, traverses everything (no skip) |
| `npm run extract -- --entry <id> --depth 0` | Root entry only (no children) |

### Options

| Flag | Description |
|------|-------------|
| `--entry <id>` | Contentful entry ID (required) |
| `--name <name>` | Custom extraction name (auto-detected from entry title if omitted) |
| `--space <alias>` | Space alias from `config/spaces.json` (default: `source`) |
| `--depth <N>` | Max traversal depth: 0=root only, 1=root+children, etc. |
| `--skip-types <x,y>` | Content types to skip (default: `page`) |
| `--no-skip` | Traverse everything, don't skip any types |

### Examples

```bash
# Extract a full page with all nested content
npm run extract -- --entry 4HmRxJk2OikYAU72YeTKEv

# Extract just a single component
npm run extract -- --entry 4Y0HCkTLM8AhriFRIsDpRH --depth 0

# Extract a component + its direct children
npm run extract:shallow -- --entry 4Y0HCkTLM8AhriFRIsDpRH

# Extract from a different space
npm run extract -- --entry abc123 --space staging
```

### Where does it go?

- Entry data: `store/entries/{contentType}/{entryId}.json`
- Extraction manifest: `store/extractions/{name}.json`
- Global index: `store/index.csv`

### Re-extracting

Running extract again for the same entry **refreshes** existing data — it never duplicates.

---

## Browse the Catalog

```bash
# Overview: content types + extractions
npm run list

# All entries of a content type
npm run list -- --type cta
npm run list -- --type richTextBlock

# Details of a specific extraction
npm run list -- --name qa-bento-cards
```

Or open `store/index.csv` in a spreadsheet for a full searchable index.

---

## Create in Target Space

Move locally-stored content to a target Contentful space.

### Modes

| Command | Behavior |
|---------|----------|
| `npm run create -- ...` | Default: create new, skip entries already in remap |
| `npm run create:force -- ...` | Ignore remap, create fresh entries (new IDs) |
| `npm run create:update -- ...` | Overwrite existing target entries in-place |
| `npm run create:force-update -- ...` | Overwrite existing + create all unmapped |
| `npm run create:preview -- ...` | Dry run — see what would happen |

### Options

| Flag | Description |
|------|-------------|
| `--name <extraction>` | Create all entries from an extraction |
| `--entries <id1,id2>` | Create specific entries by ID |
| `--space <alias>` | Target space (default: `target`) |
| `--publish` | Auto-publish entries after creation |
| `--dry-run` | Preview only, no changes |

### Examples

```bash
# Preview first (always recommended!)
npm run create:preview -- --name qa-bento-cards --space target

# Create entries
npm run create -- --name qa-bento-cards --space target

# Force create (ignores existing mappings)
npm run create:force -- --name qa-bento-cards --space target

# Update existing entries with fresh content
npm run create:update -- --name qa-bento-cards --space target

# Create and auto-publish
npm run create -- --name qa-bento-cards --space target --publish

# Create specific entries only
npm run create -- --entries abc123,def456 --space target
```

### What if I deleted entries in the target?

Use `--update` mode — it automatically detects deleted entries and recreates them:

```bash
npm run create:update -- --name qa-bento-cards --space target
```

### What about locale mismatches?

Handled automatically. If the source has `en-IN` but the target only supports `en, en-US`, unsupported locales are stripped silently. No errors.

---

## Direct Migration

Migrate entries directly from source to target without downloading locally.

### Commands

| Command | What it does |
|---------|-------------|
| `npm run migrate -- --entry <id>` | Depth 1 (root + children) |
| `npm run migrate:solo -- --entry <id>` | Depth 0 (root only) |
| `npm run migrate:preview -- --entry <id>` | Dry run |

### Options

| Flag | Description |
|------|-------------|
| `--entry <id>` | Source entry ID (required) |
| `--source <alias>` | Source space (default: `source`) |
| `--target <alias>` | Target space (default: `target`) |
| `--depth <N>` | Traversal depth (default: 1) |
| `--skip-types <x,y>` | Content types to skip (default: `page`) |
| `--no-skip` | Don't skip any types |
| `--force` | Create new even if previously migrated |
| `--publish` | Auto-publish after creation |
| `--dry-run` | Preview only |

### Examples

```bash
# Migrate a single rich text component directly
npm run migrate:solo -- --entry 4Y0HCkTLM8AhriFRIsDpRH

# Migrate with children
npm run migrate -- --entry 4Y0HCkTLM8AhriFRIsDpRH

# Preview first
npm run migrate:preview -- --entry 4Y0HCkTLM8AhriFRIsDpRH

# Force re-migration
npm run migrate -- --entry 4Y0HCkTLM8AhriFRIsDpRH --force
```

---

## Create Content from Scratch

Create new Contentful entries using JSON spec files. Schema-driven — the tool knows required fields, valid values, and linked types from the cached content schema.

### One-time setup: Generate schemas

```bash
npm run generate-schemas                    # From source space
npm run generate-schemas -- --space target  # From any space
```

This pulls **all** content type definitions from Contentful and writes `config/content-schemas.json`. The agent reads this compact file (~3-5KB) to know what fields each content type needs.

Refresh when content model changes. Skip if you only want to create content (schemas are used for validation, not required).

### Commands

| Command | What it does |
|---------|-------------|
| `npm run create-content -- --spec <path.json>` | Create entries from spec |
| `npm run create-content:preview -- --spec <path.json>` | Dry run |

### Spec file format

A spec defines entries to create and how they reference each other:

```json
{
  "space": "target",
  "locale": "en",
  "entries": [
    {
      "id": "root-page",
      "contentType": "page",
      "fields": {
        "entryName": "My New Page",
        "pageTitle": "My New Page",
        "slug": "my-new-page",
        "pageContent": ["@hero-1", "@rte-1"]
      }
    },
    {
      "id": "hero-1",
      "contentType": "hero",
      "fields": {
        "entryName": "My Hero",
        "heroStyle": "Full Width",
        "autoplay": true
      }
    },
    {
      "id": "rte-1",
      "contentType": "richTextBlock",
      "fields": {
        "entryName": "My Rich Text"
      }
    }
  ]
}
```

### Reference types

Use these in field values to link entries:

| Syntax | What it does | Needs API call? |
|--------|-------------|-----------------|
| `@localId` | Link to a new entry in the same spec | No |
| `existing:abc123` | Link to an existing entry by ID | No |
| `lookup:richTextBlock:Brand Expression` | Search Contentful by name, get ID | Yes (one call) |
| `asset:xyz789` | Link to an existing asset | No |

### Mixing new + existing entries

```json
{
  "space": "target",
  "locale": "en",
  "entries": [
    {
      "id": "root",
      "contentType": "page",
      "fields": {
        "entryName": "Mixed Content Page",
        "pageContent": [
          "@new-hero",
          "lookup:richTextBlock:QA-rte-Brand-expression",
          "existing:4Y0HCkTLM8AhriFRIsDpRH"
        ]
      }
    },
    {
      "id": "new-hero",
      "contentType": "hero",
      "fields": { "entryName": "Brand New Hero", "heroStyle": "Slimline" }
    }
  ]
}
```

### Template-based creation (clone + override)

Clone a live entry's fields and change specific values:

```json
{
  "id": "new-rte",
  "contentType": "richTextBlock",
  "template": "4Y0HCkTLM8AhriFRIsDpRH",
  "overrides": {
    "entryName": "New RTE Based on Template"
  }
}
```

The template entry is fetched live from Contentful — no local store needed.

### Examples

```bash
# Preview (always recommended first)
npm run create-content:preview -- --spec specs/my-page.json

# Create
npm run create-content -- --spec specs/my-page.json

# Create in a different space
npm run create-content -- --spec specs/my-page.json --space staging

# Create and publish
npm run create-content -- --spec specs/my-page.json --publish
```

### Saving specs

Keep your specs in the `specs/` folder:

```
specs/
├── example-page.json          # All-new entries
├── example-mixed.json         # New + existing + lookup
└── india-energy-hub.json      # Your custom page
```

---

## Bulk Locale Updates

Copy locale values across fields for existing entries in the **same space**.

### Commands

| Command | What it does |
|---------|-------------|
| `npm run locale -- ...` | Run locale copy |
| `npm run locale:preview -- ...` | Dry run |

### Scope (pick one)

| Flag | Description |
|------|-------------|
| `--name <extraction>` | All entries in an extraction |
| `--type <contentType>` | All entries of a content type (from local catalog) |
| `--entries <id1,id2>` | Specific entry IDs |
| `--all` | Every entry in the local catalog |

### Options

| Flag | Description |
|------|-------------|
| `--from <locale>` | Source locale code (required, e.g. `en`) |
| `--to <locale>` | Target locale code (required, e.g. `en-IN`) |
| `--space <alias>` | Space to update (default: `source`) |
| `--overwrite` | Replace target locale even if it already has a value |
| `--publish` | Auto-publish after update |
| `--dry-run` | Preview only |

### Examples

```bash
# Copy en → en-IN for all entries in an extraction
npm run locale -- --from en --to en-IN --name qa-bento-cards

# Copy for a specific content type, with overwrite
npm run locale -- --from en --to en-IN --type richTextBlock --overwrite

# Preview first
npm run locale:preview -- --from en --to en-IN --entries abc123,def456

# Copy and publish
npm run locale -- --from en-US --to en-IN --name qa-bento-cards --publish
```

---

## Agentic Transforms

The transform runner executes JSON spec files that define **what to change** and **where**. This is the most flexible way to do bulk content operations — the AI agent generates specs from your natural language requests.

### Commands

| Command | What it does |
|---------|-------------|
| `npm run transform -- --spec <path.json>` | Run a transform spec |
| `npm run transform:preview -- --spec <path.json>` | Dry run |

### How it works

1. You describe what you want in natural language
2. AI generates a spec JSON file
3. You review the spec
4. Run it with `npm run transform`

### Spec file format

A spec has two parts: **scope** (which entries) and **transforms** (what to change).

#### Scope options

```json
{ "scope": { "entry": "abc123" } }
{ "scope": { "entry": "abc123", "depth": 1 } }
{ "scope": { "entries": ["abc123", "def456"] } }
{ "scope": { "extraction": "qa-bento-cards" } }
{ "scope": { "extraction": "qa-bento-cards", "contentType": "richTextBlock" } }
{ "scope": { "contentType": "richTextBlock", "query": { "fields.entryName[match]": "QA" } } }
{ "scope": { "contentType": "cta" } }
{ "scope": { "all": true } }
```

#### Scope filters

When querying Contentful by content type, you can add **post-fetch filters** to narrow results. Archived entries are excluded by default.

| Filter | Type | Description |
|--------|------|-------------|
| `draft` | `true` | Only entries that have never been published |
| `published` | `true` | Only entries that have been published |
| `updatedBy` | `"me"` or user ID | Only entries last updated by this user (`"me"` auto-resolves from your token) |
| `createdBy` | `"me"` or user ID | Only entries created by this user |
| `excludeArchived` | `false` | Include archived entries (excluded by default) |

```json
{ "scope": { "contentType": "imageWithFocalPoint", "filters": { "draft": true, "updatedBy": "me" } } }
{ "scope": { "contentType": "hero", "filters": { "published": true } } }
{ "scope": { "contentType": "cta", "query": { "fields.style": "Primary" }, "filters": { "createdBy": "me" } } }
```

Filters combine with `query` params — use `query` for server-side filtering (field values, dates) and `filters` for things the API doesn't support natively (draft state, author).

#### Transform rules

| Rule | What it does | Required params |
|------|-------------|-----------------|
| `copy` | Copy a locale value to another locale | `sourceLocale`, `targetLocale` |
| `set` | Set a specific value | `targetLocale`, `value` |
| `delete` | Remove a locale from a field | `targetLocale` |
| `rename-locale` | Move value from one locale key to another | `sourceLocale`, `targetLocale` |
| `modify` | Append/prepend/replace text on existing value | `targetLocale` + `suffix`/`prefix`/`replace` |

#### Modifiers (work with `copy` and `modify`)

| Modifier | Description | Example |
|----------|-------------|---------|
| `suffix` | Append text | `"-IN"` |
| `prefix` | Prepend text | `"[DRAFT] "` |
| `replace` | Find & replace | `{ "from": "Draft", "to": "Final" }` |
| `field` | Target a specific field (omit for all fields) | `"title"` |

### Spec examples

#### Copy locale with suffix for all fields

```json
{
  "space": "source",
  "scope": { "extraction": "qa-bento-cards", "contentType": "richTextBlock" },
  "transforms": [
    { "rule": "copy", "sourceLocale": "en", "targetLocale": "en-IN" }
  ]
}
```

#### Update title field only, with suffix

```json
{
  "space": "source",
  "scope": { "contentType": "richTextBlock", "query": { "fields.entryName[match]": "QA" } },
  "transforms": [
    { "rule": "copy", "field": "title", "sourceLocale": "en", "targetLocale": "en-IN", "suffix": "-IN" }
  ]
}
```

#### Set a specific value for all CTAs

```json
{
  "space": "source",
  "scope": { "contentType": "cta" },
  "transforms": [
    { "rule": "set", "field": "style", "targetLocale": "en", "value": "Primary" }
  ]
}
```

#### Find & replace text

```json
{
  "space": "source",
  "scope": { "entries": ["abc123", "def456"] },
  "transforms": [
    { "rule": "modify", "field": "heading", "targetLocale": "en", "replace": { "from": "Draft", "to": "Published" } }
  ]
}
```

#### Link an asset to all draft entries of a type (updated by me)

```json
{
  "space": "target",
  "scope": {
    "contentType": "imageWithFocalPoint",
    "filters": { "draft": true, "updatedBy": "me" }
  },
  "transforms": [
    {
      "rule": "set",
      "field": "image",
      "targetLocale": "en",
      "value": { "sys": { "type": "Link", "linkType": "Asset", "id": "ASSET_ID_HERE" } }
    }
  ]
}
```

#### Delete a locale from all entries in an extraction

```json
{
  "space": "source",
  "scope": { "extraction": "qa-bento-cards" },
  "transforms": [
    { "rule": "delete", "targetLocale": "en-IN" }
  ]
}
```

### Saving specs

Keep your spec files in a `transforms/` folder for reuse:

```
transforms/
├── copy-en-to-in-rte.json
├── set-cta-style.json
└── cleanup-draft-text.json
```

---

## Prompt Templates

Copy-paste these when asking an AI agent to help with Contentful operations.

---

### Extract a page

> Extract the Contentful page at entry ID `ENTRY_ID` from the source space. Use default settings (skip page nav links, unlimited depth).

```bash
npm run extract -- --entry ENTRY_ID
```

---

### Extract just one component (no children)

> Extract only the entry `ENTRY_ID` without any linked references.

```bash
npm run extract -- --entry ENTRY_ID --depth 0
```

---

### Create entries in target space

> Create all entries from the extraction "EXTRACTION_NAME" in the target Contentful space. Do a dry run first.

```bash
npm run create:preview -- --name EXTRACTION_NAME --space target
npm run create -- --name EXTRACTION_NAME --space target
```

---

### Force-create (ignore previous mappings)

> I deleted entries from the target and want to recreate them with new IDs.

```bash
npm run create:force -- --name EXTRACTION_NAME --space target
```

---

### Update existing entries with fresh content

> The source content has changed. Update the existing target entries in-place.

```bash
npm run create:update -- --name EXTRACTION_NAME --space target
```

---

### Direct migrate (no local step)

> Migrate entry `ENTRY_ID` directly from source to target, including direct children.

```bash
npm run migrate -- --entry ENTRY_ID
```

> Migrate only the entry itself, no children.

```bash
npm run migrate:solo -- --entry ENTRY_ID
```

---

### Copy locale en → en-IN for an extraction

> Copy all `en` field values to `en-IN` for every entry in the "EXTRACTION_NAME" extraction.

```bash
npm run locale -- --from en --to en-IN --name EXTRACTION_NAME
```

---

### Copy locale with overwrite

> Same as above but overwrite existing `en-IN` values.

```bash
npm run locale -- --from en --to en-IN --name EXTRACTION_NAME --overwrite
```

---

### Bulk update a specific content type's locale

> Copy `en` to `en-IN` for all `richTextBlock` entries in the catalog.

```bash
npm run locale -- --from en --to en-IN --type richTextBlock
```

---

### Agentic: Copy locale + append suffix for specific content types in an extraction

> For all rich text editors in the "qa-bento-cards" extraction, copy the `en` title field to `en-IN` and append "-IN" at the end.

Create a spec file `transforms/copy-title-with-suffix.json`:

```json
{
  "space": "source",
  "scope": { "extraction": "qa-bento-cards", "contentType": "richTextBlock" },
  "transforms": [
    { "rule": "copy", "field": "title", "sourceLocale": "en", "targetLocale": "en-IN", "suffix": "-IN" }
  ]
}
```

Run:

```bash
npm run transform:preview -- --spec transforms/copy-title-with-suffix.json
npm run transform -- --spec transforms/copy-title-with-suffix.json
```

---

### Agentic: Find all RTEs with "QA" in the name and update a field

> In the source space, find all `richTextBlock` entries whose `entryName` contains "QA" and set their `en-IN` title to be a copy of the `en` title with "-IN" appended.

Create a spec:

```json
{
  "space": "source",
  "scope": {
    "contentType": "richTextBlock",
    "query": { "fields.entryName[match]": "QA" }
  },
  "transforms": [
    { "rule": "copy", "field": "title", "sourceLocale": "en", "targetLocale": "en-IN", "suffix": "-IN" }
  ]
}
```

---

### Agentic: Set all CTAs to a specific style

> Set the `style` field to "Primary" (en locale) for all CTA entries in the catalog.

```json
{
  "space": "source",
  "scope": { "contentType": "cta" },
  "transforms": [
    { "rule": "set", "field": "style", "targetLocale": "en", "value": "Primary" }
  ]
}
```

---

### Agentic: Replace text in headings

> In the "product-page" extraction, replace "Draft" with "Live" in all `heading` fields (en locale).

```json
{
  "space": "source",
  "scope": { "extraction": "product-page" },
  "transforms": [
    { "rule": "modify", "field": "heading", "targetLocale": "en", "replace": { "from": "Draft", "to": "Live" } }
  ]
}
```

---

### Generate content schemas

> Pull all content type definitions from Contentful so the agent knows required fields and valid values.

```bash
npm run generate-schemas
```

---

### Create a page with new components

> Create a page called "India Energy Hub" with a hero (Full Width, autoplay), two split layout blocks, and a kaltura video block.

The agent will:
1. Read `config/content-schemas.json` for field requirements
2. Generate a spec file with all entries and `@` references
3. Run: `npm run create-content -- --spec specs/india-energy-hub.json`

---

### Create a page mixing new + existing entries

> Create a page called "Mixed Content Page". Use the existing RTE called "QA-rte-Brand-expression" and the entry 4Y0HCkTLM8AhriFRIsDpRH as the hero. Add a new split layout block.

The agent will use `lookup:richTextBlock:QA-rte-Brand-expression` and `existing:4Y0HCkTLM8AhriFRIsDpRH` in the spec.

---

### Clone an entry with modifications

> Clone the rich text entry 4Y0HCkTLM8AhriFRIsDpRH but change its entryName to "India Brand Expression".

```json
{
  "id": "cloned-rte",
  "contentType": "richTextBlock",
  "template": "4Y0HCkTLM8AhriFRIsDpRH",
  "overrides": { "entryName": "India Brand Expression" }
}
```

---

### Add a new Contentful space

> I have a new space. Add it to the migrator config.

1. Edit `config/spaces.json`:
```json
{
  "new-space": {
    "spaceId": "SPACE_ID",
    "environmentId": "master",
    "tokenEnvVar": "NEW_CMA_TOKEN"
  }
}
```

2. Add to `.env`:
```
NEW_CMA_TOKEN=CFPAT-xxxxx
```

3. Use `--space new-space` in any command.

---

## FAQ

### Where do I find entry IDs?

Open the entry in Contentful. The ID is in the URL:
```
https://app.contentful.com/spaces/SPACE_ID/environments/ENV_ID/entries/ENTRY_ID
```

### Can I extract from one space and create in another?

Yes, that's the primary workflow:

```bash
npm run extract -- --entry <id> --space source
npm run create -- --name <extraction> --space target
```

### What if source and target have different locales?

Handled automatically. Unsupported locales are stripped during creation.

### What if I run extract twice for the same entry?

It refreshes the existing data — no duplicates. Changed fields are overwritten, unchanged fields stay.

### What if two pages share the same CTA?

The CTA is stored once in `store/entries/cta/`. Both extraction manifests reference it. When creating in target, it's created once and the ID mapping is reused.

### How do I undo a creation?

Delete the entries from the target Contentful space. Then either:
- Remove their mappings from `store/remap.json`, or
- Use `--force` to re-create with new IDs

### What about images and assets?

Assets are tracked (IDs recorded) but not migrated. The target entry will reference the asset ID — if that asset doesn't exist in the target space, the field will be empty. You can upload assets manually.

### The target space content model is different — will this work?

No. Content type IDs and field IDs must be identical between source and target spaces. This tool migrates content, not content models.

### Is there rate limiting?

Yes, 300ms between API calls. A 500-entry extraction takes ~2.5 minutes to create. This prevents Contentful API throttling.

---

## All npm Scripts at a Glance

```bash
npm run help     # Show all available commands
```

| Script | Description |
|--------|-------------|
| `extract` | Extract with unlimited depth, skip page links |
| `extract:shallow` | Depth 1 |
| `extract:medium` | Depth 3 |
| `extract:deep` | Depth 5 |
| `extract:full` | Unlimited, no skip |
| `create` | Create new entries (skip remapped) |
| `create:force` | Ignore remap, create everything fresh |
| `create:update` | Overwrite existing in target |
| `create:force-update` | Overwrite + create unmapped |
| `create:preview` | Dry run |
| `migrate` | Direct source→target, depth 1 |
| `migrate:solo` | Direct, depth 0 |
| `migrate:preview` | Direct, dry run |
| `generate-schemas` | Pull content type definitions from Contentful |
| `create-content` | Create entries from a content spec |
| `create-content:preview` | Dry run content creation |
| `transform` | Run a transform spec |
| `transform:preview` | Dry run transform |
| `locale` | Bulk locale copy |
| `locale:preview` | Dry run locale |
| `list` | Browse catalog |
| `help` | Show all commands |
