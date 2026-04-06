# Contentful Migrator — Agent Handoff Documentation

**Version:** 5.0.0  
**Project Type:** Contentful Data Migration & Content Authoring CLI  
**Runtime:** Node.js (ES Modules)

---

## What This Tool Does

Surgically extracts Contentful entries (with all linked references) from a source space, stores them in a **global catalog organized by content type**, and recreates them selectively in a target space. Also supports **direct migration** (no local storage), **asset migration with deduplication**, **bulk locale updates**, **agentic field transforms**, and **schema-driven content authoring** from scratch.

Entries are deduplicated across extractions — the same CTA used by 10 pages is stored and created only once. Assets are deduplicated by filename match in the target space — no duplicate images even on a cold start.

---

## Architecture Overview

```
┌─────────────┐    extract     ┌──────────────┐    create     ┌──────────────┐
│   Source    │ ──────────►    │  Local Store │ ──────────►   │   Target     │
│   Space     │                │  (entries/)  │               │   Space      │
└─────────────┘                └──────────────┘               └──────────────┘
       │                                                           ▲
       │              migrate (direct, no local)                   │
       └───────────────────────────────────────────────────────────┘
       │
       │    locale / transform (in-place updates on any space)
       └──────────────────────► Same space

┌─────────────────┐                              ┌──────────────┐
│  content-schemas│  create-content (spec JSON)  │   Target     │
│  (cached types) │ ──────────────────────────►  │   Space      │
└─────────────────┘   + @refs, existing:, lookup:└──────────────┘
```

### Scripts

| Script | Purpose | Touches local store? |
|--------|---------|---------------------|
| `extract.js` | Walk source entries, save to local catalog | Yes (write) |
| `create.js` | Create/update entries in target from local store | Yes (read) |
| `migrate.js` | Direct source→target, no local storage | No (only remap.json) |
| `create-content.js` | Schema-driven content authoring from specs | No (reads schemas only) |
| `generate-schemas.js` | Pull content type definitions from Contentful | No (writes config/) |
| `update-locale.js` | Bulk copy locale fields on live entries | Optional (read for IDs) |
| `run-transform.js` | Agentic field transforms via JSON spec | Optional (read for IDs) |
| `query.js` | Read-only content inspector — outputs JSON for agentic workflows | No (API only, **read-only**) |
| `inspect.js` | Fetch live entry metadata (dates, versions, status) | No (API only) |
| `list.js` | Browse catalog, extractions, remap | Yes (read) |

### Shared Libraries

| File | Exports |
|------|---------|
| `lib/client.js` | `getEnvironment()`, `getSpaceConfig()`, `parseArgs()` |
| `lib/walker.js` | `walkEntryTree()`, `extractLinkReferences()` — BFS with depth/skip controls |
| `lib/mapper.js` | `remapFields(fields, entryIdMap, assetIdMap)`, `stripReferenceFields()`, `filterLocales()`, `fetchAllowedLocales()` |
| `lib/catalog.js` | `rebuildGlobalCsv()`, `loadGlobalRemap()`, `saveGlobalRemap()`, `loadAssetRemap()`, `saveAssetRemap()`, `findEntryInCatalog()`, `getEntryPath()` |
| `lib/helpers.js` | `RATE_LIMIT_DELAY`, `sleep()`, `getEntryTitle()` — shared constants and utilities |
| `lib/two-pass.js` | `createEntryShells()`, `linkReferences()`, `publishEntries()` — shared two-pass creation logic |
| `lib/assets.js` | `migrateAssets()`, `collectAssetIds()` — asset migration with filename-based dedup |
| `lib/scope.js` | `resolveScope()`, `scopeFromArgs()` — unified scope resolution for transforms/locale |
| `lib/schema.js` | `loadSchemas()`, `loadDefaults()`, `applyDefaults()`, `validateSpec()`, `toSlug()` |

---

## Store Structure

