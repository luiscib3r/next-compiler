import { createRequire } from "node:module";

const require = createRequire("/$bunfs/root/app/index.js");

for (const id of [
  "./sub/x.js",
  "/$bunfs/root/app/node_modules/foo/index.js",
  "foo",
]) {
  try {
    console.log("✅", id, "→", require.resolve(id));
  } catch (e) {
    console.log("❌", id, "→", (e as Error).message);
  }
}

// The article's follow-up: loading the CJS file as ESM throws.
try {
  require("./sub/x.js");
  console.log("✅ require(./sub/x.js) loaded");
} catch (e) {
  console.log("❌ require(./sub/x.js) →", (e as Error).message);
}
