// `pnpm preview` — the built Cloudflare worker on the real Workers runtime (wrangler dev), on this
// checkout's own port (DAR-79).
//
// Two jobs beyond running wrangler, both of them from DAR-79's field notes:
//
//   1. Report the port collision it can't avoid, WITH the owner's pid and working directory. The
//      hazard this fixes is the reflex `pkill -f workerd`, which kills a sibling worktree session's
//      server; naming the owner is what turns "kill something" into "kill this, or don't".
//   2. Reap on the way out. `wrangler dev` runs `workerd` as a GRANDCHILD, and an unreaped one holds
//      the port under `ppid 1` forever — that is where the orphans came from (ten trees, up to 2d16h
//      old, in one sweep). Three mechanisms, because they fail in different places: forward SIGTERM
//      (enough on its own in every normal case), SIGKILL the descendants if the child is wedged and
//      ignores it, and — once the child is gone and its leftovers are no longer *its* descendants to
//      find — ask the port whether something of ours outlived it.
//
// The child deliberately runs in OUR process group (no `detached`), so Playwright's group-kill at
// webServer teardown and a terminal Ctrl-C both reach `workerd` directly, without this script having
// to be alive to relay anything.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
	descendants,
	portBusyMessage,
	portListenerReport,
	previewPort,
	reapStrayPortHolder,
	REPO_ROOT
} from './preview-port.mjs';
import { previewVarArgs } from './preview-vars.mjs';

/** How long a SIGTERM'd tree gets to exit before survivors are SIGKILLed. */
const GRACE_MS = 5_000;

// A rejected PREVIEW_PORT is a typo, not a crash: print the reason the way this script prints its
// other refusals, without a stack trace pointing into node internals.
let port;
try {
	port = previewPort();
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}

// Extra arguments go through to wrangler, but not this one: `--port` here would bind a port
// Playwright is not watching, and the only symptom would be its 180s webServer timeout. The port has
// one source, and this is the boundary where someone would try to give it a second.
const forwarded = process.argv.slice(2);
if (forwarded.some((argument) => argument === '--port' || argument.startsWith('--port='))) {
	console.error('✗ use PREVIEW_PORT=… rather than --port, so Playwright and this script agree');
	process.exit(1);
}

const busy = portListenerReport(port);
if (busy) {
	console.error(portBusyMessage(busy));
	process.exit(1);
}

console.log(
	`▸ preview  http://localhost:${port}  (this checkout's port — override with PREVIEW_PORT)`
);

// pnpm's own bin shim (it `exec`s node, so it adds no process layer), spawned by path rather than
// through `pnpm exec` — one less node between the signal handlers below and the process that owns
// `workerd`. A missing shim surfaces on the 'error' handler as a plain ENOENT.
//
// Our vars go BEFORE the forwarded arguments deliberately: wrangler takes the LAST `--var` for a
// repeated name (measured), so `pnpm preview --var ORIGIN:https://darcstar.tech` still wins. That is
// the escape hatch for previewing against a production-shaped origin — see preview-vars.mjs.
const child = spawn(
	join(REPO_ROOT, 'node_modules/.bin/wrangler'),
	[
		'dev',
		'.svelte-kit/cloudflare/_worker.js',
		'--port',
		String(port),
		...previewVarArgs(port),
		...forwarded
	],
	{ cwd: REPO_ROOT, stdio: 'inherit' }
);

let stopping = false;
let escalation;

function shutdown() {
	if (stopping) return;
	stopping = true;
	child.kill('SIGTERM');
	escalation = setTimeout(() => {
		// Descendants BEFORE the child: killing wrangler first is exactly how workerd gets orphaned,
		// which is the bug this script exists to stop making.
		for (const pid of [...descendants(child.pid).reverse(), child.pid]) {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				// Already gone.
			}
		}
	}, GRACE_MS);
	escalation.unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Backstop for an exit this script didn't plan (an uncaught error): a preview left running here
// would hold the port with nothing left to stop it.
process.on('exit', () => {
	if (!stopping) {
		try {
			child.kill('SIGTERM');
		} catch {
			// Already gone.
		}
	}
});

child.on('error', (error) => {
	console.error(`✗ could not start wrangler: ${error.message}`);
	process.exit(1);
});

child.on('exit', (code) => {
	clearTimeout(escalation);
	// wrangler normally takes workerd down with it; when it doesn't, the port stays bound by a process
	// reparented to init the moment we let go. Asking the port is the only way to see that — see
	// reapStrayPortHolder.
	const reaped = reapStrayPortHolder(port);
	if (reaped) console.error(`▸ preview: pid ${reaped} outlived wrangler on :${port} — reaping it`);
	// `code` is null when the child died on a signal. One we ASKED for is a clean stop; one we didn't
	// (an outside `kill` aimed at wrangler itself) is a failure.
	process.exit(code ?? (stopping ? 0 : 1));
});
