import { paraglideVitePlugin } from '@inlang/paraglide-js';

import { mdsvex } from 'mdsvex';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { SANITY_IMAGE_CDN_ORIGIN, TURNSTILE_ORIGIN } from './src/lib/security-headers';
import { FailureReportReporter } from './scripts/vitest-failure-report';

const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			// Content-Security-Policy (DAR-45). Kit owns the CSP (not hooks.server.ts) because its
			// inline hydration bootstrap needs the per-response nonce Kit injects. Before adding a
			// source, read docs/security-headers.md; shared origins live in src/lib/security-headers.ts.
			csp: {
				directives: {
					'default-src': ['self'],
					// 'self' covers Kit's module scripts; the nonce Kit appends covers its inline
					// bootstrap; Turnstile's api.js is loaded from challenges.cloudflare.com (/signup).
					'script-src': ['self', TURNSTILE_ORIGIN],
					// 'unsafe-inline' is required: Svelte transitions (Header, BackToTop) inject <style>
					// elements at runtime, and SSR'd `style=` attributes (+page.svelte pillars) can't be
					// nonced. Kit skips nonces for styles when 'unsafe-inline' is present (a nonce would
					// make browsers ignore it).
					'style-src': ['self', 'unsafe-inline'],
					// data: is @tailwindcss/forms' inline-SVG chevrons/checkmarks; cdn.sanity.io is the
					// Sanity image CDN (/news · /research · /people).
					'img-src': ['self', 'data:', SANITY_IMAGE_CDN_ORIGIN],
					// data: because Vite inlines assets under 4KB — the JetBrains Mono subsets small
					// enough to clear that bar ship as data: URIs inside the CSS bundle.
					'font-src': ['self', 'data:'],
					'connect-src': ['self'],
					// The Turnstile widget renders inside a challenges.cloudflare.com iframe.
					'frame-src': [TURNSTILE_ORIGIN],
					// Clickjacking: nothing embeds this site (mirrored by X-Frame-Options: DENY in the
					// hook for legacy browsers). frame-ancestors only works because every page is SSR'd:
					// a prerendered page would get the CSP as a <meta> tag, which can't carry it — the
					// e2e suite asserts the worker headers on every audited path to pin that invariant.
					'frame-ancestors': ['none'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			},
			preprocess: [mdsvex({ extensions: ['.svx', '.md'] })],
			extensions: ['.svelte', '.svx', '.md'],
			experimental: { remoteFunctions: true },
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
					// Kit's generated include covers src/ and the vite config only, so `pnpm check` used
					// to skip the e2e config and everything in scripts/ entirely — including, as of
					// DAR-79, a spec and the module both of those import. Both are clean today; adding
					// them means the next edit that isn't gets caught by CI rather than at runtime.
					config.include.push('../scripts/**/*.ts', '../playwright.config.ts');
				}
			}
		}),

		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['url']
		})
	],
	test: {
		expect: { requireAssertions: true },
		// A red run writes itself to test-failures/ (DAR-90). The default reporter's output is the
		// terminal's, and the terminal is exactly what got lost: a run piped through `grep` and then
		// re-run left a failure with no name attached, which is why that ticket exists. Root-level on
		// purpose — `reporters` is not a per-project option, and one run should produce one report
		// across all three projects.
		reporters: ['default', new FailureReportReporter()],
		// Off by default in vitest (a small collection-time cost). On, because it is what turns a
		// recorded failure into a `file:line` you can click — the report exists to be acted on by
		// someone who cannot reproduce the run it describes.
		includeTaskLocation: true,
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					// Headroom, measured (DAR-90). The slowest test here ran 914ms and 2346ms in two runs on
					// the SAME machine — 2.6x run-to-run variance, leaving only 2.1x margin against vitest's
					// 5s default at the slow end. That is the tightest margin in the suite, and the variance
					// is the point: browser startup is what stretches when the box is loaded. The server
					// project's slowest is 1268ms and keeps the default, because a tight default is what
					// catches a genuinely hung node test.
					// This is NOT a retry and hides nothing: a broken browser test still fails, 10s later.
					// It closes a real fragility, but it is not a confirmed fix for the original DAR-90
					// failure — that one is still unidentified, which is what the reporter above is for.
					testTimeout: 15_000,
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// scripts/ is in scope too (DAR-79's preview-port derivation): build tooling, but its
					// rules rot exactly like app code's, and there is nowhere else for them to be tested.
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},

			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
				test: {
					name: 'storybook',
					// Same browser-startup variance as the client project above; slowest here is 1476ms.
					testTimeout: 15_000,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
