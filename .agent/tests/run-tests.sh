#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo " Antigravity Profile Test Runner"
echo "========================================"
echo ""

node.exe "$SCRIPT_DIR/check-game-version-compat.js"
bash "$SCRIPT_DIR/check-antigravity-profile.sh"