```
store/
├── entries/                        # Global deduplicated catalog
│   ├── page/                       # One folder per content type
│   │   └── 4HmRxJk2OikYAU72YeTKEv.json
│   ├── cta/
│   │   ├── abc123.json             # Stored ONCE even if used by 10 pages
│   │   └── def456.json
│   ├── richTextBlock/
│   │   └── ghi789.json
│   └── ... (one folder per content type)
├── extractions/                    # Thin manifests (metadata only, no entry data)
│   ├── qa-bento-cards.json
│   └── qa-rte-brand-expression.json
├── index.csv                       # Global searchable index of all entries
├── remap.json                      # Global source→target entry ID mapping
└── asset-remap.json                # Global source→target asset ID mapping
```

### Key Principles

- **Entries stored globally by content type** — not per-extraction
- **No duplication** — extracting page B that shares CTAs with page A won't re-store those CTAs
- **Extraction manifests are thin** — reference entries in catalog, don't contain data
- **One global remap** — tracks all source→target mappings across all operations
- **One global CSV** — indexes everything, searchable by name, type, or extraction

---

## Key Design Decisions

### 1. Locale Auto-Filtering
When creating entries in the target space, the script auto-detects allowed locales via `environment.getLocales()` and strips unsupported locale keys before sending. Prevents "Invalid field locale code" errors when source and target have different locale configurations.

### 2. Skip Types (Navigation Link Protection)
The BFS walker skips traversal into `page` content types by default when they're referenced from non-root entries. Prevents "exploding" extractions where a CTA's `internalLink` to a page would cause the entire page tree to be extracted. Override with `--skip-types` or `--no-skip`.

### 3. Depth Control
Extraction and migration support `--depth N` (0 = root only, 1 = root + children, etc.). Default is unlimited for extract, 1 for migrate.

### 4. Two-Pass Creation
Handles circular references:
- **Pass 1**: Create "shell" entries with non-reference fields only → get new IDs
- **Pass 2**: Update entries with remapped references using new ID map

### 5. Force / Update Modes
- **Default**: Skip entries already in remap.json
- **`--force`**: Ignore remap, create new entries (new IDs) regardless
- **`--update`**: Overwrite existing target entries in-place; auto-creates if target was deleted
- **`--force --update`**: Overwrite existing + create new for unmapped entries

### 6. Transform Runner
JSON spec files define scope (which entries) and transforms (what to change). The AI agent generates specs from natural language, user reviews and runs them. Supports: `copy`, `set`, `delete`, `rename-locale`, `modify` rules.

### 7. Schema-Driven Content Authoring
Content creation doesn't depend on local extracted data. Instead:
- `generate-schemas.js` pulls **all** content type definitions from Contentful's `getContentTypes()` API → writes `config/content-schemas.json`
- `create-content.js` reads content spec files referencing entries via three modes:
  - `@localId` — link to a new entry defined in the same spec
  - `existing:<id>` — link to an existing Contentful entry by ID
  - `lookup:<contentType>:<name>` — live-search Contentful for an entry by name
  - `asset:<id>` — link to an existing asset
- Schemas are cached locally (~3-5KB) for token efficiency; refreshed on-demand
- Runtime fallback: if a content type is not in the cached schema, the script continues (schema is used for validation only, not gating)
- Templates: clone an existing live entry's fields with `"template": "<entryId>"` + `"overrides": {...}`

### 8. Asset Migration with Deduplication
Assets (images, files) are transferred from source to target space using `--with-assets` flag on `create` and `migrate` commands. Key design:

- **No local download.** Contentful's API accepts a `upload` URL — the source CDN URL is passed directly, and Contentful's servers fetch and re-host the file.
- **Dedup cascade on cold start** (no `asset-remap.json`):
  1. Check `asset-remap.json` cache
  2. Search target space by **exact filename** match (`fields.file.fileName`)
  3. Fallback: search by **title** match
  4. Only create a new asset if no existing match found
- **Asset remapping in entries.** `remapFields()` now accepts an optional `assetIdMap` to replace asset link IDs alongside entry link IDs.
- **Stored in `store/asset-remap.json`** — persists across runs for subsequent dedup.

