#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${CLAUDE_APP:-/Applications/Claude.app}"
OUT="${OUT_APP:-$ROOT/dist/Claude-3p.app}"

exec node "$ROOT/scripts/patch-app.mjs" --app "$APP" --out "$OUT" "$@"
