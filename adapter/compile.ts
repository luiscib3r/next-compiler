// Compiles the generated server into a single executable. `build.ts` runs this
// file with `bun`, because `next build` may run on Node, which has no
// `Bun.build`. The CLI (`bun build`) cannot take plugins.
//
//   bun compile.ts <params as JSON>

import { dirname, join } from "node:path";

export type CompileParams = {
  input: string;
  output: string;
  /** Packages the bundle must not include. The runtime loads them. */
  externals: string[];
};

// Next requires these only when `next dev` runs (`if (opts.dev)`), but Bun
// bundles every static `require`. Together they pull in webpack, babel,
// postcss, the dev overlay and the MCP server: ~14MB the production server
// never runs.
const DEV_ONLY_MODULES = [
  "next/dist/server/lib/router-utils/setup-dev-bundler.js",
  "next/dist/server/dev/next-dev-server.js",
];

const devOnlyStub: Bun.BunPlugin = {
  name: "dev-only-stub",
  setup(build) {
    build.onLoad({ filter: /next[\\/]dist[\\/].*\.js$/ }, (args) => {
      const path = args.path.replaceAll("\\", "/");
      const devOnly = DEV_ONLY_MODULES.find((name) => path.endsWith(name));
      if (!devOnly) return undefined;
      // Fails loudly if the production server ever requires it.
      return {
        loader: "js",
        contents: `throw new Error(${JSON.stringify(`${devOnly} is dev-only and is not in the binary`)});`,
      };
    });
  },
};

const params = JSON.parse(process.argv[2]) as CompileParams;
const serverDir = dirname(params.input);

const result = await Bun.build({
  entrypoints: [params.input],
  target: "bun",
  minify: true,
  compile: {
    outfile: params.output,
    autoloadPackageJson: true,
    assets: [join(serverDir, "app"), join(serverDir, "next.config.json")],
  },
  external: [
    "webpack",
    "webpack/*",
    "next/dist/build/webpack/*",
    "sass",
    "critters",
    ...params.externals,
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.TURBOPACK": "1",
    "process.env.__NEXT_EXPERIMENTAL_REACT": JSON.stringify(""),
    "process.env.NEXT_RUNTIME": JSON.stringify("nodejs"),
  },
  plugins: [devOnlyStub],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