### 9. Modular Architecture (v5.0)
Common logic is extracted into shared `lib/` modules to eliminate duplication:
- **`lib/helpers.js`** — `sleep()`, `RATE_LIMIT_DELAY`, `getEntryTitle()` (was duplicated in 4 files)
- **`lib/two-pass.js`** — `createEntryShells()`, `linkReferences()`, `publishEntries()` (was duplicated in `create.js`, `migrate.js`, `create-content.js`)
- **`lib/scope.js`** — unified scope resolution from extractions/types/entries/query/all (was in `run-transform.js` and `update-locale.js`)
- **`lib/schema.js`** — schema/defaults loading, validation, default-application (was in `create-content.js`)
- **`lib/assets.js`** — asset migration with dedup logic (new)
- **`lib/catalog.js`** — now includes `findEntryInCatalog()` and asset remap I/O

### 10. Production Content Conventions (content-defaults.json)
`config/content-defaults.json` encodes production patterns discovered from extracted data:
- **Default field values** per content type (e.g., `page.seoNoFollow = false`, `hero.heroStyle = "Standard"`)
- **Enum references** — all allowed values for enum fields (heroStyle, cardAppearance, ratio, etc.)
- **Composition chains** — which content types nest inside which (page → hero → heroSlide → mediaAsset → imageWithFocalPoint)
- **Naming conventions** — `QA {PageName} {ComponentType} {Variant}` prefix pattern
- **Locale conventions** — en-IN values = en value + "-IN" suffix; CTA styles duplicated across locales
- **Auto-applied by `create-content.js`**:
  - Missing defaults filled in automatically
  - `page.slug` auto-generated from `entryName` (kebab-case)
  - `page.pageTitle` copied from `entryName` if missing
  - Child entry names auto-prefixed with `spec.pageName` for traceability
  - Enum values validated against allowed values

---

## Content Schemas

### Generating schemas

```bash
npm run generate-schemas                    # From source space (default)
npm run generate-schemas -- --space target  # From any configured space
```

Calls `environment.getContentTypes()` and writes `config/content-schemas.json` with:
- Field names, types (Symbol, Text, RichText, Integer, Boolean, Array, Link, etc.)
- Required flags
- Allowed values (`in` validations)
- Linked content types (for Link/Array fields)
- Size/range validations

### Schema file location

`config/content-schemas.json` — agent reads this single file to understand how to create any entry.

### When to refresh

- First time setting up the project
- After content model changes (new fields, new content types)
- When switching spaces

---

## Content Spec Format

Content specs are JSON files that define entries to create and how they link together.

### Reference types in field values

| Syntax | What happens |
|--------|-------------|
| `@localId` | Links to a new entry in the same spec (created in Pass 1) |
| `existing:<contentfulId>` | Links to an existing entry — no API call, just wires the reference |
| `lookup:<contentType>:<name>` | Live-queries Contentful by entryName, returns the ID |
| `asset:<assetId>` | Links to an existing asset |

### Field value format

Fields can be specified as simple values (auto-wrapped in the default locale):

```json
{ "entryName": "My Page", "autoplay": true, "pageContent": ["@hero-1", "@rte-1"] }
```

Or as locale-wrapped objects for multi-locale content:

```json
{ "title": { "en": "English Title", "en-IN": "India Title" } }
```

### Template-based creation

Clone an existing live entry's fields and override specific values:

```json
{
  "id": "new-rte",
  "contentType": "richTextBlock",
  "template": "4Y0HCkTLM8AhriFRIsDpRH",
  "overrides": { "entryName": "New RTE based on template" }
}
```

### Complete spec example — all new entries

```json
{
  "space": "target",
  "locale": "en",
  "entries": [
    {
      "id": "root",
      "contentType": "page",
      "fields": {
        "entryName": "My New Page",
        "pageTitle": "My New Page",
        "slug": "my-new-page",
        "pageContent": ["@hero-1", "@split-1", "@video-1"]
      }
    },
    { "id": "hero-1", "contentType": "hero", "fields": { "entryName": "Hero", "heroStyle": "Full Width" } },
    { "id": "split-1", "contentType": "splitLayoutBlock", "fields": { "entryName": "Split Block" } },
    { "id": "video-1", "contentType": "kalturaVideoBlock", "fields": { "entryName": "Video", "kalturaVideoId": "12345" } }
  ]
}
```

