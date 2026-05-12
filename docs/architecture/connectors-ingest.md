# Connectors And Ingest

Connectors normalize third-party content into markdown documents, then the
ingest orchestrator imports those documents into gbrain.

## Connector Interface

Every connector implements:

- `name`
- `version`
- `mode`: `one_shot` or `pollable`
- `extract(ctx, opts)`: returns an async iterable of normalized docs plus a
  final cursor object.

Normalized docs include a slug, title, markdown body, source reference, optional
source URL, optional modified time, tags, and author metadata.

## Implemented Connectors

| Connector | Mode | Notes |
| --- | --- | --- |
| `notion-zip` | one-shot | Parses Notion zip exports, skips images, limits entry count and byte size, converts CSV to markdown tables, strips Notion filename UUIDs. |
| `notion-composio` | pollable | Uses Composio tools to search Notion pages and fetch page content with page, block, byte, and time budgets. |

## Ingest Cycle

`runWorkspaceCycle()`:

1. Acquires a workspace ingest lock.
2. Creates an `ingest_jobs` row.
3. Extracts every pending or active connection.
4. Writes staged markdown files into a cycle directory.
5. Merges successful connector output into a final staging directory.
6. Calls gbrain `submit_job("import", { dir })`.
7. Polls gbrain job progress.
8. Advances cursors for successful connectors.
9. Releases the workspace lock and cleans staging files.

Lock heartbeats prevent two workers from importing the same workspace at once.
If the lock is lost, the cycle aborts and avoids advancing stale state.

## User Surfaces

The web app exposes connection setup under settings, manual sync through ingest
routes, and library views that query gbrain for pages/chunks plus Open42
citation metadata.
