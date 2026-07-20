// Config used ONLY by the Better Auth CLI (`pnpm run auth:schema`).
//
// The CLI loads the config with jiti (plain Node), which cannot resolve
// SvelteKit's virtual modules ($app/env/private, $app/server) that the real
// `auth.ts` depends on. This standalone config mirrors the *schema-affecting*
// options so `better-auth generate` can emit `db/auth.schema.ts` without them.
// No live DB connection is made during generation.
//
// Keep in sync with `auth.ts`: adapter provider, auth methods, and any
// table-adding plugins (`sveltekitCookies` adds none, so it's omitted here).
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { emailAndPassword, rateLimit } from './auth-options';

const db = drizzle(createClient({ url: 'http://localhost:8080' }));

export const auth = betterAuth({
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	// Shared with the live config (auth-options.ts) so the auth method can't drift from
	// auth.ts. `disableSignUp` is behavioral and doesn't affect the generated schema.
	emailAndPassword,
	// #69: schema-affecting (`storage: 'database'` adds the `rateLimit` table) — must be here so
	// `pnpm auth:schema` emits the table into db/auth.schema.ts. Shared with auth.ts, can't drift.
	rateLimit,
	socialProviders: {
		github: { clientId: '', clientSecret: '' }
	}
});