### Complete spec example — mix of new + existing + lookup

```json
{
  "space": "target",
  "locale": "en",
  "entries": [
    {
      "id": "root",
      "contentType": "page",
      "fields": {
        "entryName": "Mixed Page",
        "pageTitle": "Mixed Page",
        "slug": "mixed-page",
        "pageContent": [
          "@new-hero",
          "lookup:richTextBlock:QA-rte-Brand-expression",
          "existing:4Y0HCkTLM8AhriFRIsDpRH"
        ]
      }
    },
    { "id": "new-hero", "contentType": "hero", "fields": { "entryName": "New Hero", "heroStyle": "Slimline" } }
  ]
}
```

---

## Spec Generation Rules for AI Agents

When generating a content spec from a user's natural language request, follow these rules:

### Before generating a spec
1. Read `config/content-schemas.json` to know required fields and types
2. Read `config/content-defaults.json` to know defaults, enums, and composition chains
3. You do NOT need the local store — schemas and defaults are the only knowledge base

### Naming conventions
- Set `spec.pageName` to the page name (e.g., `"QA India Energy Hub"`)
- Page `entryName`: `"QA {PageName}"` (e.g., `"QA India Energy Hub"`)
- Child entries: short names (e.g., `"Hero"`, `"Split Block"`) — the script auto-prefixes with `pageName`
- Slug: auto-generated from entryName; don't set manually unless the user specifies one

### Fields you can skip (auto-filled)
- `page.slug` — auto-generated from entryName
- `page.pageTitle` — copied from entryName
- `page.seoNoFollow`, `page.seoNoIndex` — default false
- `page.includeInNavigation`, `page.includeInSitemap` — default true
- `page.navigationPriority` — default 1000
- `page.metaDescription` — default "Meta Description"
- `hero.autoplay` — default false
- `splitLayoutBlock.ratio` — default "equal-split"
- `splitLayoutBlock.stickyColumn` — default "none"
- `cta.style` — default "Primary"
- `kalturaVideoBlock.controls` — default true
- All other defaults in `content-defaults.json`

### Enum field values (always pick from these)
- `page.pageType`: Standard, Energy in focus, Press release, Publication, Speech
- `hero.heroStyle`: Standard, Slimline
- `hero.titleColumnWidth`: 7 Columns, 9 Columns, 12 Columns
- `cta.style`: Primary, Secondary, Tertiary
- `card.cardAppearance`: Standard With Image, Group Of Links, Glass, Asset, Asset - Vision, Asset - Multi, Share Price, CTA, Static, Quote - Left aligned, Quote - Centre aligned, Tools, etc.
- `bentoGridBlock.cardLayout`: Single Card, 2 Columns, 3 Columns, 4 Columns, 3+2 Columns, 4+4 Columns
- `splitLayoutBlock.ratio`: equal-split, one-third-left, one-third-right
- `mediaAsset.aspectRatio`: 16:9, 3:4, 3:2, 1:1
- `tout.desktopFormat`: Media left, Media right
- `embedBlock.embedType`: DotDigital, Podbean, Everviz

### Composition chain (what goes inside what)
```
page.pageContent[]          → hero, splitLayoutBlock, richTextBlock, bentoGridBlock,
                              kalturaVideoBlock, fullWidthMediaBlock, embedBlock, tout,
                              cardCollection, downloadsBlock, filteredListBlock, footnote, etc.
hero.slides[]               → heroSlide
heroSlide.media             → mediaAsset
splitLayoutBlock.leftItems[]  → richTextBlock, kalturaVideoBlock, tout, etc.
splitLayoutBlock.rightItems[] → same
bentoGridBlock.cards[]      → card
card.quote                  → quote
tout.media                  → mediaAsset
fullWidthMediaBlock.media   → mediaAsset
kalturaVideoBlock.posterImage → imageWithFocalPoint
mediaAsset.image            → imageWithFocalPoint
imageWithFocalPoint.image   → Asset (Contentful Asset, use asset:<id>)
```

