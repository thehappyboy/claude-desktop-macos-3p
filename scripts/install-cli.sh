#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
ln -sf "$ROOT/bin/claude-3p" "$BIN_DIR/claude-3p"
echo "[cli] installed $BIN_DIR/claude-3p -> $ROOT/bin/claude-3p"
echo "[cli] run: claude-3p --diagnose"
