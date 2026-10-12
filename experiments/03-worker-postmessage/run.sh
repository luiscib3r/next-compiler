#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "--- node"
node worker.mjs
echo "--- bun"
bun worker.mjs