### Image chain
Images always go through: `mediaAsset` → `imageWithFocalPoint` → `Asset`.
When the user doesn't provide specific images, either:
- Use `lookup:mediaAsset:<name>` to find an existing one
- Use `existing:<id>` if the user provides an asset ID
- Leave the image fields empty (entry will be created without images, user fills them manually)

### Rich text content
For `richTextBlock.content`, use Contentful Rich Text JSON format:
```json
{
  "nodeType": "document",
  "data": {},
  "content": [
    {
      "nodeType": "paragraph",
      "data": {},
      "content": [
        { "nodeType": "text", "value": "Your text here", "marks": [], "data": {} }
      ]
    }
  ]
}
```

### Multi-locale pattern
For en-IN locale, follow the production convention:
```json
{ "title": { "en": "Some Title", "en-IN": "Some Title-IN" } }
```

---

## Quick Command Reference

```bash
# === SETUP ===
npm install
cp .env.example .env  # Add CMA tokens
# Edit config/spaces.json with space IDs

# === EXTRACT (to local store) ===
npm run extract -- --entry <id>                    # Unlimited depth, auto-name
npm run extract -- --entry <id> --depth 0          # Root only
npm run extract:shallow -- --entry <id>            # Depth 1
npm run extract:medium -- --entry <id>             # Depth 3
npm run extract:full -- --entry <id>               # No skip, unlimited

# === CREATE (from local to target) ===
npm run create -- --name <extraction> --space target           # Default create
npm run create:force -- --name <extraction> --space target     # Ignore remap
npm run create:update -- --name <extraction> --space target    # Overwrite existing
npm run create:with-assets -- --name <extraction> --space target  # Create + migrate assets
npm run create:preview -- --name <extraction> --space target   # Dry run

# === MIGRATE (direct source → target) ===
npm run migrate -- --entry <id>                    # Depth 1
npm run migrate:solo -- --entry <id>               # Depth 0 (root only)
npm run migrate:with-assets -- --entry <id>        # Migrate + transfer assets
npm run migrate:preview -- --entry <id>            # Dry run

# === CREATE CONTENT (schema-driven authoring) ===
npm run generate-schemas                                       # Pull schemas from Contentful
npm run create-content -- --spec specs/my-page.json            # Create from spec
npm run create-content:preview -- --spec specs/my-page.json    # Dry run

# === TRANSFORM (agentic field updates) ===
npm run transform -- --spec transforms/my-spec.json           # Run spec
npm run transform:preview -- --spec transforms/my-spec.json   # Dry run

# === LOCALE (bulk copy locale fields) ===
npm run locale -- --from en --to en-IN --name <extraction>
npm run locale:preview -- --from en --to en-IN --type richTextBlock

# === QUERY (read-only JSON inspector — for agentic workflows) ===
npm run query -- --entry <id>                                      # Full entry dump (sys + fields + refs)
npm run query -- --entry <id> --field entryName --locale en-IN     # Check specific field+locale
npm run query -- --entry <id> --children                           # List linked child entries
npm run query -- --entry <id> --no-resolve                         # Skip resolving refs (faster)
npm run query -- --type page --count                               # Count entries of a type
npm run query -- --type hero --field entryName --match "Hero-IN"   # Search by field value
npm run query:json -- --entry <id>                                 # Clean JSON only (no stderr logs)

# === INSPECT (live entry metadata) ===
npm run inspect -- --entry <id>                       # Dates, versions, status
npm run inspect -- --entry <id> --space target        # Inspect in target space

# === BROWSE ===
npm run list                                # Overview
npm run list -- --type cta                  # Entries by content type
npm run list -- --name <extraction>         # Extraction details
npm run help                                # All commands
```

---

## Transform Spec Format

