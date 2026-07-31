import { describe, expect, it } from 'vitest';
import { overwriteGetLocale, baseLocale } from '$lib/paraglide/runtime';
import { m } from '$lib/paraglide/messages.js';
import en from '../../messages/en.json';
import {
	CONTROLLER_LATENCY_P50,
	CONTROLLER_LATENCY_P99,
	CONTROLLER_MARGIN_P50,
	CONTROLLER_MARGIN_P99,
	THEOREMS_CHECKED
} from './evidence';

// Paraglide resolves the locale from the request and `getLocale()` throws rather than guessing;
// there is no request here. Same escape hatch, and the same caveat, as `seo-head.spec.ts`: this
// mutates runtime module state and is never restored, which is safe only while vitest isolates
// per file.
overwriteGetLocale(() => baseLocale);

// The third copy guard on the evidence surface, and a third axis (DAR-117). `evidence-boundary`
// is an IP boundary — what we must not disclose. `safety-language` is a truth boundary — what we
// must not overstate. This one is a DISCLOSURE boundary: something we do publish must not be shown
// stripped of the qualification that makes it honest. That was a figure in DAR-117 and a claim in
// DAR-212 (second describe below) — the axis is the same either way.
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

// A margin is a QUOTIENT, and one published over a p50/p99 pair does not say which latency it
// divided (DAR-209). Nothing about the old sentence was false — 190× at p50 and ~100× at p99 are
// both true of the same controller — but under a real-time budget the TAIL is what decides whether
// the loop holds, so the single figure published was the one that mattered least, and it is the one
// a reviewer recomputes first. The review did exactly that. Same axis as the block above: a true
// number published stripped of the qualification that makes it readable.
//
// The arithmetic is `evidence.spec.ts`'s. What is pinned here is the qualification, and it needs a
// test rather than a type because of an asymmetry in what Paraglide generates: ADDING a placeholder
// makes every call site a `pnpm check` error (the inputs object is required and its keys are), so
// wiring a new figure in cannot be half-done — but taking one back OUT leaves `Inputs = {}`, which
// accepts any object literal, so the call site keeps compiling while the page quietly loses the
// attribution. Measured, and it is DAR-117's finding in the direction that matters here.
describe('every published real-time margin names the percentile it came from (DAR-209)', () => {
	// The percentile a margin is attributed to, or null when the sentence it sits in names none.
	//
	// "Nearest inside the same sentence" rather than the obvious proximity window, and the reason is
	// that BOTH margins live in one sentence on the benchmarks page. A window wide enough for the
	// connective in "at p50 it clears by roughly 190×" (22 characters) also reaches 28 characters
	// across "…190× at p50 and roughly 100× at p99" to the WRONG percentile — so swapping the two
	// arguments at the call site would still read as attributed, which is the mutation this assertion
	// exists to catch. Measured on the real copy before it was written this way. Returning the token
	// instead of a boolean is what makes one assertion cover both failures: unattributed comes back
	// null, mis-attributed comes back the other percentile.
	//
	// Sentence bounds ignore a decimal point, since latency figures carry one.
	const attributedPercentile = (text: string, margin: string): string | null => {
		const at = text.indexOf(margin);
		if (at < 0) return null;
		const stops = [...text.matchAll(/(?<!\d)\.(?!\d)/g)].map((stop) => stop.index);
		const sentence = text.slice(
			Math.max(0, ...stops.filter((stop) => stop < at).map((stop) => stop + 1)),
			stops.find((stop) => stop > at) ?? text.length
		);
		const marginAt = sentence.indexOf(margin);
		let nearest: { percentile: string; gap: number } | null = null;
		for (const found of sentence.matchAll(/\bp\d+\b/g)) {
			const gap =
				found.index > marginAt
					? found.index - (marginAt + margin.length)
					: marginAt - (found.index + found[0].length);
			if (!nearest || gap < nearest.gap) nearest = { percentile: found[0], gap };
		}
		return nearest?.percentile ?? null;
	};

	// The page the ticket was filed against. Both margins, each against its own percentile — and
	// asserting BOTH is what rules out the fix that would have been half a fix: labelling the one
	// figure already published (p50) and leaving the tail unstated is the same page with a caption,
	// since the tail was never there to mislabel.
	it('attributes both controller margins on the benchmarks page', () => {
		const body = m.evidence_bench_controller_body({
			p50: CONTROLLER_LATENCY_P50,
			p99: CONTROLLER_LATENCY_P99,
			marginP50: CONTROLLER_MARGIN_P50,
			marginP99: CONTROLLER_MARGIN_P99
		});
		expect(attributedPercentile(body, CONTROLLER_MARGIN_P50), body).toBe('p50');
		expect(attributedPercentile(body, CONTROLLER_MARGIN_P99), body).toBe('p99');
	});

	// The second surface, which is where the ticket's "a reader who meets them in either order
	// concludes the other is wrong" came from: this card used to say "roughly two orders of
	// magnitude" — a p99-shaped claim — while /evidence/benchmarks said "roughly 190×" from p50.
	// Rendering the same constant is what makes them agree; naming the percentile is what makes the
	// agreement legible. Both halves are asserted, because handing the constant in and then not
	// saying p99 would restore exactly the vagueness this replaced.
	it('attributes the tail margin on the /evidence card', () => {
		const notCovered = m.evidence_realtime_not_covered({ margin: CONTROLLER_MARGIN_P99 });
		expect(notCovered, 'the card no longer renders the shared margin').toContain(
			CONTROLLER_MARGIN_P99
		);
		expect(attributedPercentile(notCovered, CONTROLLER_MARGIN_P99), notCovered).toBe('p99');
	});

	// Those assertions are all "it matched", which passes just as happily against a matcher that
	// answers for anything (DAR-152, polarity flipped — the sibling block below needs positive cases
	// for the same reason in reverse). First case: the sentence this ticket replaced, verbatim.
	// Second: the near-miss a sentence-blind matcher waves through, where the only percentiles on the
	// page belong to a different claim.
	it.each([
		['the sentence this replaced', 'It clears the 10 ms real-time budget by roughly 190×.'],
		[
			'a percentile that belongs to another sentence',
			'It clears the budget by roughly 190×. Tail latency is reported at p50 and p99.'
		]
	])('reads %s as unattributed', (_case, text) => {
		expect(attributedPercentile(text, '190×')).toBeNull();
	});

	// The word-order half, which neither live message exercises — both write the margin first, so a
	// matcher that only looked forward would pass every assertion above.
	it('reads an attribution written the other way round', () => {
		expect(attributedPercentile('At p50 it clears the budget by roughly 190×.', '190×')).toBe(
			'p50'
		);
	});

	// The swap, as its own case rather than only as a mutation of the copy: two margins in one
	// sentence is the arrangement that makes mis-attribution possible at all, and it is a plausible
	// edit — the two placeholder names differ by two characters and the values differ by nearly a
	// factor of two. This is the case that fails against the proximity window this matcher replaced.
	it('reads a swapped pair as mis-attributed rather than as attributed', () => {
		const swapped = 'It clears the budget by roughly 100× at p50 and roughly 190× at p99.';
		expect(attributedPercentile(swapped, '190×')).toBe('p99');
		expect(attributedPercentile(swapped, '100×')).toBe('p50');
	});
});

