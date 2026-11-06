// Bundle the simulated preview tests (css imports and all), then run them.
// jsdom stands in for the page. This is not Firefox or Zen.
import { spawnSync } from "node:child_process";
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["test/file-preview.test.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "dist-test/file-preview.test.js",
  loader: { ".css": "text" },
  packages: "external",
  sourcemap: "inline",
  logLevel: "warning",
});

const result = spawnSync(process.execPath, ["--test", "dist-test/file-preview.test.js"], { stdio: "inherit" });
process.exit(result.status ?? 1);
