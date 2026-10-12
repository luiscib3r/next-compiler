import fs from "node:fs";

const file = "/$bunfs/root/app/style.css";
const tests: Record<string, () => unknown> = {
  readFileSync: () => fs.readFileSync(file, "utf8"),
  statSync: () => fs.statSync(file),
  openSync: () => fs.openSync(file, "r"),
  realpathSync: () => fs.realpathSync(file),
  createReadStream: () =>
    new Promise((ok, fail) =>
      fs.createReadStream(file).on("data", ok).on("error", fail),
    ),
};

for (const [name, test] of Object.entries(tests)) {
  try {
    await test();
    console.log("✅", name);
  } catch (e) {
    console.log("❌", name, "→", (e as NodeJS.ErrnoException).code);
  }
}
