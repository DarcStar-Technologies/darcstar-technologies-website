import { defineConfig } from '@playwright/test';
import { portBusyMessage, portListenerReport, previewPort } from './scripts/preview-port.mjs';

// The port is DERIVED per checkout (scripts/preview-port.mjs) and passed down to the preview script,
// so this config and `pnpm preview` cannot disagree about it — they used to hardcode 4173 each.
const port = previewPort();

// DAR-79. `reuseExistingServer` defaults ON locally, and that default is a trap here: with every
// checkout previewing on 4173, a server left running in a SIBLING worktree got reused and the suite
// reported green for someone else's branch. Off by default now, so a busy port stops the run.
//
// E2E_REUSE_SERVER is the way back for the iterate-on-specs loop, where you keep a fresh preview up
// and want to skip the ~60s rebuild each run. It is loud, because the failure it re-enables (a STALE
// build answering the tests) is silent.
const reuseExistingServer = Boolean(process.env.E2E_REUSE_SERVER);

// Everything below runs ONLY in the main process. Playwright re-imports this config in every test
// worker, and by then our own webServer holds the port — so an ungated check fails the run against
// its own server (one identical error per worker; it did, before this line). TEST_WORKER_INDEX is
// set only in workers, and the main process is the one that loads before the server exists.
if (process.env.TEST_WORKER_INDEX === undefined) {
	if (reuseExistingServer) {
		console.warn(
			`⚠ E2E_REUSE_SERVER: if anything is already on :${port} it will be reused as-is, and these ` +
				'results describe THAT build rather than the one this run would have made.'
		);
	}
	// Playwright checks the port itself and fails with a bare "already used" — true, but it leaves you
	// to work out whose server it is, and the answer to that question under time pressure has been a
	// blind `pkill` that killed a sibling session's. Name the owner first.
	const busy = reuseExistingServer ? null : portListenerReport(port);
	if (busy) {
		const error = new Error(portBusyMessage(busy));
		// The stack would be ten frames of Playwright's config loader under a message that already says
		// everything; the reader needs the pid, not the loader. (Assigning the message rather than ''
		// also drops Playwright's "Error:" prefix — this is a state of the machine, not a crash.)
		error.stack = error.message;
		throw error;
	}
}

export default defineConfig({
	// One retry in CI with a trace captured on it — without an artifact, a red CI e2e leaves
	// nothing to inspect (test.yml uploads test-results/ on failure).
	retries: process.env.CI ? 1 : 0,
	use: { trace: 'on-first-retry' },
	// timeout: the default 60s covers `preview` alone, but the command also runs a full Cloudflare
	// build first — a cold CI runner regularly needs longer, and a timeout here fails the whole run.
	// stdout 'pipe' (default: ignore) surfaces the build/wrangler boot log when that timeout hits.
	webServer: {
		command: 'pnpm build && pnpm preview',
		port,
		// Pins the child to the same port by construction rather than by both sides deriving it.
		env: { PREVIEW_PORT: String(port) },
		reuseExistingServer,
		timeout: 180_000,
		stdout: 'pipe'
	},
	testMatch: '**/*.e2e.{ts,js}'
});
