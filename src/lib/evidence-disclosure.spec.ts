import { describe, expect, it } from 'vitest';
import { overwriteGetLocale, baseLocale } from '$lib/paraglide/runtime';
import { m } from '$lib/paraglide/messages.js';
import { THEOREMS_CHECKED } from './evidence';

// Paraglide resolves the locale from the request and `getLocale()` throws rather than guessing;
// there is no request here. Same escape hatch, and the same caveat, as `seo-head.spec.ts`: this
// mutates runtime module state and is never restored, which is safe only while vitest isolates
// per file.
overwriteGetLocale(() => baseLocale);

// The third copy guard on the evidence surface, and a third axis (DAR-117). `evidence-boundary`
// is an IP boundary — what we must not disclose. `safety-language` is a truth boundary — what we
// must not overstate. This one is a DISCLOSURE boundary: a figure we do publish must not be shown
// stripped of the qualification that makes it honest.
//
// It exists because the homepage led with the raw machine-checked total in the largest type on
// the site while the complete/axiom-backed breakdown lived two clicks away on /evidence. Nothing
// about that was false, and nothing failed — which is the whole problem: understating a figure is
// caught by review, overstating one by these specs, but publishing a true number with its
// qualification somewhere else entirely is invisible to both.
//
// Same contract as its siblings: a failure here means REWORD THE COPY, never loosen the assertion.
describe('the published theorem figures stay qualified (DAR-117)', () => {
	// The homepage readout leads with THEOREMS_COMPLETE — the smaller, stronger figure — so the
	// label has to carry the total as its denominator, or the biggest number on the page becomes
	// an unexplained "31". Pinned against the constant rather than the string "219", so a
	// re-measure moves both together.
	//
	// This is the ONLY guard on the placeholder: the obvious assumption is that Paraglide compiles
	// the accessor's signature from the message, so deleting `{checked}` would make the call site a
	// type error — measured, and it does not. `pnpm check` passes clean against a label that takes
	// no parameter while the call site still passes one.
	it('names the machine-checked total beside the complete count', () => {
		const label = m.readout_theorems_label({ checked: THEOREMS_CHECKED });
		expect(label).toContain(String(THEOREMS_CHECKED));
		expect(label).toMatch(/\bcomplete\b/i);
	});

	// DAR-46's rule, applied to the term this ticket introduced: each surface defines the term IT
	// uses. "Complete" is doing the work in that readout and means nothing to a first-time reader
	// — so the homepage defines it, on the homepage, rather than delegating to /evidence. Both
	// halves matter: "complete" alone could be a passing adjective, and it is the "zero local
	// axioms" clause that makes the number mean more than the total it is drawn from.
	it('defines what complete means on the page that shows the count', () => {
		expect(m.section_proven_body()).toMatch(/\bcomplete\b/i);
		expect(m.section_proven_body()).toMatch(/local axiom/i);
	});

	// The /evidence card and /evidence/proofs both enumerate the framework assumptions, and two
	// pages naming different premises would be worse than either naming none — a reader comparing
	// them cannot tell which list is the real one. Derived from the card, checked against the
	// detail page, so adding one to the card without the page fails.
	//
	// One-directional, honestly: an assumption added only to the detail page still passes. The
	// floor below is what stops the whole check going vacuous, which is the failure mode that
	// matters — reword the card's parenthetical away and the derived list empties, so every
	// `toContain` would pass against a page that names nothing at all.
	it('names the same framework assumptions on the card and the detail page', () => {
		// Anchored on the phrase rather than "the first parenthetical", so a second parenthetical
		// added earlier in that sentence can't silently redirect the check at an unrelated list.
		const named = m
			.evidence_theorems_not_covered()
			.match(/Framework assumptions \(([^)]+)\)/)?.[1]
			?.split(',')
			.map((assumption) => assumption.trim())
			.filter(Boolean);

		// Covers the regex failing outright: no match → undefined → 0, so a reworded card fails
		// here rather than leaving the loop below with nothing to check.
		expect(
			named?.length ?? 0,
			'evidence_theorems_not_covered no longer names its assumptions'
		).toBeGreaterThan(2);
		for (const assumption of named ?? []) {
			expect(m.evidence_proofs_axioms_assumptions_body(), assumption).toContain(assumption);
		}
	});

	// The distinction the page exists to draw, in the one form a test can see: each of the three
	// cases states the claim that separates it from the other two — assumptions survive being
	// complete and are NOT debt, local axioms ARE debt and are discharged, a carried physical
	// premise is not counted at all. Collapse any two of them into the same words — exactly what
	// the page was filed to prevent — and the case that lost its distinguishing claim fails here.
	//
	// All positive. The obvious extra assertion is that the assumptions body never says
	// "discharge", and it is the one to leave out: "these are never discharged" is natural
	// phrasing for precisely the correct copy, so it would fail on a rewrite that made the page
	// clearer. `not debt` is the same guarantee stated as a claim rather than as an absence.
	it('keeps the three cases distinguishable from one another', () => {
		expect(m.evidence_proofs_axioms_assumptions_body()).toMatch(/\bcomplete\b/i);
		expect(m.evidence_proofs_axioms_assumptions_body()).toMatch(/not debt/i);
		expect(m.evidence_proofs_axioms_local_body()).toMatch(/\bdebt\b/i);
		expect(m.evidence_proofs_axioms_local_body()).toMatch(/discharge/i);
		expect(m.evidence_proofs_axioms_carried_body()).toMatch(/not counted/i);
	});
});
