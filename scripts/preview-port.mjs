// The preview server's port, derived per checkout, and the tooling that names whoever already holds
// it (DAR-79).
//
// The bug this closes: `playwright.config.ts` and the `preview` script each hardcoded 4173, and
// Playwright's `reuseExistingServer` defaults ON locally — so a preview running in a SIBLING
// worktree (this repo is worked through `.claude/worktrees/*`) got reused and the whole e2e suite
// reported a green result for someone else's branch. Silently.
//
// Three layers, and the ordering matters:
//
//   1. The port is DERIVED per checkout, so two worktrees don't contend in the first place. That is
//      the layer that matters most, and not for tidiness: the reflex on hitting a busy port is to go
//      kill whatever holds it, and that reflex is the OTHER half of DAR-79 (a blind `pkill -f
//      workerd` takes out a sibling Claude session's server; it happened, to a process that could
//      not afterwards be identified). No contention, no prompt to kill.
//   2. PREVIEW_PORT overrides it — 99 slots is not collision-proof, and this is the escape.
//   3. A collision that survives both is LOUD (`reuseExistingServer: false`), and reports the owner
//      by pid + cwd so nobody has to guess whose server it is.
//
// Imported by `scripts/preview.mjs`, `playwright.config.ts` and `scripts/smoke-signin.mjs`, which is
// the point — the port had been written down in three places.
//
// It also owns the /proc process-tree walks, both directions: UP to find the pid worth killing, DOWN
// to find what must die with it. They live beside the port rather than in the script because they are
// the only tested part of "stop the preview", and because the rule they share — never signal a
// process this checkout does not own — is one rule, not two.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vite's preview default, kept for the MAIN checkout so the docs' `localhost:4173` stays true. */
export const BASE_PORT = 4173;

/** Worktree slots: 4174–4272. Starts at +1, so a worktree can never take the main checkout's port. */
export const WORKTREE_SLOTS = 99;

// From this file's own location, never `cwd` — a script invoked from a subdirectory, or by
// Playwright through a shell, must derive the SAME port as one invoked from the repo root.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A linked worktree's `.git` is a regular FILE (a gitfile pointing at the common dir); the main
 * checkout's is a directory. Missing entirely (a tarball export, say) reads as the main checkout —
 * fail-safe toward the documented default rather than a surprise port.
 */
function isLinkedWorktree(root) {
	try {
		return statSync(join(root, '.git')).isFile();
	} catch {
		return false;
	}
}

/**
 * The slot a linked worktree at `root` gets — stable for the life of that directory, and never
 * BASE_PORT. Pure (no filesystem), because the rule worth pinning in a spec is this one.
 *
 * Derived from the PATH rather than the branch so the port survives a branch switch: a URL you noted
 * an hour ago still works. 99 slots is not collision-proof (four worktrees ≈ 6%), which is what
 * PREVIEW_PORT is for; a collision is loud, not silent.
 */
export function worktreePort(root) {
	const digest = createHash('sha256').update(resolve(root)).digest();
	return BASE_PORT + 1 + (digest.readUInt32BE(0) % WORKTREE_SLOTS);
}

/**
 * The port this checkout previews on: PREVIEW_PORT if set, else BASE_PORT for the main checkout, else
 * this worktree's slot.
 *
 * `env` is typed loosely on purpose. Inferring it from the `process.env` default would drag in this
 * app's augmented `ProcessEnv` — the one that requires DATABASE_URL and friends — and the only
 * variable that exists as far as this function is concerned is PREVIEW_PORT.
 *
 * @param {{ env?: Record<string, string | undefined>; root?: string }} [options]
 */
export function previewPort({ env = process.env, root = REPO_ROOT } = {}) {
	const override = env.PREVIEW_PORT?.trim();
	if (override) {
		const port = Number(override);
		// Rejected rather than silently ignored: a typo'd override that fell back to the derived port
		// would send `pnpm preview` and Playwright to different ports, and the symptom (a 180s webServer
		// timeout) points nowhere near the cause.
		if (!Number.isInteger(port) || port < 1024 || port > 65535) {
			throw new Error(`PREVIEW_PORT must be an integer between 1024 and 65535 — got "${override}"`);
		}
		return port;
	}

	// resolve() first: '/a/b' and '/a/b/' are the same checkout and must not hash differently.
	const normalized = resolve(root);
	return isLinkedWorktree(normalized) ? worktreePort(normalized) : BASE_PORT;
}

