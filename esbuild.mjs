// Builds the extension (Node, for VS Code's local extension host) and the
// webview (browser). --production minifies and leaves out source maps;
// --tests bundles test/*.test.ts into out/test for `node --test`; --harness
// bundles the dev pages' scripts (dev/*.tsx) into dev/out, to look at the
// webview with demo data in a browser.
import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");
const harness = process.argv.includes("--harness");

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : "linked",
  logLevel: "info",
  legalComments: "none",
};

const builds = harness
  ? [{
      ...common,
      entryPoints: readdirSync("dev").filter((f) => f.endsWith(".tsx")).map((f) => `dev/${f}`),
      outdir: "dev/out",
      platform: "browser",
      format: "iife",
      target: "chrome114",
      jsx: "automatic",
      jsxImportSource: "preact",
    }]
  : tests
  ? [{
      ...common,
      sourcemap: false,
      entryPoints: readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`),
      outdir: "out/test",
      platform: "node",
      format: "cjs",
      target: "node18",
      alias: { vscode: "./test/vscode-stub.ts" },
    }]
  : [
      {
        ...common,
        entryPoints: ["src/extension.ts"],
        outfile: "dist/extension.js",
        platform: "node",
        format: "cjs",
        target: "node18",
        external: ["vscode"],
      },
      {
        ...common,
        entryPoints: { webview: "webview/main.tsx", "webview-style": "webview/styles.css" },
        outdir: "dist",
        platform: "browser",
        format: "iife",
        target: "chrome114",
        jsx: "automatic",
        jsxImportSource: "preact",
      },
    ];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
