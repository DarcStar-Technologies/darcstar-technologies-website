// Provision the first admin operator (#69).
//
// Public sign-up is disabled in the running app (auth-options.ts, #48), so operator accounts can't
// be created through it. This one-off script builds a throwaway Better Auth instance — the SAME
// Turso DB and SAME drizzle schema as the app, but with sign-up ENABLED — and calls signUpEmail, so
// the `user` + `account` rows are written with Better Auth's own password hashing (exactly what the
// app's `signInEmail` later verifies). Importing the real schema (not a copy) keeps it from drifting.
//
// Since #94, prod and dev are SEPARATE Turso DBs (one per Worker). This reads DATABASE_* from
// `.env`, which points at the DEV DB — so by default it provisions the DEV/preview operator, NOT
// production. To provision PROD, pass the prod DB creds inline (DATABASE_URL=<prod-url>
// DATABASE_AUTH_TOKEN=<prod-token> … pnpm admin:create).
//
// Re-running is safe and IDEMPOTENT: if the account already exists it RESETS the password to
// ADMIN_PASSWORD and (re)asserts the admin role — so this doubles as a password reset for the owner.
// (A prior version only stamped the role and left the OLD password in place, which looked like a
// success but meant the password you just passed never took — the classic "created but can't log
// in".) Run (credentials passed inline, never committed):
//
//   ADMIN_EMAIL=you@darcstar.tech ADMIN_PASSWORD='a-strong-password' pnpm admin:create
//
// DATABASE_URL / DATABASE_AUTH_TOKEN (+ optional ORIGIN / BETTER_AUTH_SECRET) come from .env.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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

// signUpEmail writes the `user`/`account` rows but this throwaway instance has no admin plugin, so
// the row lands with a null role. Set `admin` directly (this script provisions the super-user owner,
// #95) so the DB role is truthful, not just the ADMIN_USER_IDS allowlist.
async function makeAdmin(id: string): Promise<void> {
	await db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, id));
}

// Set (or reset) the account's email/password credential to `plain`. Better Auth stores the
// password on the `account` row for the `credential` provider (accountId === userId), hashed with
// the SAME default scrypt the running app verifies with — so we hash via `better-auth/crypto` and
// write it directly. We can't go through `signUpEmail` here (the account already exists, so it just
// rejects and never touches the password) nor `setUserPassword` (an admin-plugin API this throwaway
// instance doesn't mount). UPDATE the credential row if present, else INSERT one (covers a user row
// that somehow has no credential account). This is what makes a re-run a genuine password reset.
async function setCredentialPassword(userId: string, plain: string): Promise<void> {
	const hash = await hashPassword(plain);
	const [existing] = await db
		.select({ id: schema.account.id })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')))
		.limit(1);
	if (existing) {
		await db
			.update(schema.account)
			.set({ password: hash, updatedAt: new Date() })
			.where(eq(schema.account.id, existing.id));
	} else {
		await db.insert(schema.account).values({
			id: randomUUID(),
			accountId: userId,
			providerId: 'credential',
			userId,
			password: hash
		});
	}
}

try {
	const res = await auth.api.signUpEmail({ body: { name, email, password } });
	await makeAdmin(res.user.id);
	console.log(`✓ Admin created: ${res.user.email} (id ${res.user.id}, role admin)`);
	printAdminIdHint(res.user.id);
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err);
	// An existing account isn't a failure — a re-run is how you rotate the owner's password (or
	// recover from a forgotten one) and (re)assert admin. Look up the id, RESET the password to
	// ADMIN_PASSWORD, ensure the admin role, print the id + hint, and exit 0.
	if (/exist/i.test(msg)) {
		const [row] = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(eq(schema.user.email, email))
			.limit(1);
		if (row) {
			await makeAdmin(row.id); // idempotent — ensure the existing owner carries the admin role
			await setCredentialPassword(row.id, password); // reset the password to ADMIN_PASSWORD
			console.log(
				`✓ Account already existed for ${email} — password reset (id ${row.id}, role admin).`
			);
			printAdminIdHint(row.id);
			process.exit(0);
		}
		die(`An account already exists for ${email}, but its id could not be read.`);
	}
	die(`Sign-up failed: ${msg}`);
}
