import { describe, expect, it } from 'vitest';
import { mayContactLead } from './waitlist-outreach';

// The rule itself is one comparison, so what is worth pinning here is not the arithmetic but the two
// things a reader could reasonably get wrong about it — both of which are decisions, not details.
//
// Everything that MATTERS about this predicate is in waitlist-store.spec.ts, against a real engine:
// three `WHERE` clauses are the same rule written as SQL and cannot be single-sourced with it, so they
// are held against each other there. This file is the client-safe half's own coverage.
describe('mayContactLead', () => {
	// FAIL-OPEN, and deliberately — the opposite polarity to most gates in this repo, so worth stating
	// rather than leaving to be inferred from `=== null`. Suppression needs a POSITIVE signal: an absent
	// timestamp means nobody has asked us to stop, which is the state of every lead on the list, so
	// reading absence as a request would make the whole waitlist uncontactable the first time this
	// column failed to be selected. Same reasoning as `seo.noIndex` and `darcstarAuthored`.
	it('permits contact until a request is recorded', () => {
		expect(mayContactLead({ doNotContactAt: null })).toBe(true);
	});

	it('refuses once one is', () => {
		expect(mayContactLead({ doNotContactAt: new Date('2026-07-30T12:00:00Z') })).toBe(false);
	});

	// It reads the TIMESTAMP alone. `do_not_contact_by` sits beside it on the row and is provenance —
	// who transcribed the request — which the rule must never branch on: a null recorder is reserved for
	// the mailbox acting for itself, so a predicate that consulted it would read the strongest possible
	// evidence as no evidence at all. Enforced by the type, which has no such field; asserted here
	// because a widened interface would compile.
	it('ignores anything else on the row', () => {
		const flagged = { doNotContactAt: new Date(), doNotContactBy: null, email: 'ada@example.com' };
		expect(mayContactLead(flagged)).toBe(false);
	});
});
