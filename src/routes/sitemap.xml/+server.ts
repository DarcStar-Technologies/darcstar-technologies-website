import { getSanityClient } from '$lib/server/sanity';
import { sitemapEntriesQuery } from '$lib/sanity/queries';
import { localizeHref } from '$lib/paraglide/runtime';
import { TRANSLATED_LOCALES } from '$lib/seo';
import type { RequestHandler } from './$types';

// /sitemap.xml (DAR-48) — the crawlable surface in one document: the static marketing pages
// plus every routable Sanity post/paper/person (slug + _updatedAt via sitemapEntriesQuery).
// Worker-rendered (NOT prerendered — the content set changes with the CMS, and prerendering would
// demote it to the assets layer), absolutized against the serving origin like <Seo>'s
// canonical, so previews self-reference and production emits https://darcstar.tech URLs.
//
// Deliberately absent: /es (and any future untranslated locale tree — TRANSLATED_LOCALES is
// the shared flag; those pages are noindex until translated) and the gated/noindex surfaces
// (/admin, /account, /login, /signup, /forgot-password, /reset-password, /logout).
//
// EVERY CONTENT TYPE HERE IS TWO HALVES — a `sitemapEntriesQuery` arm and a mapping below — and the
// second is easy to forget, because the first alone type-checks and the sitemap merely comes back
// thinner. CI cannot catch it (e2e runs without SANITY_VIEWER_TOKEN, DAR-96, so no CMS-driven <loc>
// exists there), which is why server.spec.ts drives this handler against a mocked client. Add a type,
// add a case there.

// Keep in sync with the public, indexable STATIC routes under src/routes (the security-headers e2e
// AUDITED_PAGES list is the same surface minus the noindex auth pages).
//
// The content DETAIL routes — /news/[slug], /research/[slug], /people/[slug] — are deliberately not in
// AUDITED_PAGES: that suite has no viewer token, so every one of them 404s there and the audit would
// be proving the CSP of an error page. seo.e2e.ts's route enumeration skips `[…]` segments for the
// same reason, so a new dynamic route is covered by the query + the mapping below, not by that list.
const STATIC_PATHS = [
	'/',
	'/about',
	'/evidence',
	'/evidence/benchmarks',
	'/evidence/proofs',
	'/news',
	'/research',
	'/people',
	'/contact',
	'/waitlist',
	'/privacy',
	'/terms'
];

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export const GET: RequestHandler = async ({ url }) => {
	// Same resilience posture as the /news · /research · /people list loads: a Sanity outage
	// degrades to a static-pages-only sitemap + a log line, never a 500 — crawlers treat a
	// failing sitemap far worse than a temporarily thinner one.
	let posts: { slug: string; _updatedAt: string }[] = [];
	let papers: { slug: string; _updatedAt: string }[] = [];
	let people: { slug: string; _updatedAt: string }[] = [];
	try {
		({ posts, papers, people } = await getSanityClient().fetch(sitemapEntriesQuery));
	} catch (err) {
		console.warn('[sanity] sitemap fetch failed, emitting static pages only:', err);
	}

	const entries: { path: string; lastmod?: string }[] = [
		...STATIC_PATHS.map((path) => ({ path })),
		...posts.map((post) => ({ path: `/news/${post.slug}`, lastmod: post._updatedAt })),
		...papers.map((paper) => ({ path: `/research/${paper.slug}`, lastmod: paper._updatedAt })),
		...people.map((person) => ({ path: `/people/${person.slug}`, lastmod: person._updatedAt }))
	];

	// One <url> per translated locale (just `en` today — the same single flag that drives
	// Seo.svelte's noindex). When a second locale ships, its tree joins automatically; add the
	// reciprocal xhtml:link alternates alongside Seo.svelte's hreflang TODO then.
	const urlElements = entries.flatMap(({ path, lastmod }) =>
		TRANSLATED_LOCALES.map((locale) => {
			const loc = escapeXml(url.origin + localizeHref(path, { locale }));
			return lastmod
				? `\t<url><loc>${loc}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`
				: `\t<url><loc>${loc}</loc></url>`;
		})
	);

	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urlElements,
		'</urlset>',
		''
	].join('\n');

	return new Response(body, {
		headers: {
			// The correct XML type (nosniff is site-wide, so it must be right). The max-age is
			// CLIENT-side only: Cloudflare does not edge-cache a Worker response off Cache-Control
			// alone (that would need the Cache API or a Cache Rule) — but Googlebot honors it
			// between sitemap re-fetches, which is the traffic that matters here.
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
