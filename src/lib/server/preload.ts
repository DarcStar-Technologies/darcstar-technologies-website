import type { ResolveOptions } from '@sveltejs/kit';

// Which assets ride the `Link: rel="preload"` response header (wired into resolve() by
// hooks.server.ts). The browser acts on that header the moment the response status line
// arrives — before the CSS is fetched, parsed, or laid out — which is what pulls the fonts
// out of the first-paint critical path (DAR-50: mobile FCP/LCP tracked font arrival, because
// by default fonts are discovered only after HTML → CSS fetch → style/layout → @font-face
// fetch). Cloudflare MAY additionally upgrade the header to a 103 Early Hints interim
// response, but only where the zone setting is enabled and the response is eligible — prod
// currently emits no 103, and the win does not depend on it.
//
// Fonts: ONLY the three latin normal-style variable faces (Space Grotesk / Inter / JetBrains
// Mono — heading / body / eyebrow, all above the fold on every page). The test is
// `-latin-wght-normal.` — the trailing dot sits just before Vite's content hash in the built
// name (inter-latin-wght-normal.Dx4kXJAl.woff2), so it excludes BOTH the other 12 subset
// files (latin-ext/cyrillic/greek/vietnamese stay lazy behind their unicode-range —
// preloading them would waste ~300KB per view; their names carry `-latin-ext-wght-` etc.)
// AND any future italic face (`-latin-wght-italic.`), which a looser `-latin-wght-`
// substring would silently promote into the critical path. css/js mirrors SvelteKit's
// default preloading. The boundary is pinned by preload.spec.ts — a Fontsource bump that
// renames subset files should fail there, not silently change the preload set.
export const preloadFilter: NonNullable<ResolveOptions['preload']> = ({ type, path }) =>
	type === 'font' ? path.includes('-latin-wght-normal.') : type === 'css' || type === 'js';
