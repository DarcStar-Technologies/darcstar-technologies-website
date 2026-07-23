/// <reference types="vite/client" />

// Build-time Sanity config consumed by src/lib/sanity/config.ts. Vite statically replaces
// `import.meta.env.VITE_*` at build; each is optional so an unset var falls back to the in-code
// default (production / 8v6ikhvv / 2026-06-24). Set them per-build (local `.env` or the build env)
// to point the site at a different dataset/project — see docs/sanity.md.
interface ImportMetaEnv {
	readonly VITE_SANITY_PROJECT_ID?: string;
	readonly VITE_SANITY_DATASET?: string;
	readonly VITE_SANITY_API_VERSION?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
