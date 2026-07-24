import { getSanityClient } from '$lib/server/sanity';
import { sitemapEntriesQuery } from '$lib/sanity/queries';
import { localizeHref } from '$lib/paraglide/runtime';
import { TRANSLATED_LOCALES } from '$lib/seo';
import type { RequestHandler } from './$types';

// /sitemap.xml (DAR-48) — the crawlable surface in one document: the static marketing pages
// plus every routable Sanity post/paper (slug + _updatedAt via sitemapEntriesQuery). Worker-
// rendered (NOT prerendered — the content set changes with the CMS, and prerendering would
// demote it to the assets layer), absolutized against the serving origin like <Seo>'s
// canonical, so previews self-reference and production emits https://darcstar.tech URLs.
//
// Deliberately absent: /es (and any future untranslated locale tree — TRANSLATED_LOCALES is
// the shared flag; those pages are noindex until translated), gated/noindex surfaces (/admin,
// /account, /login, /signup, /forgot-password, /reset-password, /logout), and per-person URLs
// (/people has no detail routes — the index is the profile surface).

// Keep in sync with the public, indexable routes under src/routes (the security-headers e2e
// AUDITED_PAGES list is the same surface minus the noindex auth pages).
const STATIC_PATHS = [
	'/',
	'/about',
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
	try {
		({ posts, papers } = await getSanityClient().fetch(sitemapEntriesQuery));
	} catch (err) {
		console.warn('[sanity] sitemap fetch failed, emitting static pages only:', err);
	}

	const entries: { path: string; lastmod?: string }[] = [
		...STATIC_PATHS.map((path) => ({ path })),
		...posts.map((post) => ({ path: `/news/${post.slug}`, lastmod: post._updatedAt })),
		...papers.map((paper) => ({ path: `/research/${paper.slug}`, lastmod: paper._updatedAt }))
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
			// The correct XML type (nosniff is site-wide, so it must be right); an hour of shared
			// cache keeps crawler re-fetches off Sanity without meaningfully delaying new content.
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
