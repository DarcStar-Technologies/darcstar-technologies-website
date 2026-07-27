import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	BASE_PORT,
	REPO_ROOT,
	WORKTREE_SLOTS,
	descendants,
	portBusyMessage,
	portListenerReport,
	previewPort,
	previewUrl,
	reapStrayPortHolder,
	worktreePort
} from './preview-port.mjs';
import { previewVarArgs, previewVars } from './preview-vars.mjs';

// DAR-79. The preview port used to be the literal 4173 in `playwright.config.ts`, in the `preview`
// script and in `smoke-signin.mjs`; with every checkout on the same port, Playwright's
// `reuseExistingServer` default silently ran the e2e suite against a SIBLING worktree's server.
//
// What has to hold now, and none of it is visible from a passing e2e run:
//   - the main checkout keeps 4173, or every `curl localhost:4173` in the docs quietly stops
//     describing reality;
//   - a worktree's port is STABLE (it is a URL people note down) and never 4173;
//   - a bad PREVIEW_PORT fails loudly, because falling back would put `pnpm preview` and Playwright
//     on different ports and the only symptom is a 180s webServer timeout pointing nowhere.

const fixtures = mkdtempSync(join(tmpdir(), 'dar79-preview-port-'));

/** A checkout at `name`, marked the way git marks one: `.git` file = linked worktree, dir = main. */
function checkout(name: string, kind: 'main' | 'worktree' | 'none') {
	const root = join(fixtures, name);
	mkdirSync(root);
	if (kind === 'worktree')
		writeFileSync(join(root, '.git'), `gitdir: ${fixtures}/.git/worktrees/x\n`);
	if (kind === 'main') mkdirSync(join(root, '.git'));
	return root;
}

afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

describe('worktreePort', () => {
	// Fixed strings, not the temp fixtures: mkdtemp names are random, so a "two roots differ"
	// assertion over real directories would be a 1-in-99 flake. The rule is about the hash, and the
	// hash needs no filesystem.
	it('is stable for a path and unaffected by a trailing slash', () => {
		expect(worktreePort('/repo/.claude/worktrees/alpha')).toBe(
			worktreePort('/repo/.claude/worktrees/alpha')
		);
		expect(worktreePort('/repo/.claude/worktrees/alpha/')).toBe(
			worktreePort('/repo/.claude/worktrees/alpha')
		);
	});

	it('separates different worktrees', () => {
		expect(worktreePort('/repo/.claude/worktrees/alpha')).not.toBe(
			worktreePort('/repo/.claude/worktrees/beta')
		);
	});

	it('never lands on the main checkout, and stays inside its slot range', () => {
		const ports = Array.from({ length: 500 }, (_, i) =>
			worktreePort(`/repo/.claude/worktrees/w${i}`)
		);
		expect(ports.every((port) => Number.isInteger(port))).toBe(true);
		expect(Math.min(...ports)).toBeGreaterThan(BASE_PORT);
		expect(Math.max(...ports)).toBeLessThanOrEqual(BASE_PORT + WORKTREE_SLOTS);
	});
});

describe('previewPort', () => {
	const env = {};

	it('keeps the main checkout on the documented port', () => {
		expect(previewPort({ env, root: checkout('main', 'main') })).toBe(BASE_PORT);
	});

	it('gives a linked worktree its own slot', () => {
		const root = checkout('worktree', 'worktree');
		expect(previewPort({ env, root })).toBe(worktreePort(root));
		expect(previewPort({ env, root })).not.toBe(BASE_PORT);
	});

	// A checkout with no `.git` at all (a tarball export, a copied tree) reads as the main one:
	// fail-safe toward the documented default rather than a port nobody expected.
	it('treats a checkout with no .git as the main one', () => {
		expect(previewPort({ env, root: checkout('bare', 'none') })).toBe(BASE_PORT);
	});

	it('honours PREVIEW_PORT over the derivation', () => {
		const root = checkout('overridden', 'worktree');
		expect(previewPort({ env: { PREVIEW_PORT: '4200' }, root })).toBe(4200);
		expect(previewPort({ env: { PREVIEW_PORT: ' 4200 ' }, root })).toBe(4200);
	});

	it('ignores an empty PREVIEW_PORT rather than reading it as a port', () => {
		const root = checkout('empty-override', 'worktree');
		expect(previewPort({ env: { PREVIEW_PORT: '  ' }, root })).toBe(worktreePort(root));
	});

	it.each(['abc', '0', '80', '70000', '4187.5', '-1'])(
		'refuses PREVIEW_PORT=%s instead of silently deriving',
		(value) => {
			expect(() => previewPort({ env: { PREVIEW_PORT: value }, root: fixtures })).toThrow(
				/PREVIEW_PORT/
			);
		}
	);

	it('builds the preview URL from the same number', () => {
		const root = checkout('url', 'worktree');
		expect(previewUrl({ env, root })).toBe(`http://localhost:${previewPort({ env, root })}`);
	});
});

