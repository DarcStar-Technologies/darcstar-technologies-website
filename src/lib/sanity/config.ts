// Public Sanity connection facts for project 8v6ikhvv ("DarcStar GIDE" studio). These are NOT
// secrets — the projectId and dataset are visible in every asset URL the browser requests.
//
// CONFIGURABLE AT BUILD TIME via `VITE_SANITY_*` env vars (Vite statically inlines `import.meta.env.
// VITE_*` into BOTH the server and client bundles), falling back to the defaults below. Build-time,
// not a runtime `readEnv`/`platform.env` read, is deliberate and load-bearing: `@sanity/image-url`
// builds `<img>` URLs on the CLIENT during hydration, and an image URL embeds the dataset
// (cdn.sanity.io/images/<projectId>/<dataset>/…). The value MUST therefore be identical on server and
// client — a runtime server-only read would be invisible to the browser and desync the image URLs.
// Baking it at build guarantees one consistent value in both bundles. The server data client
// ($lib/server/sanity.ts) reads the SAME `dataset` here, so data and images never diverge.
//
// To point the site at another dataset, set `VITE_SANITY_DATASET` in that build's env (e.g. `dev`
// while developing, or in the preview Worker's build for a per-environment split); it takes effect on
// the next build. The read VIEWER TOKEN is the only Sanity SECRET — it's runtime/server-only
// (`readEnv('SANITY_VIEWER_TOKEN')` in $lib/server/sanity.ts), because this project gates document
// reads behind document-level access control (anonymous reads see only `siteSettings`).
// The fallbacks come from `./defaults.ts`, which deliberately contains no `import.meta` — a plain
// Node script (`pnpm check:cms`) cannot import THIS module, and it has to reach the same project and
// dataset the site serves. See that file.
import {
	DEFAULT_SANITY_API_VERSION,
	DEFAULT_SANITY_DATASET,
	DEFAULT_SANITY_PROJECT_ID
} from './defaults';

export const projectId = import.meta.env.VITE_SANITY_PROJECT_ID ?? DEFAULT_SANITY_PROJECT_ID;
export const dataset = import.meta.env.VITE_SANITY_DATASET ?? DEFAULT_SANITY_DATASET;
export const apiVersion = import.meta.env.VITE_SANITY_API_VERSION ?? DEFAULT_SANITY_API_VERSION;
