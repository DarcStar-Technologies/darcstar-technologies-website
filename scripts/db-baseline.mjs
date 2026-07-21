// One-time baseline for an EXISTING Turso DB that was built with `db:push` (so it has the schema but
// NO drizzle migration history). It records the current `drizzle/` migrations as already-applied in
// the `__drizzle_migrations` bookkeeping table WITHOUT running their SQL, so the next `pnpm db:migrate`
// is forward-only (applies only NEWER migrations) instead of replaying `0000` against tables that
// already exist (which would fail — `0000` uses bare CREATE TABLE, not IF NOT EXISTS).
//
// Why this works: drizzle's libsql migrator (which `drizzle-kit migrate` delegates to) decides what
// to apply purely by `SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`
// and running each journal entry whose `when` (folderMillis) is GREATER than that. So recording the
// existing entries' `when` values makes the migrator skip them. The table DDL below mirrors drizzle's
// exactly, so a later `db:migrate`'s `CREATE TABLE IF NOT EXISTS` is a no-op.
//
// Run ONCE against the target DB, creds passed inline:
//   DATABASE_URL=<url> DATABASE_AUTH_TOKEN=<token> pnpm db:baseline
//
// Idempotent (re-runs only insert entries newer than what's already recorded). A FRESH DB (no schema
// yet) does NOT need this — `pnpm db:migrate` builds it from `0000` cleanly.

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) {
	console.error(
		'DATABASE_URL is not set — pass the target DB creds inline:\n  DATABASE_URL=… DATABASE_AUTH_TOKEN=… pnpm db:baseline'
	);
	process.exit(1);
}

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf8'));
const entries = [...(journal.entries ?? [])].sort((a, b) => a.when - b.when);
if (entries.length === 0) {
	console.log('No migrations in drizzle/ — nothing to baseline.');
	process.exit(0);
}

const client = createClient({ url, authToken });

// Mirror drizzle's own bookkeeping DDL exactly (id SERIAL PRIMARY KEY / hash / created_at).
await client.execute(
	'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
);

const last = await client.execute(
	'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1'
);
const lastApplied = last.rows.length ? Number(last.rows[0].created_at) : -1;

let inserted = 0;
for (const e of entries) {
	if (Number(e.when) <= lastApplied) continue; // already recorded
	const sql = readFileSync(join(drizzleDir, `${e.tag}.sql`), 'utf8');
	const hash = createHash('sha256').update(sql).digest('hex');
	await client.execute({
		sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
		args: [hash, e.when]
	});
	inserted++;
	console.log(`  baselined ${e.tag} (when=${e.when})`);
}

console.log(
	inserted === 0
		? 'Already baselined — nothing to do.'
		: `Baselined ${inserted} migration(s). \`pnpm db:migrate\` will now apply only newer ones.`
);
process.exit(0);
