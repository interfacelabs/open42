#!/usr/bin/env bash
# F1 spike: validate gbrain submit_job('import', { dir }) semantics.
#
# Confirms whether `import` is upsert (additive) or replace-corpus.
# Run against the pinned gbrain version. See
# docs/superpowers/specs/2026-05-06-composio-connectors-design.md "D6. gbrain delivery".
#
# Result on gbrain v0.27.1 (2026-05-06): import is UPSERT.
# - importing dirA (page-x, page-y) then dirB (page-z) leaves all three.
# - re-importing dirA with modified page-x overwrites in place (1 imported, 1 unchanged).

set -euo pipefail

if ! command -v gbrain >/dev/null 2>&1; then
  echo "gbrain not on PATH. Install: bun install -g gbrain"
  exit 1
fi

ROOT=$(mktemp -d -t open42-f1-spike.XXXXXX)
trap 'rm -rf "$ROOT"' EXIT

export GBRAIN_HOME="$ROOT/brain"
mkdir -p "$GBRAIN_HOME" "$ROOT/dirA" "$ROOT/dirB"

cat > "$ROOT/dirA/page-x.md" <<'EOF'
---
title: Page X
type: doc
---

Original X content.
EOF

cat > "$ROOT/dirA/page-y.md" <<'EOF'
---
title: Page Y
type: doc
---

Y content.
EOF

cat > "$ROOT/dirB/page-z.md" <<'EOF'
---
title: Page Z
type: doc
---

Z content (only in dirB).
EOF

echo "==> init brain"
gbrain init --pglite >/dev/null 2>&1

echo "==> import dirA (expect: page-x, page-y)"
gbrain import "$ROOT/dirA" --no-embed | tail -3

echo "==> import dirB (expect: + page-z, page-x and page-y still present if upsert)"
gbrain import "$ROOT/dirB" --no-embed | tail -3

echo "==> page list after both imports:"
PAGES=$(gbrain list 2>/dev/null | awk '{print $1}' | sort | tr '\n' ' ')
echo "    $PAGES"

EXPECTED="page-x page-y page-z "
if [[ "$PAGES" == "$EXPECTED" ]]; then
  echo "==> RESULT: import is UPSERT (additive). All pages from both dirs present."
else
  echo "==> RESULT: UNEXPECTED — pages differ from upsert expectation."
  echo "    expected: $EXPECTED"
  echo "    got:      $PAGES"
  exit 1
fi

# Modify page-x and re-import dirA. Expect: page-x updated, page-y skipped as unchanged.
cat > "$ROOT/dirA/page-x.md" <<'EOF'
---
title: Page X (modified)
type: doc
---

Modified X content.
EOF

echo "==> re-import dirA with modified page-x (expect: 1 imported, 1 unchanged)"
SUMMARY=$(gbrain import "$ROOT/dirA" --no-embed | tail -3)
echo "$SUMMARY"

if echo "$SUMMARY" | grep -q "1 pages imported" && echo "$SUMMARY" | grep -q "1 unchanged"; then
  echo "==> RESULT: re-import skips unchanged files and overwrites modified ones in place."
else
  echo "==> RESULT: UNEXPECTED — re-import did not behave as upsert."
  exit 1
fi

# Verify page-x content was updated and page-y is still present.
NEW_X=$(gbrain get page-x | grep -i "Modified X content" || true)
STILL_Y=$(gbrain list 2>/dev/null | awk '{print $1}' | grep -c '^page-y$' || true)

if [[ -n "$NEW_X" && "$STILL_Y" -eq 1 ]]; then
  echo "==> Final state: page-x updated, page-y untouched. UPSERT confirmed."
else
  echo "==> Final state assertions failed."
  exit 1
fi

echo
echo "F1 spike complete: gbrain submit_job('import', { dir }) is UPSERT."