// The message is the half of DAR-79 that exists to stop an UNAIMED kill: the reflex on a busy port is
// `pkill -f workerd`, which takes out whatever a sibling session is running. So the rule is not
// "explain the collision" but "never hand someone a kill command for a process that isn't theirs" —
// and that polarity has to hold for the can't-tell case too, which is why `mine` is a positive match
// on the working directory rather than the absence of a mismatch.
describe('portBusyMessage', () => {
	const base = { port: 4227, pid: 4242, cwd: REPO_ROOT, killPid: 4200 };

	it('offers a kill only for a server started from this very checkout', () => {
		const message = portBusyMessage({ ...base, mine: true });
		expect(message).toContain('kill 4200');
		expect(message).toContain('THIS checkout');
	});

	it('refuses to suggest a kill for another checkout, and says whose it is', () => {
		const message = portBusyMessage({ ...base, cwd: '/elsewhere/worktrees/other', mine: false });
		expect(message).toContain('/elsewhere/worktrees/other');
		expect(message).toContain('Do not kill it');
		expect(message).not.toMatch(/\bkill \d+/);
	});

	it('refuses to suggest a kill for an owner it could not identify', () => {
		const message = portBusyMessage({
			port: 4227,
			pid: null,
			cwd: null,
			killPid: null,
			mine: false
		});
		expect(message).not.toMatch(/\bkill \d+/);
	});

	it.each([
		['mine', { ...base, mine: true }],
		['foreign', { ...base, mine: false }]
	])('never suggests a swept kill (%s)', (_case, report) => {
		expect(portBusyMessage(report)).not.toContain('pkill');
	});
});

