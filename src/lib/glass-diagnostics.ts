// TEMPORARY diagnostic harness for DAR-170 (frosted-glass ghosting on mobile during scroll).
// DELETE THIS MODULE WITH THE TICKET — it exists to answer one question and has no product value.
//
// The ghosting has two candidate mechanisms that cannot be separated by observation, because both
// are velocity-dependent and both survive `prefers-reduced-motion`:
//
//   C1  the sheen plane's per-frame `clip-path` rewrite lagging coalesced mobile scroll events
//   C2  `backdrop-filter` re-sampling its backdrop while the glass moves under compositor scroll
//
// Separating them needs each disabled INDEPENDENTLY on a real device — mobile emulation cannot
// reproduce either (it changes viewport/DPR/UA, not the compositor or scroll-event delivery). So the
// arms ride a query parameter rather than a build flag: one deploy answers the whole matrix, which
// matters when every rebuild means getting another bundle onto a phone.
//
//   ?glassdiag=nosheen          the plane is not rendered at all — no beam, and `createSheenSync`
//                               never attaches, so there is no scroll listener and no clip write
//   ?glassdiag=noblur           every `backdrop-filter` on the glass drops to `none` (layout.css)
//   ?glassdiag=nosheen,noblur   both
//
// ROUND 1 RESULT (2026-07-30, real device, both motion modes): `nosheen` is clean, `noblur` alone
// still ghosts. So `backdrop-filter` is irrelevant — the plane alone is sufficient — and the ghost
// also survives a FROZEN beam (reduced motion stops the animation but not the clip writes, and the
// control still ghosts there). Which leaves two sub-causes inside the plane:
//
//   S1  the per-frame `clip-path` write lagging coalesced scroll events → fix the update strategy
//   S2  the plane's mere presence as a large fixed composited layer      → the feature can't work
//                                                                          this way on mobile
//
//   ?glassdiag=fix2             ROUND 3 — the candidate fix itself (glass-sheen-v2.ts), opt-in so the
//                               default keeps reproducing the artifact for comparison in one deploy.
//
//   ?glassdiag=noclip           ROUND 2. The plane and beam mount, but `createSheenSync` never
//                               attaches (no scroll listener, no per-frame write) and the clip is
//                               pinned to a STATIC path. Ghost returns → S2. Stays clean → S1.
//
// The static value is a `path()` covering any viewport rather than `none` or `inset(0)`, so the arm
// changes exactly one variable: the property, its value type and the compositing category all stay
// what they are in production, and only the per-frame updating is removed. The beam then paints over
// the whole screen instead of just the glass, which looks wrong — irrelevant, since the only question
// this arm asks is whether it TRAILS.
//
// Run each arm in BOTH motion modes: reduced motion swaps which main-thread paint path sits on the
// scroll hot path (with motion allowed the canvas animates on its own rAF and scroll costs the clip
// rewrite; under reduce the loop stops but CosmicBackdrop's `onScroll` redraws the whole canvas per
// event), so an arm that looks clean in one mode can ghost in the other.
//
// NOT gated to non-production, deliberately: the tester may be on a Workers Builds preview URL, an
// alias, or prod, and a hostname check would silently make the flags do nothing on one of them —
// exactly the failure mode that wastes a device session. The blast radius is cosmetic: with no
// parameter the harness is inert and emits NO attribute at all, so normal traffic renders
// byte-identically. That inertness is the property `glass-diagnostics.spec.ts` pins, because a bug
// here would unfrost the site or kill the sheen for everyone.

/** The recognized arms. A token outside this list is ignored, never echoed. */
export const GLASS_DIAGNOSTIC_FLAGS = ['nosheen', 'noblur', 'noclip', 'fix2'] as const;
export type GlassDiagnosticFlag = (typeof GLASS_DIAGNOSTIC_FLAGS)[number];

/** The query parameter carrying them, comma- or space-separated. */
export const GLASS_DIAGNOSTIC_PARAM = 'glassdiag';

export interface GlassDiagnostics {
	/** Skip rendering `.sheen-plane` entirely — no beam, no clip writes, no scroll listener. */
	noSheen: boolean;
	/** Drop every glass `backdrop-filter` to `none` (the CSS half lives in layout.css). */
	noBlur: boolean;
	/**
	 * Swap the sheen for the DAR-170 candidate fix ($lib/glass-sheen-v2): two planes with static,
	 * scroll-invariant clips and no scroll listener on the hot path. Opt-in while it is measured on a
	 * device, so the default path stays exactly what production ships.
	 */
	fix2: boolean;
	/**
	 * Mount the plane and beam but never update the clip: no `createSheenSync`, so no scroll
	 * listener and no per-frame write, with the clip pinned to `STATIC_CLIP_PATH`. Ignored when
	 * `noSheen` is also set — there is no plane to leave unclipped.
	 */
	noClip: boolean;
	/**
	 * Value for `data-glass-diag` on the layout wrapper, or `undefined` when nothing is active so
	 * Svelte omits the attribute and normal traffic ships no trace of the harness.
	 *
	 * Built from the RECOGNIZED flags, never from the raw parameter: this string lands in an
	 * attribute, and echoing caller-supplied text there — even escaped — is a habit worth not
	 * having.
	 */
	attr: string | undefined;
}

const INERT: GlassDiagnostics = {
	noSheen: false,
	noBlur: false,
	noClip: false,
	fix2: false,
	attr: undefined
};

/**
 * The `noclip` arm's frozen clip. A `path()` like the real one (see the note up top — same property,
 * same value type, only the updating removed), sized past any viewport so the whole beam shows.
 */
export const STATIC_CLIP_PATH = "path('M0 0H20000V20000H0Z')";

/**
 * Resolve the diagnostic arms from a URL's query string.
 *
 * Fail-closed on every axis: a missing parameter, an empty value, or a value containing only
 * unrecognized tokens all yield the inert result. Only the exact literals in
 * `GLASS_DIAGNOSTIC_FLAGS` turn anything on.
 */
export function glassDiagnostics(params: URLSearchParams): GlassDiagnostics {
	const raw = params.get(GLASS_DIAGNOSTIC_PARAM);
	if (!raw) return INERT;

	const requested = new Set(
		raw
			.split(/[,\s]+/)
			.map((token) => token.trim().toLowerCase())
			.filter(Boolean)
	);
	// Iterate the KNOWN list rather than the request, so the attribute's token order is stable and
	// its contents are ours by construction.
	const active = GLASS_DIAGNOSTIC_FLAGS.filter((flag) => requested.has(flag));
	if (active.length === 0) return INERT;

	return {
		noSheen: active.includes('nosheen'),
		noBlur: active.includes('noblur'),
		noClip: active.includes('noclip'),
		fix2: active.includes('fix2'),
		attr: active.join(' ')
	};
}
