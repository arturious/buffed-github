// Builds the extension into dist/: TypeScript bundled by esbuild (not
// minified, so the shipped code stays readable for addons.mozilla.org
// review) plus everything in static/ copied as is.
//   node build.js           one build
//   node build.js --watch   rebuild on every change
import { cpSync, rmSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
cpSync("static", "dist", { recursive: true });

const options = {
  entryPoints: {
    content: "src/content.ts",
    options: "src/options/options.ts",
    background: "src/background.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "firefox142",
  minify: false,
  // feature styles: `import css from "./x.css"` gives the file as a string
  loader: { ".css": "text" },
  logLevel: "info",
};

if (watch) {
  // static/ changes (manifest, icons, options.html) still need a restart
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