// "Independent" is a term of art in benchmarking: it means a SEPARATE PARTY ran or witnessed the
// run, which is the whole reason a reader gives the word weight. /evidence/benchmarks headed its
// cross-checking section "Independent re-runs" over two runs that are both ours — the aarch64 one
// executes our own `bench-arm.yml` on a hosted runner, so the metal is rented and the run is not
// (DAR-210). What those re-runs actually establish is that the figure survives a change of ISA,
// compiler and machine, which is a real claim and a different one; the heading says "Cross-platform"
// now. DAR-46's axis rather than DAR-117's: the word overstated what the evidence supports, the way
// "ships" did on the org profile (DAR-128) and "guarantees" did before it.
//
// The rule is about the ADJECTIVE, and the adverb is deliberately left alone. Three live keys say
// "independently" and all three are precise: two provers checking a theorem independently OF EACH
// OTHER, and hardware "independently attributed" — the harness reads the CPU's own implementer and
// part IDs instead of us asserting what we ran on, so it is the ATTRIBUTION that is independent. The
// heading borrowed the adjective and dropped the noun that made it true.
describe('no evidence claim calls our own runs independent (DAR-210)', () => {
	// Blunt on purpose, like DAR-212's pattern below, and key-scoped for the same reason — except
	// that here the scope was MEASURED rather than argued, and the measurement is decisive.
	//
	// SAFETY_LANGUAGE_RULES is the obvious home and is the wrong one: those rules are shared with
	// `pnpm check:cms`, which reads CMS prose. Queried against the live dataset, "independent" is
	// pervasive there and every use is correct — "near-independent" coordinates after a random
	// rotation, "independently-normalized" softmax outputs (the whole subject of three posts), "six
	// independent opportunities to get it wrong", the founder bio's "independent work on hard systems
	// problems". Best of all, one post argues at length that its own reviewers are NOT independent
	// ("The verifiers aren't independent witnesses… Their agreement lowers the noise; it isn't
	// statistical independence") — copy this rule would flag while it says the very thing the rule
	// exists to enforce. Every flagship engineering post, a paper commentary and the bio would fire,
	// for zero real defects: DAR-152's failure mode exactly, where a guard that flags correct content
	// gets loosened until it catches nothing.
	//
	// So: the evidence surface only, where a claim about how our evidence was produced actually
	// lives, and where the word is a provenance claim rather than a description of prose.
	//
	// Two residuals, both stated rather than papered over:
	//   · The adverb route stays open — "independently verified by NCC Group" passes. That is fine
	//     while it is TRUE and is review's job when it is not; narrowing it would cost the three
	//     live keys below, which is a worse trade than the hole.
	//   · An honest DISAVOWAL fires. "No independent party has re-run this" is exactly the copy the
	//     `*_not_covered` fields exist for, and it is the likeliest legitimate use of the word here
	//     — so failing is correct only if the answer is deliberate: exempt that key by name, the way
	//     safety-language allows `evidence_safety_not_covered` to quote the phrase it disavows.
	//     There is no allowlist yet because no key needs one, and an empty one cannot be tested for
	//     staleness (DAR-102's polarity — the entry that stops being load-bearing is the hazard).
	//
	// "third-party" is deliberately NOT in the pattern, and that is the same residual read forward:
	// no `evidence_` key uses the phrase today, so it would guard a defect that has not happened,
	// while the phrase's most likely arrival on this surface is a disavowal in a "not covered"
	// field. Widening buys nothing and taxes the copy we most want written.
	const CLAIMS_A_SEPARATE_PARTY = /\bindependent\b/i;

	const evidenceCopy = Object.entries(en as Record<string, unknown>).filter(
		([key, value]) => key.startsWith('evidence_') && typeof value === 'string'
	);

	// "Nothing matched" and "the scan reached nothing" print identically (DAR-102), and this scan is
	// prefix-derived, so a renamed key would silently leave the surface. The floor is far below
	// today's count — it is a liveness check, not a pin on how much evidence copy exists.
	it('reaches the evidence surface at all', () => {
		expect(evidenceCopy.length).toBeGreaterThan(30);
	});

	it('never claims independence for a run we performed', () => {
		const hits = evidenceCopy
			.filter(([, value]) => CLAIMS_A_SEPARATE_PARTY.test(value as string))
			.map(([key]) => key);
		expect(
			hits,
			'"independent" asserts a separate party ran or witnessed it, and none has. Say what the evidence shows instead (cross-platform, cross-prover, attributed). If the sentence DISAVOWS independence, or a third-party run really was commissioned, that is a deliberate exemption: allow the key by name here and say who ran it — never loosen the pattern'
		).toEqual([]);
	});

	// That assertion is "nothing matched", which passes just as happily against a pattern that
	// answers nothing at all (DAR-152). These prove it answers — the retired heading verbatim, plus
	// the two rewordings that would reintroduce the claim without reusing its words.
	it.each([
		['the heading this replaced', 'Independent re-runs'],
		['a reworded claim', 'An independent benchmark of the reference kernel.'],
		['the noun form', 'Independent verification on a second architecture.']
	])('recognises %s', (_label, text) => {
		expect(text).toMatch(CLAIMS_A_SEPARATE_PARTY);
	});

	// The adverb, which is the half that must NOT fire — and it is live copy, not a hypothetical, so
	// a pattern widened to `independent\w*` fails here rather than silently retiring three true
	// statements. Both senses, because they are different claims that happen to share a word.
	it.each([
		['machine-read attribution', m.evidence_cfc_method()],
		['two provers agreeing', m.evidence_theorems_method()],
		['the same claim on the proofs page', m.evidence_proofs_definition_body()]
	])('leaves %s alone', (_label, text) => {
		expect(text).toMatch(/\bindependently\b/i);
		expect(text).not.toMatch(CLAIMS_A_SEPARATE_PARTY);
	});

	// What the key scope costs, asserted rather than claimed — DAR-212's move, and here the
	// over-matched copy is live. `waitlist_evidence_benchmarks` offers "Independent performance
	// benchmarks" as an answer to "What evidence would matter most before your organization could
	// adopt GIDE?", beside "Third-party technical or security review". That is a BUYER naming what
	// they would need from someone else — the opposite end of the conversation from a claim about
	// our own runs — and rewriting it would narrow a stranger's stated requirement into something we
	// already have. It is the reason this rule stops at the evidence surface instead of scanning the
	// catalog, and the reason it must never be moved into SAFETY_LANGUAGE_RULES.
	it('over-matches a buyer requirement outside the evidence surface, hence the key scope', () => {
		expect(
			m.waitlist_evidence_benchmarks(),
			'this copy is correct and must keep firing the pattern — if it stopped, the key scope would look unnecessary'
		).toMatch(CLAIMS_A_SEPARATE_PARTY);
	});
});

