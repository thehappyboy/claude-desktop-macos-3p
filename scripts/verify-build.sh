#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/dist/Claude-3p.app}"

test -d "$APP"
codesign --verify --deep --strict "$APP"
echo "codesign: ok"

node "$ROOT/scripts/verify-build.mjs" "$APP"

for marker in rollout status appscoped; do
  if ! grep -aq "__macCu3P_${marker}" "$APP/Contents/Resources/app.asar"; then
    echo "missing patch marker: $marker" >&2
    exit 1
  fi
done

for stale in enabled optedout; do
  if grep -aq "__macCu3P_${stale}" "$APP/Contents/Resources/app.asar"; then
    echo "stale policy-bypassing patch marker: $stale" >&2
    exit 1
  fi
done
echo "patch markers: ok"
