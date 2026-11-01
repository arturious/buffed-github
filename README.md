# Buffed GitHub

Buffs for GitHub: small improvements to its interface, as a Firefox / Zen
extension.

## Features

| Feature | What it does |
|---|---|
| Inline folders | Click a folder in a repo's file table to expand it in place, with a chevron, last commit and date for each item. |

Each feature can be switched off in the extension's settings.

## Layout

```
static/              copied to dist/ as is: manifest.json, options.html, icons
src/content.ts       content script: runs the enabled features on github.com
src/feature.ts       the Feature type and the on/off settings
src/features/        one file per feature, listed in features/index.ts
src/options/         options page script
build.js             esbuild: src/ -> dist/ (not minified)
```

## Adding a feature

1. Create `src/features/<id>.ts` exporting a `Feature` (`id`, `name`, `description`, `run()`).
2. Add it to the list in `src/features/index.ts`.

## Build

Needs Node 20+.

```sh
npm ci              # install exact dependency versions
npm run build       # dist/ with the extension
npm run watch       # rebuild on every change
npm run typecheck   # TypeScript check
npm run lint        # build + web-ext lint
npm start           # run in a temporary Zen profile
npm run sign -- --api-key=... --api-secret=...   # signed .xpi (unlisted)
npm run source-zip  # source archive for addons.mozilla.org review
```

API keys: addons.mozilla.org → Developer Hub → Tools → Manage API Keys.
