# Contentful Migrator

Extract Contentful entries with all linked references, store them in a global catalog organized by content type, and recreate them selectively in another space. Also supports direct migration, schema-driven content authoring, bulk locale updates, and agentic field transforms.

## Quick Start

```bash
npm install
cp .env.example .env           # Add your CMA tokens
# Edit config/spaces.json with your space IDs
```

## Core Workflows

### 1. Extract → Create (via local store)

```bash
# Extract a page (walks all references automatically)
npm run extract -- --entry <entry-id>

# Preview what would be created
npm run create:preview -- --name <extraction-name> --space target

# Create in target
npm run create -- --name <extraction-name> --space target
```

### 2. Direct Migration (no local storage)

```bash
npm run migrate -- --entry <entry-id>          # Root + children
npm run migrate:solo -- --entry <entry-id>     # Root only
```

### 3. Bulk Locale Updates

```bash
npm run locale -- --from en --to en-IN --name <extraction-name>
```

### 4. Create Content from Scratch (schema-driven)

```bash
npm run generate-schemas                                    # One-time: pull content type schemas
npm run create-content -- --spec specs/my-page.json         # Create from spec
```

Supports `@localId` (new entries), `existing:<id>`, `lookup:<type>:<name>` (live search), and `template` (clone + override).

### 5. Agentic Transforms (JSON spec)

```bash
npm run transform -- --spec transforms/my-spec.json
```

## How it's organized

```
store/
├── entries/                    # Global catalog — one folder per content type
│   ├── page/                   #   Browse all pages
│   ├── cta/                    #   Browse all CTAs
│   ├── richTextBlock/          #   Browse all rich text blocks
│   └── ...
├── extractions/                # Page-level manifests (metadata, no entry data)
│   └── qa-bento-cards.json
├── index.csv                   # Searchable index of all entries
└── remap.json                  # Source-to-target ID mapping (global)
```

Entries are stored **once** even if referenced by multiple pages.

## Key Features

- **Configurable depth**: `--depth 0` (root only) to unlimited
- **Navigation link protection**: Skips page references from CTAs/links by default
- **Locale auto-filtering**: Strips unsupported locales when pushing to target
- **Deduplication**: Global catalog + remap.json prevent duplicate entries
- **Multiple create modes**: default, force, update, force-update
- **Content authoring**: Create entries from scratch via JSON specs with schema validation
- **Three reference modes**: `@localId`, `existing:id`, `lookup:type:name` for maximum flexibility
- **Template cloning**: Clone live entries with field overrides
- **Transform runner**: JSON spec files for bulk field operations
- **Dry run everything**: Every command supports `--dry-run` for safe previews

## Documentation

| File | Audience |
|------|----------|
| [USAGE.md](USAGE.md) | **Team guide** — all commands, examples, prompt templates |
| [AGENTS.md](AGENTS.md) | **AI agent handoff** — architecture, design decisions, task patterns |

## All Commands

```bash
npm run help     # Show all available commands with descriptions
```

## Prerequisites

- Node.js 18+
- Target space must have the same content model (content types and field IDs)
- Assets are referenced but not migrated
