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
export const GLASS_DIAGNOSTIC_FLAGS = ['nosheen', 'noblur'] as const;
export type GlassDiagnosticFlag = (typeof GLASS_DIAGNOSTIC_FLAGS)[number];

/** The query parameter carrying them, comma- or space-separated. */
export const GLASS_DIAGNOSTIC_PARAM = 'glassdiag';

export interface GlassDiagnostics {
	/** Skip rendering `.sheen-plane` entirely — no beam, no clip writes, no scroll listener. */
	noSheen: boolean;
	/** Drop every glass `backdrop-filter` to `none` (the CSS half lives in layout.css). */
	noBlur: boolean;
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

const INERT: GlassDiagnostics = { noSheen: false, noBlur: false, attr: undefined };

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
		attr: active.join(' ')
	};
}
