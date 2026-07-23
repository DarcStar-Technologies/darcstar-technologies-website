import { defineCliConfig } from 'sanity/cli';

// TypeGen-only config (this repo is the FRONTEND — the Studio lives at ../darcstar-sanity-studio).
// `pnpm sanity:types` runs `sanity typegen generate`, which reads:
//   • schema  — src/lib/sanity/schema.json, extracted in the Studio (`pnpm typegen` there) and copied
//               in. Re-copy it whenever the Studio schema changes, then regenerate. See docs/sanity.md.
//   • path    — scans these files for `defineQuery(...)` calls (all live in src/lib/sanity/queries.ts).
//   • generates — src/lib/sanity/types.ts (committed; git-ignored from lint/format churn).
// `overloadClientMethods` augments @sanity/client so `sanityClient.fetch(q)` returns the query's
// generated `…Result` type. No `sanity.config.ts` is needed — that's Studio-only.
export default defineCliConfig({
	typegen: {
		path: './src/**/*.{ts,tsx}',
		schema: './src/lib/sanity/schema.json',
		generates: './src/lib/sanity/types.ts',
		overloadClientMethods: true
	}
});
