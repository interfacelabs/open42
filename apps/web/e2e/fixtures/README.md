# E2E fixtures

This directory holds binary fixtures used by the Playwright specs.

## `sample.zip`

A small Notion-export-shaped zip used by the upload portion of
`auth-onboarding.spec.ts`. The spec gracefully skips the upload assertion when
the file is missing.

To regenerate: open a Notion workspace, export it as Markdown + CSV (small —
just a couple of pages), and drop the resulting zip here as `sample.zip`. Do
NOT commit a workspace export with sensitive content.

The file is intentionally not committed to keep the repo small and avoid
checking in proprietary content.
