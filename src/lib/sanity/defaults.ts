// The Sanity connection defaults, in a module with no `import.meta` in it.
//
// `config.ts` is the place these are READ from, and it reads them through `import.meta.env` so Vite
// can inline a per-build override. That is exactly what makes it unimportable from a plain Node
// script: under `tsx` there is no `import.meta.env`, so evaluating that module throws. `pnpm check:cms`
// is such a script, and it must connect to the same project and dataset the site serves or it scans
// somewhere else and reports clean — a blind scan that looks like a pass (DAR-152's shape).
//
// So the literals live here, imported by both, rather than being copied into the script and pinned by
// a spec. One value, no drift to detect.
//
// None of these are secrets: the projectId and dataset appear in every asset URL the browser
// requests. The read token is the only Sanity secret, and it is resolved per-caller.

export const DEFAULT_SANITY_PROJECT_ID = '8v6ikhvv';
export const DEFAULT_SANITY_DATASET = 'production';

/** Pinned API date — bump deliberately, never float. https://www.sanity.io/docs/api-versioning */
export const DEFAULT_SANITY_API_VERSION = '2026-06-24';