// `ss` is how the owner is found at all. Without it the module degrades to null by design (the
// collision then surfaces as wrangler's own "Address already in use"), so these skip rather than
// assert a weaker thing — but on every machine that has it, including CI, they exercise the real
// invocation and the real parse.
const hasSs = (() => {
	try {
		execFileSync('ss', ['-V'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

// Every test below spawns real processes and waits on real signals, so each one gets a timeout well
// clear of its own polling budget. Vitest's default is 5s, which the fixtures can genuinely exceed on
// a loaded machine — a node process taking seconds to start is slow, not broken, and a red suite that
// means "the box was busy" is worse than useless. The assertions are unchanged; only the patience is.
const PROCESS_TEST_TIMEOUT = 20_000;

/** A separate process holding a port, started from `cwd` — a stand-in for a preview server. */
async function spawnPortHolder(cwd: string) {
	const child = spawn(
		process.execPath,
		[
			'-e',
			`require('net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port); })`
		],
		{ cwd, stdio: ['ignore', 'pipe', 'ignore'] }
	);
	const port: number = await new Promise((resolve) =>
		child.stdout!.once('data', (chunk) => resolve(Number(String(chunk).trim())))
	);
	return { child, port };
}

/** Resolves once `pid` is gone, or after ~2s. */
async function waitForExit(pid: number) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (!existsSync(`/proc/${pid}`)) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !existsSync(`/proc/${pid}`);
}

describe.skipIf(!hasSs)('portListenerReport', () => {
	it(
		'finds the process actually holding the port, and calls it ours',
		async () => {
			const server = createServer();
			await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;

			try {
				const report = portListenerReport(port, { root: process.cwd() });
				expect(report?.pid).toBe(process.pid);
				// vitest runs from the repo root, so this process IS "this checkout" — the same comparison
				// that decides whether the message dares offer a kill.
				expect(report?.mine).toBe(true);
			} finally {
				await new Promise((resolve) => server.close(() => resolve(undefined)));
			}
		},
		PROCESS_TEST_TIMEOUT
	);

	// The walk UP must stop at the edge of the preview's own tree. It climbs node ancestors, and this
	// test process is one: vitest's worker spawned the listener, pnpm spawned vitest. An unbounded
	// walk names one of THOSE as the thing to kill — and `reapStrayPortHolder` acts on that answer
	// without asking, so the boundary is a safety property, not a nicety.
	it(
		'does not climb out of the tree into whatever supervises it',
		async () => {
			const holder = await spawnPortHolder(process.cwd());
			try {
				const report = portListenerReport(holder.port, { root: process.cwd() });
				expect(report?.killPid).toBe(holder.child.pid);
			} finally {
				holder.child.kill('SIGKILL');
			}
		},
		PROCESS_TEST_TIMEOUT
	);

	it(
		'reports nothing for a port no one is listening on',
		async () => {
			// Bind then release: the kernel just told us this port is unused, which is as close to a
			// guaranteed-free port as a test can get.
			const server = createServer();
			await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			await new Promise((resolve) => server.close(() => resolve(undefined)));

			expect(portListenerReport(port)).toBeNull();
		},
		PROCESS_TEST_TIMEOUT
	);
});

// The one thing here that acts rather than reports: it sends a signal, unprompted, when a preview's
// wrangler dies without taking `workerd` with it. So the two cases below are the whole contract —
// reap what is ours, and never touch what isn't. The second is the one that matters: a false positive
// is the `pkill` mistake DAR-79 exists to prevent, executed automatically.
describe.skipIf(!hasSs)('reapStrayPortHolder', () => {
	it(
		'terminates a stray started from this checkout',
		async () => {
			const holder = await spawnPortHolder(process.cwd());
			try {
				expect(reapStrayPortHolder(holder.port, { root: process.cwd() })).toBe(holder.child.pid);
				expect(await waitForExit(holder.child.pid!)).toBe(true);
			} finally {
				holder.child.kill('SIGKILL');
			}
		},
		PROCESS_TEST_TIMEOUT
	);

	it(
		'leaves a holder from another directory strictly alone',
		async () => {
			const holder = await spawnPortHolder(tmpdir());
			try {
				expect(reapStrayPortHolder(holder.port, { root: process.cwd() })).toBeNull();
				// Still there — nothing was signalled, not "signalled but survived".
				await new Promise((resolve) => setTimeout(resolve, 150));
				expect(existsSync(`/proc/${holder.child.pid}`)).toBe(true);
			} finally {
				holder.child.kill('SIGKILL');
			}
		},
		PROCESS_TEST_TIMEOUT
	);
});

// The walk DOWN, and the only reason it exists: `wrangler dev` runs `workerd` as a grandchild, so a
// shutdown that reached one level deep would leave the port bound by a process reparented to init —
// the orphans DAR-79 found piled up for days. Recursion is therefore the property under test, not an
// implementation detail, which is why the fixture nests two levels.
describe.skipIf(!existsSync('/proc/self'))('descendants', () => {
	it(
		'reaches grandchildren, not just children',
		async () => {
			// Outer sh → inner sh → sleep. `& wait` stops a shell from `exec`ing its only command away,
			// which would collapse the depth this test is about.
			const tree = spawn('sh', ['-c', 'sh -c "sleep 30; true" & wait'], { stdio: 'ignore' });
			try {
				// Generous: two `sh` forks are instant on a laptop, but a loaded CI runner deserves slack —
				// a flaky red here would be indistinguishable from a real regression.
				let found: number[] = [];
				for (let attempt = 0; attempt < 80 && found.length < 2; attempt += 1) {
					await new Promise((resolve) => setTimeout(resolve, 50));
					found = descendants(tree.pid);
				}

				// The outer sh has exactly ONE child, so a second entry can only come from recursing.
				expect(found.length).toBeGreaterThanOrEqual(2);
				const commands = found.map((pid) =>
					readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ')
				);
				expect(commands.some((command) => command.includes('sleep'))).toBe(true);
				// Parents before children: the caller kills in reverse, so that a parent is never signalled
				// before the child it would otherwise orphan.
				expect(descendants(found.at(-1)!)).toEqual([]);
			} finally {
				for (const pid of [...descendants(tree.pid).reverse(), tree.pid]) {
					try {
						process.kill(pid, 'SIGKILL');
					} catch {
						// Already gone.
					}
				}
			}
		},
		PROCESS_TEST_TIMEOUT
	);
});

// The CI e2e job used to write `ORIGIN=http://localhost:4173` into a `.env` by hand, and this spec
// pinned that literal to BASE_PORT because it could not be single-sourced — one half was YAML.
// DAR-81 deleted the line instead: the preview derives ORIGIN from the port it is binding, so there
// is no second copy left to drift, and the property that used to need pinning is now unstateable.
//
// What replaced it is below. Better Auth mounts /api/auth ONLY for requests whose origin matches its
// baseURL, so an ORIGIN that doesn't match the served port doesn't produce a wrong answer — it
// produces no auth API at all, and a suite full of 404s that most assertions read as a refusal.
describe('the vars the preview bakes', () => {
	it('points ORIGIN at the port being served, whatever that port is', () => {
		// Both ends of the range plus the main checkout: the derivation is the guarantee, not one value.
		for (const port of [BASE_PORT, BASE_PORT + 1, BASE_PORT + WORKTREE_SLOTS]) {
			expect(previewVars(port).ORIGIN).toBe(`http://localhost:${port}`);
		}
	});

	it('runs the rate limiter in memory, so auth routes are reachable without a database', () => {
		// The limiter runs before every /api/auth route and its `database` store makes a DB round-trip
		// the precondition for reaching any auth logic. The e2e suite has no database.
		expect(previewVars(BASE_PORT).AUTH_RATE_LIMIT_STORAGE).toBe('memory');
	});

	it('emits `--var NAME:VALUE` pairs wrangler can parse', () => {
		const args = previewVarArgs(BASE_PORT);
		// Colon-separated, and ORIGIN's value is itself full of colons — wrangler splits on the first
		// one. Asserted because the alternative (a quoted value, or a split-on-every-colon parse)
		// fails by silently setting the var to `http`, which reads as a mismatched origin.
		expect(args).toContain(`ORIGIN:http://localhost:${BASE_PORT}`);
		expect(args.filter((arg) => arg === '--var')).toHaveLength(args.length / 2);
	});
});
