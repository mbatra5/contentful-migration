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

### 4. Cross-Space Migration (generate spec)

```bash
# Generate a spec from any source entry (all defaults baked in)
npm run generate-spec -- --entry <source-entry-id>

# Create in target (draft)
npm run create-content -- --spec specs/<entry-id>.json

# Create with a tag applied to all entries
npm run create-content -- --spec specs/<entry-id>.json --tag <tagId>
```

Walks the full entry tree, replaces page links with a blank page, wires images/files to existing target assets, remaps embedded entries in rich text, and appends `" - RMA"` suffix to entry names and slugs.

### 5. Create Content from Scratch (schema-driven)

```bash
npm run generate-schemas                                    # One-time: pull content type schemas
npm run create-content -- --spec specs/my-page.json         # Create from spec
```

Supports `@localId` (new entries), `existing:<id>`, `lookup:<type>:<name>` (live search), and `template` (clone + override).

### 6. Tagging

```bash
npm run create-tag -- --name "myTagName"                     # Create a tag
npm run tag -- --entry <id> --tag <tagId> --space target     # Tag entry + all children
npm run tag:preview -- --entry <id> --tag <tagId>            # Dry run
```

### 7. Agentic Transforms (JSON spec)

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
- **Cross-space spec generation**: Walk any source entry tree, remap all links/assets/pages, output ready-to-run spec
- **Tagging**: Create tags, tag at creation time (`--tag`), or tag existing entries retroactively
- **Rich text remapping**: Embedded entries and links inside rich text are properly remapped during migration
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