Transform specs are JSON files that define **what to change** and **where to change it**.

### Scope Types

```json
// Single entry
{ "entry": "abc123" }

// Entry + children
{ "entry": "abc123", "depth": 1 }

// Entry IDs list
{ "entries": ["abc123", "def456"] }

// All entries in an extraction
{ "extraction": "qa-bento-cards" }

// Filter extraction by content type
{ "extraction": "qa-bento-cards", "contentType": "richTextBlock" }

// Live Contentful query (no local store needed)
{ "contentType": "richTextBlock", "query": { "fields.entryName[match]": "QA" } }

// All of a content type (local catalog)
{ "contentType": "cta" }

// Everything in catalog
{ "all": true }
```

### Transform Rules

```json
// Copy locale with optional suffix/prefix
{ "rule": "copy", "field": "title", "sourceLocale": "en", "targetLocale": "en-IN", "suffix": "-IN" }

// Set a specific value
{ "rule": "set", "field": "style", "targetLocale": "en-GB", "value": "Primary" }

// Delete a locale from a field
{ "rule": "delete", "field": "title", "targetLocale": "en-IN" }

// Rename a locale key
{ "rule": "rename-locale", "field": "title", "sourceLocale": "en-US", "targetLocale": "en" }

// Modify existing value (add suffix/prefix/replace)
{ "rule": "modify", "field": "title", "targetLocale": "en-IN", "suffix": " (updated)" }
{ "rule": "modify", "field": "title", "targetLocale": "en", "replace": { "from": "Draft", "to": "Final" } }

// Apply to ALL fields (omit "field")
{ "rule": "copy", "sourceLocale": "en", "targetLocale": "en-IN" }
```

### Complete Spec Example

```json
{
  "space": "source",
  "scope": {
    "contentType": "richTextBlock",
    "query": { "fields.entryName[match]": "QA" }
  },
  "transforms": [
    { "rule": "copy", "field": "title", "sourceLocale": "en", "targetLocale": "en-IN", "suffix": "-IN" },
    { "rule": "set", "field": "style", "targetLocale": "en-GB", "value": "Primary" }
  ]
}
```

---

## How Deduplication Works

### Entries
1. **At extraction**: Entries stored globally by content type. Re-extracting refreshes existing files.
2. **At creation**: Before creating, checks `remap.json`. Already-mapped entries are skipped.
3. **Cross-extraction**: Entries shared between pages use the same target ID.
4. **Force mode**: Bypasses remap, creates new entries with new IDs.

### Assets
1. **Warm start** (asset-remap.json exists): Check cache first, skip already-mapped assets.
2. **Cold start** (no mapping file): Search target space by exact filename → fallback to title match.
3. **If match found**: Map source→target asset ID, no new asset created.
4. **If no match**: Create new asset in target using source CDN URL (no local download).
5. **Entry linking**: Asset references in entries are remapped to target asset IDs automatically.

---

## Agent Task Patterns

### Task: Answer Any Question About Contentful Content (Agentic Query)

**This is the primary agentic workflow.** When the user asks a natural language question about their Contentful content, use `query.js` to fetch structured JSON, then interpret the JSON to answer.

**Workflow:**
1. Parse the user's question to determine: entry ID, content type, field name, locale, or search criteria
2. Run the appropriate `npm run query` command
3. Read the JSON output
4. Answer the user's question in plain English
5. If the user wants changes → generate a transform spec from the query data

**Command selection guide:**

| User asks… | Command to run |
|-----------|---------------|
| "What is the en-IN title for entry X?" | `npm run query -- --entry X --field entryName --locale en-IN` |
| "When was entry X first published?" | `npm run query -- --entry X --no-resolve` (check `sys.firstPublishedAt`) |
| "How many pages exist?" | `npm run query -- --type page --count` |
| "Which heroes have 'Hero-IN' as the name?" | `npm run query -- --type hero --field entryName --match "Hero-IN"` |
| "What's inside entry X?" | `npm run query -- --entry X` (full dump with resolved refs) |
| "How many children does entry X have?" | `npm run query -- --entry X --children` |
| "Show me all CTAs" | `npm run query -- --type cta` |
| "Which entries don't have en-IN locale?" | `npm run query -- --type <type> --field entryName --locale en-IN` (check `localeStats`) |

