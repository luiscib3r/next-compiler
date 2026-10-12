#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf app app.bak exp
mkdir -p app
echo "body { color: red; }" > app/style.css
bun build.ts
mv app app.bak
./exp
status=$?
rm -rf app.bak exp
exit "$status"