// /about's mission section is the one place on the site that states the gap in its absolute form —
// `about_mission_body_1` ends "it can never show that it will never violate a safety constraint" —
// and then answers it. The answer used to open "We CLOSE that gap", which no other surface supports:
// the proofs run over the mathematical model, the floating-point bridge is numerically checked
// rather than proved, the framework assumptions are hypotheses at every proof status, and most
// machine-checked theorems still carry local axioms awaiting discharge.
//
// Nothing failed, and that is the point of filing it here rather than in safety-language.spec.ts:
// DAR-46's rule is that a body claiming provability must name the assumptions and the boundary, and
// this body does — in its SECOND sentence, while the first asserts the gap is gone. Overstating in
// one clause and qualifying in the next is the disclosure axis, not the truth one.
describe('the /about mission paragraph answers the gap without closing it (DAR-212)', () => {
	// Proximity in both word orders, rather than the one retired phrase: an adjective between the
	// article and the noun ("close that verification gap") walks straight past a phrase match, and
	// the claim reads just as well backwards ("that gap is closed"). `gaps?` because the plural is
	// the same claim and `\bgap\b` silently misses it — found by checking this comment's own
	// citation below against the catalog rather than by eye. What bounds it is the SENTENCE
	// (`[^.]`) — 24 is slack inside that, not a tuned detection parameter, and nothing here depends
	// on the number: no sentence in the message pairs the verb with the noun at any distance.
	// (evidence-boundary's window IS tuned, because it reads rendered text, where a line and its
	// neighbour are a concatenation rather than an authored sentence.)
	const CLAIMS_THE_GAP_IS_GONE = /\bclos\w*[^.]{0,24}\bgaps?\b|\bgaps?\b[^.]{0,24}\bclos\w*/i;

	// Deliberately NOT a SAFETY_LANGUAGE_RULES entry, which is the obvious home for a retired
	// phrasing: those rules are shared with `pnpm check:cms`, and "gap" is ordinary vocabulary
	// elsewhere for a hole in the RECORD rather than in the proofs — `evidence_cfc_environment`
	// logs "a gap we log rather than hide" about missing CPU attribution, `evidence_bench_lead`
	// "the gaps we log rather than hide". Measured over both catalogs, this pattern matches
	// neither, and nothing else either; the case that WOULD fire is one word from live copy and
	// has the last test to itself. Key-scoped instead — and a key-scoped assertion fails LOUD here
	// for once: the accessor is generated, so renaming the message is a `pnpm check` error rather
	// than a scan quietly pointed at nothing (DAR-102's polarity, inverted by Paraglide).
	//
	// Base locale only, like every assertion in this file (`overwriteGetLocale` at the top), and
	// the honest version of that is narrower than "safety-language scans both and this doesn't":
	// ITS patterns are English too, so scanning `es.json` buys English text sitting in the Spanish
	// file, never a Spanish violation — and the verbatim-copy route into that file is already a
	// failure in message-catalogs.spec.ts (DAR-53), which is why the file holds no messages at all
	// today. What is genuinely unguarded is a real Spanish rendering of this paragraph, which no
	// English pattern can reach: when `es` ships copy, this rule needs a Spanish twin.
	//
	// Nor does any of it see the PAGE. These read the catalog, so deleting
	// `{m.about_mission_body_2()}` from `+page.svelte` leaves the answer gone and every assertion
	// here green — measured, 1344/1344 unit tests pass with the paragraph removed, and /about's
	// e2e asserts headings and facts, not this body. DAR-117's "only the e2e can see which
	// constant renders", same blind spot.
	// Deliberately left as a residual: that ticket's defect was a one-token swap that still
	// rendered a plausible page, whereas this one is a deleted paragraph, visible in the diff and
	// on the page, and closing it means pinning a fragment of this copy in a second file that
	// cannot import the accessor (DAR-99's rot) to catch an edit nobody makes by accident.
	//
	// The two assertions on the COPY cover different drifts, and the negative one alone would be
	// near-tautological:
	//   · positive — the answer says a boundary REMAINS, so a rewrite asserting the gap is gone has
	//     to delete that clause first, on pain of contradicting itself inside one paragraph;
	//   · negative — the retired claim itself, the way "proven safe" is retired in safety-language,
	//     and the claim this page actually shipped with.
	// Honest residual: "We eliminate that gap" with the boundary sentence left in place passes both.
	// A synonym that also contradicts its own paragraph is review's job; what this stops is the
	// drift that happened, and the quiet deletion of the clause that makes the answer true.
	it('says a boundary remains between the model and a deployed system', () => {
		const answer = m.about_mission_body_2();
		expect(answer, 'the answer no longer scopes the proofs to a model').toMatch(/\bmodel\b/i);
		expect(answer, 'the answer no longer says anything is left outside the proofs').toMatch(
			/\bboundary\b/i
		);
	});

	it('never claims to have closed it', () => {
		expect(m.about_mission_body_2()).not.toMatch(CLAIMS_THE_GAP_IS_GONE);
	});

	// That assertion is "nothing matched", which passes just as happily against a pattern that
	// answers nothing at all (DAR-152) — a typo in the regex would retire the rule silently and
	// stay green forever. These are the cases that prove it answers.
	it.each([
		['the sentence this replaced', 'We close that gap by treating safety as something to prove.'],
		['a reworded return', 'GIDE closes the gap between testing and proof.'],
		['an adjective in the way', 'We close that verification gap for good.'],
		['the claim in reverse', 'That gap is finally closed.'],
		['the plural', 'We have closed the remaining gaps.']
	])('recognises %s', (_label, text) => {
		expect(text).toMatch(CLAIMS_THE_GAP_IS_GONE);
	});

	// The sibling detector in safety-language.ts pairs its positive cases with a "leaves %s alone"
	// table. There is deliberately no such table here, because this pattern is ALLOWED to over-match
	// — and this is what that costs. `evidence_theorems_not_covered` already says of the same
	// boundary that "closing it formally is open, tracked work", which is honest, correct, and one
	// word away from tripping this. Key-scoping is what makes the bluntness free; had it gone into
	// SAFETY_LANGUAGE_RULES it would reach every message and `pnpm check:cms` besides, and the
	// pressure would be to loosen it until it caught nothing (DAR-152). Asserted rather than
	// claimed in prose above, since that reasoning is the whole justification for where this lives.
	it('over-matches honest copy about closing the boundary, hence the key scope', () => {
		expect(
			'Closing that gap formally is open, tracked work.',
			'the pattern became precise — then reconsider whether this belongs in SAFETY_LANGUAGE_RULES, where it would cover every message and CMS prose'
		).toMatch(CLAIMS_THE_GAP_IS_GONE);
	});
});
