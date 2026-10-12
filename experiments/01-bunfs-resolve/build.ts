// Embeds ./app so resolution happens inside /$bunfs, not from the real disk.
await Bun.build({
  entrypoints: ["./main.ts"],
  compile: { outfile: "./exp", assets: ["./app"] },
});
