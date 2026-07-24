import { defineConfig } from '@playwright/test';

export default defineConfig({
	// reuseExistingServer defaults on locally: a STALE server already on 4173 (old build, or one
	// started without the preview script's Turnstile test keys) gets reused, and the /signup CSP
	// test then times out waiting for the widget — kill the old server, don't debug the CSP.
	// timeout: the default 60s covers `preview` alone, but the command also runs a full Cloudflare
	// build first — a cold CI runner regularly needs longer, and a timeout here fails the whole run.
	webServer: { command: 'npm run build && npm run preview', port: 4173, timeout: 180_000 },
	testMatch: '**/*.e2e.{ts,js}'
});
