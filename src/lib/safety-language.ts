// The published safety vocabulary (DAR-46, docs/evidence.md) as a detector, so the truth boundary
// can be checked on more than one surface — the same move DAR-152 made for the IP boundary when the
// e2e needed the rules the unit spec was holding.
//
// The rules lived inside safety-language.spec.ts until DAR-171, which is fine while the only surface
// is the message catalog and wrong the moment there is a second one: CMS prose is published text
// that no spec can see (CI has no Sanity read token — DAR-96), so `pnpm check:cms` scans it by hand,
// and it must apply THESE rules rather than a second hand-kept copy of them.
//
// Sibling of evidence-boundary.ts and the same contract: that one is an IP boundary (what we must not
// DISCLOSE), this one is a truth boundary (what we must not OVERSTATE), and on a hit the answer is
// REWORD THE COPY, never loosen the pattern.
//
// Scoped to conclusions, not vocabulary. "Proven", "provable", "guarantee" and "safe" are all
// legitimate on their own — the site does prove theorems, and the homepage H1 "Autonomous control you
// can prove is safe." claims provability, which is true. What is banned is the collapsed form that
// asserts a system IS safe with no assumptions attached, plus the one phrasing docs/evidence.md
// forbids outright (a proven latency bound — GIDE's corpus proves none).

export interface SafetyLanguageRule {
	name: string;
	pattern: RegExp;
	/** Message keys excused from this rule. Meaningful only for the catalog scan — a CMS document has
	 * no key, so `findSafetyLanguageViolations` applies every rule and a legitimate quotation in CMS
	 * prose is a judgement call on a hand-run report. */
	allowKeys?: string[];
}

export const SAFETY_LANGUAGE_RULES: SafetyLanguageRule[] = [
	{ name: 'the phrase "proven safe"', pattern: /\bproven[ -]safe\b/i },
	{ name: 'the phrase "provably safe"', pattern: /\bprovably[ -]safe\b/i },
	{ name: 'the phrase "guaranteed safe"', pattern: /\bguaranteed[ -]safe\b/i },
	{
		// docs/evidence.md: "Never claim a proven latency bound." No microsecond or latency bound
		// is proven anywhere in the corpus; latency is measured and the 13,000× is derived.
		name: 'a proven sub-second bound ("proven microsecond safety")',
		pattern: /\bproven\s+(micro|milli|nano)?second/i,
		// The safety card's own boundary statement quotes the banned phrase in order to disavow
		// it ("...any 'proven microsecond safety' phrasing would be false, and we do not use
		// it."). That sentence is the point of the rule, not a violation of it — it is the ONLY
		// key allowed to contain the phrase, and it must keep quoting it verbatim to stay legible.
		allowKeys: ['evidence_safety_not_covered']
	},
	{ name: 'a proven latency claim', pattern: /\bproven\s+latency\b/i }
];

/** Characters either side of a hit to quote back. Cosmetic — unlike evidence-boundary's
 * `CONTEXT_WINDOW`, which is a measured part of DETECTION, this only sizes a failure message, so it
 * is a readability choice and nothing depends on the number. */
const QUOTE_WINDOW = 70;

/**
 * Every banned safety formulation in one piece of text.
 *
 * @param text a message value, CMS prose, or rendered page text
 * @returns one description per hit; empty means clean
 */
export function findSafetyLanguageViolations(text: string): string[] {
	return SAFETY_LANGUAGE_RULES.flatMap(({ name, pattern }) => {
		const match = pattern.exec(text);
		if (!match) return [];
		const from = Math.max(0, match.index - QUOTE_WINDOW);
		const to = match.index + match[0].length + QUOTE_WINDOW;
		return [`${name}: …${text.slice(from, to).trim()}…`];
	});
}