/** `http://localhost:<port>` — the base URL of this checkout's preview. */
export function previewUrl(options) {
	return `http://localhost:${previewPort(options)}`;
}

function procField(pid, file, read) {
	try {
		return read(`/proc/${pid}/${file}`);
	} catch {
		// Not Linux, the process exited mid-read, or it belongs to another user. All three mean "can't
		// tell", never "crash the preview" — this module only ever improves an error message.
		return null;
	}
}

const procCwd = (pid) => procField(pid, 'cwd', readlinkSync);
const procCmd = (pid) =>
	procField(pid, 'cmdline', (p) => readFileSync(p, 'utf8').split('\0').filter(Boolean).join(' '));

/**
 * A process's parent, or null if /proc can't tell us. The single copy of this parse: it is used
 * walking UP (find the tree root worth killing) and walking DOWN (find what must die with it), and
 * two copies of a subtlety like the one below is how they drift.
 */
function procPpid(pid) {
	const stat = procField(pid, 'stat', (p) => readFileSync(p, 'utf8'));
	if (!stat) return null;
	// Field 2 (comm) is parenthesized and may itself contain spaces or ')', so parse from the LAST
	// ')': what follows is "<state> <ppid> …".
	const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
	// Raw, including 1 — deciding that init is not worth walking to belongs to the caller that walks.
	return Number.isInteger(ppid) ? ppid : null;
}

/**
 * Every live descendant of `pid`, parents before children, read fresh from /proc.
 *
 * `wrangler dev` runs `workerd` as a GRANDCHILD, so this is what makes "stop the preview" mean the
 * whole tree: killing the direct child alone is precisely how a `workerd` ends up reparented to init
 * with the port still bound. Read at the moment of use rather than snapshotted, because a stale pid
 * list is a pid-reuse bug waiting to SIGKILL a stranger. Returns [] where there is no /proc.
 */
export function descendants(pid) {
	let entries;
	try {
		entries = readdirSync('/proc');
	} catch {
		return [];
	}

	const children = new Map();
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		// A process that exited between readdir and read is, by definition, not still holding a port.
		const parent = procPpid(Number(entry));
		if (parent === null) continue;
		children.set(parent, [...(children.get(parent) ?? []), Number(entry)]);
	}

	const found = [];
	const queue = [pid];
	while (queue.length) {
		for (const child of children.get(queue.shift()) ?? []) {
			found.push(child);
			queue.push(child);
		}
	}
	return found;
}

/** The processes a preview tree is made of: wrangler's two node layers, workerd, and our wrapper. */
const PREVIEW_TREE_COMMAND = /wrangler|workerd|preview\.mjs/;

/**
 * Walk UP from the socket owner to the top of the preview's own process tree — the pid worth
 * SIGTERMing, since one SIGTERM anywhere in the tree reaps `workerd` with it.
 *
 * An ancestor has to satisfy BOTH tests to be walked through, and each one covers the other's blind
 * spot:
 *
 *   - argv[0] must BE node or workerd, because a shell that merely MENTIONS wrangler in its `-c`
 *     argument would otherwise match — and in this environment commands run from
 *     `bash -c '… pnpm preview …'` whose own parent is the Claude session. argv[0] stops there.
 *   - the command line must look like part of a preview, because "any node ancestor" climbs straight
 *     out of the tree and into whatever node process SUPERVISES it. Under vitest that is the test
 *     runner; under a script that spawns previews it is the script. Naming those as the thing to kill
 *     would be bad advice, and `reapStrayPortHolder` acts on this answer without asking.
 *
 * Stopping too early is harmless — a deeper pid still reaps its own descendants. Stopping too late
 * hands out someone else's pid, so the conditions are deliberately conjunctive.
 */
