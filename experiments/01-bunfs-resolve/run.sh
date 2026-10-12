#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf app app.bak exp
mkdir -p app/node_modules/foo app/sub
echo '{"name":"foo","main":"index.js"}' > app/node_modules/foo/package.json
echo 'module.exports = "soy foo";' > app/node_modules/foo/index.js
echo 'module.exports = "soy x";' > app/sub/x.js
bun build.ts
mv app app.bak
./exp
status=$?
rm -rf app.bak exp
exit "$status"
