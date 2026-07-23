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
			// inline hydration bootstrap needs the per-response nonce Kit injects; the other security
			// headers are static and live in the hooks.server.ts security-headers handle. Every page is
			// SSR'd (nothing prerenders), so this always ships as a header, never a <meta> tag — which
			// is what lets `frame-ancestors` work. See docs/security-headers.md before adding a source.
			csp: {
				directives: {
					'default-src': ['self'],
					// 'self' covers Kit's module scripts; the nonce Kit appends covers its inline
					// bootstrap; Turnstile's api.js is loaded from challenges.cloudflare.com (/signup).
					'script-src': ['self', 'https://challenges.cloudflare.com'],
					// 'unsafe-inline' is required: Svelte transitions (Header, BackToTop) inject <style>
					// elements at runtime, and SSR'd `style=` attributes (+page.svelte pillars) can't be
					// nonced. Kit skips nonces for styles when 'unsafe-inline' is present (a nonce would
					// make browsers ignore it).
					'style-src': ['self', 'unsafe-inline'],
					// data: is @tailwindcss/forms' inline-SVG chevrons/checkmarks; cdn.sanity.io is the
					// Sanity image CDN (/news · /research · /people).
					'img-src': ['self', 'data:', 'https://cdn.sanity.io'],
					// data: because Vite inlines assets under 4KB — the JetBrains Mono subsets small
					// enough to clear that bar ship as data: URIs inside the CSS bundle.
					'font-src': ['self', 'data:'],
					'connect-src': ['self'],
					// The Turnstile widget renders inside a challenges.cloudflare.com iframe.
					'frame-src': ['https://challenges.cloudflare.com'],
					// Clickjacking: nothing embeds this site (mirrored by X-Frame-Options: DENY in the
					// hook for legacy browsers).
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
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
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
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},

			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
				test: {
					name: 'storybook',
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
