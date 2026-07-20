// Provision the first admin operator (#69).
//
// Public sign-up is disabled in the running app (auth-options.ts, #48), so operator accounts can't
// be created through it. This one-off script builds a throwaway Better Auth instance — the SAME
// Turso DB and SAME drizzle schema as the app, but with sign-up ENABLED — and calls signUpEmail, so
// the `user` + `account` rows are written with Better Auth's own password hashing (exactly what the
// app's `signInEmail` later verifies). Importing the real schema (not a copy) keeps it from drifting.
//
// The deployed Worker and local dev share ONE Turso DB, so pointing this at the prod .env
// provisions the production operator. Run (credentials passed inline, never committed):
//
//   ADMIN_EMAIL=you@darcstar.tech ADMIN_PASSWORD='a-strong-password' pnpm admin:create
//
// DATABASE_URL / DATABASE_AUTH_TOKEN (+ optional ORIGIN / BETTER_AUTH_SECRET) come from .env.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';

// Load DB credentials from .env; inline ADMIN_* / ambient env still win (loadEnvFile only fills
// keys .env defines). Absent .env (e.g. a CI shell that injects env directly) is fine.
try {
	process.loadEnvFile('.env');
} catch {
	// no .env — rely on the ambient environment
}

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

const email = process.env.ADMIN_EMAIL?.trim();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Admin';
const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url) die('DATABASE_URL is not set (check .env).');
if (!email) die('ADMIN_EMAIL is required — e.g. ADMIN_EMAIL=you@darcstar.tech pnpm admin:create');
if (!password || password.length < 8) {
	die('ADMIN_PASSWORD is required and must be at least 8 characters.');
}

const db = drizzle(createClient({ url, authToken }), { schema });

const auth = betterAuth({
	// A secret is only needed to sign session tokens/cookies — this script writes none — so a
	// placeholder is fine when BETTER_AUTH_SECRET isn't set. Password hashing (scrypt) is unrelated.
	baseURL: process.env.ORIGIN || 'http://localhost',
	secret: process.env.BETTER_AUTH_SECRET || 'provisioning-script-secret-not-used-for-sessions',
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	// Sign-up ENABLED here ONLY — the live app keeps it disabled (auth-options.ts, #48).
	emailAndPassword: { enabled: true }
});

function printAdminIdHint(id: string): void {
	// The owner allowlist (ADMIN_USER_IDS) lets an account manage the operator roster regardless of
	// its DB role, so it can't be locked out. Print a copy-paste line for .env / the prod secret.
	console.log(`  To make this account an always-admin owner, allowlist its id:`);
	console.log(`    .env     → ADMIN_USER_IDS="${id}"`);
	console.log(`    prod     → wrangler secret put ADMIN_USER_IDS   (value: ${id})`);
}

try {
	const res = await auth.api.signUpEmail({ body: { name, email, password } });
	console.log(`✓ Admin created: ${res.user.email} (id ${res.user.id})`);
	printAdminIdHint(res.user.id);
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err);
	// An existing account isn't a failure here — the operator usually runs this to DISCOVER the id
	// to allowlist. Look it up, print it with the hint, and exit 0.
	if (/exist/i.test(msg)) {
		const [row] = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(eq(schema.user.email, email))
			.limit(1);
		if (row) {
			console.log(`✓ An account already exists for ${email} (id ${row.id}).`);
			printAdminIdHint(row.id);
			process.exit(0);
		}
		die(`An account already exists for ${email}, but its id could not be read.`);
	}
	die(`Sign-up failed: ${msg}`);
}
