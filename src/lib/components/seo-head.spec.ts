import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// NOT named `Seo.svelte.spec.ts` on purpose. That suffix routes a file to the `client` vitest
// project, which runs in a real browser — but what has to be asserted here is the SERVER-rendered
// <head>, since scrapers and crawlers never run JS. This name keeps it in the `server` project,
// where `render` from 'svelte/server' returns the head markup as a string. Renaming it to match the
// component-test convention would move it to the wrong runtime; leave it.

// `page.url` is the only thing Seo.svelte needs from the SvelteKit runtime, and it reads just
// `.origin` and `.pathname`. Mocked at the module boundary so the component can be rendered
// standalone. Must be hoisted above the import of the component itself.
const PAGE_URL = new URL('https://darcstar.tech/research/attention-is-all-you-need');
vi.mock('$app/state', () => ({ page: { url: PAGE_URL } }));

// Paraglide's url strategy resolves the locale from the request; there isn't one here, and
// `getLocale()` throws rather than guessing. `overwriteGetLocale` is its documented escape hatch —
// preferred over mocking the runtime module, which would have to re-export everything the message
// index also pulls from it. Base locale keeps `noindex` off (TRANSLATED_LOCALES), so these tests
// see the same head an English visitor gets.
//
// This mutates module state in the Paraglide runtime and is never restored, which is safe ONLY
// because vitest isolates per file (each test file gets its own module registry). If `isolate` is
// ever turned off in vite.config.ts, this leaks into every other spec sharing the worker — restore
// it in an afterAll then, or switch to mocking.
const { overwriteGetLocale, baseLocale } = await import('$lib/paraglide/runtime');
overwriteGetLocale(() => baseLocale);

const Seo = (await import('./Seo.svelte')).default;

// SSR, deliberately — social scrapers and crawlers don't run JS, so the server-rendered <head> IS
// the artifact under test. `render` from 'svelte/server' returns it as a string.
function head(props: Record<string, unknown> = {}): string {
	return render(Seo, { props }).head;
}

function attr(markup: string, selector: RegExp): string | undefined {
	return markup.match(selector)?.[1];
}

const canonicalHref = (markup: string) => attr(markup, /<link rel="canonical" href="([^"]*)"/);
const ogUrl = (markup: string) => attr(markup, /<meta property="og:url" content="([^"]*)"/);

// DAR-70's central risk, and the one thing the seo.e2e.ts pin CANNOT catch: `canonical` and
// `og:url` were a single derived value, so making the canonical overridable would have moved
// og:url with it — handing every social share of our page to arxiv.org as its graph identity.
//
// The e2e can only assert the DEFAULT, where the two are equal by construction, so swapping which
// one feeds og:url is invisible there (verified: the mutation passes that suite). Divergence needs
// a `canonical` prop, and the only pages that pass one are CMS-driven — unreachable from hermetic
// CI. Hence this SSR render test: it is the sole automated guard on the split.
describe('Seo.svelte — canonical vs og:url', () => {
	it('defaults both to the page URL', () => {
		const markup = head();
		expect(canonicalHref(markup)).toBe(PAGE_URL.href);
		expect(ogUrl(markup)).toBe(PAGE_URL.href);
	});

	it('moves ONLY the canonical when a page overrides it', () => {
		const source = 'https://arxiv.org/abs/1706.03762';
		const markup = head({ canonical: source });

		expect(canonicalHref(markup)).toBe(source);
		// The assertion this file exists for. If og:url follows the canonical off-site, a share of
		// our page is attributed to arXiv.
		expect(ogUrl(markup)).toBe(PAGE_URL.href);
	});

	it('keeps `path` driving both — it renames THIS page, it does not point elsewhere', () => {
		const markup = head({ path: '/research' });
		expect(canonicalHref(markup)).toBe('https://darcstar.tech/research');
		expect(ogUrl(markup)).toBe('https://darcstar.tech/research');
	});

	it('lets canonical win over path, still without moving og:url', () => {
		const markup = head({ path: '/research', canonical: 'https://arxiv.org/abs/1706.03762' });
		expect(canonicalHref(markup)).toBe('https://arxiv.org/abs/1706.03762');
		expect(ogUrl(markup)).toBe('https://darcstar.tech/research');
	});
});
