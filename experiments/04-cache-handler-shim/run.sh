#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf exp
bun build.ts
mv app app.bak
./exp
status=$?
mv app.bak app
rm -f exp
exit "$status"