**JSON output modes:**
- `npm run query` — JSON to stdout, progress logs to stderr (human-friendly)
- `npm run query:json` — JSON to stdout only, stderr suppressed (pipe-friendly)

**Read-only guarantee:** `query.js` only calls `getEntry()`, `getEntries()`, and `getAsset()` — never modifies data.

**Follow-up pattern:** If the user says "fix it" or "change that", generate a transform spec JSON from the query results and present it for review. The user then runs `npm run transform -- --spec <path>`.

### Task: Inspect Entry Metadata (Dates, Versions, Status)
```bash
npm run inspect -- --entry <id>                  # Inspect in source (default)
npm run inspect -- --entry <id> --space target   # Inspect in target space
```

### Task: Extract a Page
```bash
npm run extract -- --entry 4HmRxJk2OikYAU72YeTKEv
```

### Task: Extract Only a Component (No Children)
```bash
npm run extract -- --entry <id> --depth 0
```

### Task: Direct Migrate an Entry
```bash
npm run migrate:solo -- --entry <id>    # Just the entry
npm run migrate -- --entry <id>         # Entry + direct children
```

### Task: Create in Target (from local)
```bash
npm run create -- --name qa-bento-cards --space target
```

### Task: Re-create After Deleting from Target
```bash
npm run create:force -- --name qa-bento-cards --space target
```

### Task: Update Stale Content in Target
```bash
npm run create:update -- --name qa-bento-cards --space target
```

### Task: Bulk Locale Copy
```bash
npm run locale -- --from en --to en-IN --name qa-bento-cards --space source
```

### Task: Agentic Field Transform
1. AI generates a spec JSON from natural language instruction
2. Save to `transforms/` folder
3. Run: `npm run transform -- --spec transforms/my-spec.json`

### Task: Create a Page from Scratch
1. Read `config/content-schemas.json` to know required fields
2. Generate a content spec JSON with `@` refs between entries
3. Save to `specs/` folder
4. Run: `npm run create-content -- --spec specs/my-page.json`

### Task: Create a Page Mixing New + Existing Entries
1. Read schemas for field requirements
2. Use `lookup:<type>:<name>` for existing entries the user mentions by name
3. Use `existing:<id>` for entries the user provides by ID
4. Use `@localId` for new entries to create
5. Generate spec, save, run

### Task: Migrate with Assets
```bash
npm run migrate:with-assets -- --entry <id>                          # Entries + assets
npm run create:with-assets -- --name <extraction> --space target     # From local store + assets
```

### Task: Clone an Entry with Modifications
1. Use `"template": "<entryId>"` to clone the live entry's fields
2. Use `"overrides": {...}` to change specific fields
3. Template is fetched live from Contentful — no local store needed

### Task: Refresh Content Schemas
```bash
npm run generate-schemas                    # From source (default)
npm run generate-schemas -- --space target  # From target
```

### Task: Add a New Space
1. Edit `config/spaces.json` — add new alias
2. Add token to `.env`
3. Use `--space <alias>` in any command

---

## Configuration

### config/spaces.json
```json
{
  "source": {
    "spaceId": "vsw90ltyito7",
    "environmentId": "dev",
    "tokenEnvVar": "SOURCE_CMA_TOKEN"
  },
  "target": {
    "spaceId": "o706xxe15q68",
    "environmentId": "rma",
    "tokenEnvVar": "TARGET_CMA_TOKEN"
  }
}
```

### .env
```
SOURCE_CMA_TOKEN=CFPAT-xxxxx
TARGET_CMA_TOKEN=CFPAT-yyyyy
```

---

## Web UI Agent (Ollama Integration)

Two browser-based UIs provide an AI chat agent backed by Ollama that can query and operate on Contentful content.

### Architecture

