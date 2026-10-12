await Bun.build({
  entrypoints: ["./main.ts"],
  compile: { outfile: "./exp", assets: ["./app"] },
});