function previewTreeRoot(pid) {
	let current = pid;
	// Bounded: /proc is racy, and a cycle here would hang the error path.
	for (let depth = 0; depth < 16; depth += 1) {
		const parent = procPpid(current);
		// init is where an orphaned tree's root reparents to; it is never itself part of one.
		if (parent === null || parent <= 1) break;
		const command = procCmd(parent);
		const argv0 = command?.split(' ')[0];
		if (!argv0 || !/^(node|workerd)$/.test(basename(argv0))) break;
		if (!PREVIEW_TREE_COMMAND.test(command)) break;
		current = parent;
	}
	return current;
}

/**
 * Who is listening on `port`, or `null` when it's free — or when we can't tell (no `ss`, no /proc).
 * "Can't tell" is deliberately the same as "free": wrangler exits 1 on a bound port and Playwright
 * runs its own check, so the worst case is the plain error instead of the annotated one.
 */
export function portListenerReport(port, { root = REPO_ROOT } = {}) {
	let line;
	try {
		// `-H` drops the header and the filter is an exact port match, so any output at all means
		// "bound" — on ANY address, which is marginally stricter than wrangler needs (it binds
		// localhost). A timeout because this is a synchronous call on the path of every `pnpm preview`
		// and every `playwright test`; a hung `ss` must not become a hung suite.
		line = execFileSync('ss', ['-ltnpH', `( sport = :${port} )`], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 2_000
		}).trim();
	} catch {
		return null;
	}
	if (!line) return null;

	const pid = Number(line.match(/pid=(\d+)/)?.[1]);
	if (!Number.isInteger(pid)) return { port, pid: null, cwd: null, killPid: null, mine: false };

	// `mine` needs a POSITIVE match on the working directory, so an owner we can't read (another
	// user's process, one that exited mid-read) reads as someone else's and the message says leave it
	// alone. The whole point is to stop an unaimed kill, so "unsure" has to mean "don't".
	const cwd = procCwd(pid);
	return { port, pid, cwd, killPid: previewTreeRoot(pid), mine: cwd === resolve(root) };
}

/**
 * SIGTERM whatever is still holding `port`, but ONLY if it came from this checkout — for the case
 * where wrangler died without taking `workerd` with it (a crash, or something killing it outright
 * rather than asking). The grandchild then reparents to init with the port still bound, which is
 * exactly the orphan DAR-79 found piling up for days, and `descendants()` cannot find it: the moment
 * the child is gone, what it left behind is no longer descended from it.
 *
 * The `mine` gate is the same positive working-directory match the busy report uses, so this can
 * never signal another checkout's server — the one thing it must never do, since unlike the report
 * it acts without asking.
 *
 * @returns the pid signalled, or null when there was nothing of ours to reap.
 */
export function reapStrayPortHolder(port, { root = REPO_ROOT } = {}) {
	const stray = portListenerReport(port, { root });
	if (!stray?.mine || !stray.killPid) return null;
	try {
		process.kill(stray.killPid, 'SIGTERM');
	} catch {
		// Gone between the two syscalls; nothing to reap.
		return null;
	}
	return stray.killPid;
}

/**
 * The busy-port error, in the words the DAR-79 comment had to reconstruct by hand under time
 * pressure. Deliberately never prints a `pkill` line: the whole point is that the owner is named, so
 * the kill is aimed rather than swept.
 */
export function portBusyMessage(report) {
	const lines = [
		`Port ${report.port} is already in use — this checkout's preview cannot start.`,
		''
	];

	if (!report.pid) {
		lines.push('  Held by an unidentified process (no pid from `ss` — another user?).');
	} else if (report.mine) {
		lines.push(`  Held by pid ${report.pid}, started from THIS checkout — a preview of yours,`);
		lines.push(
			'  most likely one orphaned by a hard kill (SIGKILL leaves workerd holding the port).'
		);
		lines.push(`  Stop it:  kill ${report.killPid}`);
	} else {
		lines.push(`  Held by pid ${report.pid}, started from ${report.cwd ?? 'an unknown directory'}`);
		lines.push('  — ANOTHER checkout. Do not kill it; it belongs to a different session.');
	}

	lines.push('', `  Or pick a different port:  PREVIEW_PORT=${report.port + 1} pnpm preview`);
	return lines.join('\n');
}
