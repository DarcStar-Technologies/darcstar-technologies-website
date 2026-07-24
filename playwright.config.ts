import { defineConfig } from '@playwright/test';

export default defineConfig({
	// One retry in CI with a trace captured on it — without an artifact, a red CI e2e leaves
	// nothing to inspect (test.yml uploads test-results/ on failure).
	retries: process.env.CI ? 1 : 0,
	use: { trace: 'on-first-retry' },
	// reuseExistingServer defaults on locally: a STALE server already on 4173 (old build, or one
	// started without the preview script's Turnstile test keys) gets reused, and the /signup CSP
	// test then times out waiting for the widget — kill the old server, don't debug the CSP.
	// timeout: the default 60s covers `preview` alone, but the command also runs a full Cloudflare
	// build first — a cold CI runner regularly needs longer, and a timeout here fails the whole run.
	// stdout 'pipe' (default: ignore) surfaces the build/wrangler boot log when that timeout hits.
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		timeout: 180_000,
		stdout: 'pipe'
	},
	testMatch: '**/*.e2e.{ts,js}'
});