```
User (browser) → AI Chat → Ollama (localhost:11434, gpt-oss:20b)
                              ↓ tool_calls
                     ┌──────────────────┐
                     │  READ tools      │ → auto-executed, result fed back to Ollama
                     │  (get_entry,     │
                     │   search_entries, │
                     │   list_types,    │
                     │   analyze)       │
                     ├──────────────────┤
                     │  WRITE tools     │ → JSON card shown to user (copy & execute separately)
                     │  (update_entry,  │
                     │   transform,     │
                     │   migrate, etc.) │
                     └──────────────────┘
```

### Versions

| Version | Location | Stack | How to run |
|---------|----------|-------|------------|
| **web-lite** | `web-lite/` | Vanilla Preact (no build step) | `npx serve web-lite` → open in browser |
| **web** | `web/` | Next.js + React + Tailwind | `cd web && npm run dev` → `localhost:3000/agent` |

Both versions share identical agent logic (tool definitions, system prompt, Ollama client). The web-lite version uses plain JS; the web version uses TypeScript.

### Key Files

| Purpose | web-lite | web (Next.js) |
|---------|----------|---------------|
| Agent UI + tool execution | `web-lite/agent/AIAgent.js` | `web/src/app/agent/page.tsx` |
| Tool definitions | `web-lite/agent/tool-definitions.js` | `web/src/lib/agent/tool-definitions.ts` |
| System prompt | `web-lite/agent/system-prompt.js` | `web/src/lib/agent/system-prompt.ts` |
| Ollama client | `web-lite/agent/ollama-client.js` | `web/src/lib/agent/ollama-client.ts` |
| Tool call parser | `web-lite/agent/tool-parser.js` | `web/src/lib/agent/tool-parser.ts` |

### get_entry Tool (Enhanced)

The `get_entry` read-only tool returns structured JSON with:
- **Full sys metadata**: `createdAt`, `firstPublishedAt`, `publishedAt`, `updatedAt`, `version`, `publishedVersion`, `publishedCounter`, `status`, `createdBy`, `updatedBy`
- **All field values with all locales** (not just the default locale preview)
- **Locale coverage map**: which locales are populated for each field
- **Optional `field` param**: return only a specific field across all locales
- **Optional `locale` param** (with `field`): check if a locale exists and return its value

This enables the AI agent to answer questions like:
- "When was this entry first published?" → reads `sys.firstPublishedAt`
- "Is the en-IN title Hero-IN?" → calls with `field: "entryName", locale: "en-IN"` → checks `found` and `value`
- "How many times has it been published?" → reads `sys.publishedCounter`
- "Which fields have en-IN locale?" → reads `localeCoverage`

### Agent Task: Making Changes from Query Results

When the user asks to fix something after a read query:
1. The AI generates a `update_entry` or `transform` tool call (write tool)
2. The UI shows the JSON as a copyable card (not auto-executed)
3. The user reviews the JSON and executes it via Cursor or the manual UI

### Prerequisites

- **Ollama running**: `ollama serve`
- **Model available**: `gpt-oss:20b` (check with `ollama list`)
- **CMA token**: entered in the browser UI login screen

---

## Limitations

1. **Content model must match.** Content type IDs and field IDs must be identical in source and target.
2. **Rate limiting.** 300ms delay between API calls. Large operations take time.
3. **Rich text embedded entries** temporarily stripped during Pass 1, restored in Pass 2.
4. **Locales auto-filtered.** Source locales not enabled in target are silently dropped during create/migrate.
5. **Asset migration requires `--with-assets` flag.** Not automatic — must be opted into.
6. **Asset dedup relies on filename match.** If the same image has different filenames in source and target, a duplicate will be created. Title match is used as a fallback.
7. **Asset processing is async.** After creating an asset, the script polls for up to 30s for Contentful to finish processing the upload.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `contentful-management` | CMA SDK (read + write entries) |
| `dotenv` | Load .env tokens |
| `csv-writer` | Generate index.csv |

No build step. Pure Node.js ES modules. Node 18+ required.
