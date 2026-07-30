import { describe, expect, it } from 'vitest';
import {
	appSourcePaths,
	importedNames,
	importsDynamically,
	importsNamespace,
	scriptSourcePaths,
	sourceText
} from '../source-scan';
import { buildContactLeadSignal } from './contact-lead';

// DAR-136. The site now produces personal data onto a queue whose consumer forwards every resolved
// contact to Twenty — a processor `/privacy` names, in a list the page presents as complete. So this
// is `email-senders.spec.ts` for a SECOND egress, and the argument transfers wholesale: the surface
// is DERIVED (every file importing the one function that reaches the queue) and held against a
// hand-written ALLOWLIST, because deleting a scan entry makes a scan blind while deleting an
// allowlist entry makes the rule STRICTER and that file starts failing (DAR-102's polarity).
//
// WHAT IT BUYS, PRECISELY. It cannot stop someone producing a signal they shouldn't. What it removes
// is the SILENT path: a second producer fails closed until it is declared, and declaring it puts the
// two sentences on /privacy that it would falsify in front of a reviewer at the moment of the
// decision. A legal page going quietly stale becomes a line in a diff.
//
// THE TWO CLAIMS, and they are different KINDS of claim, which is why the assertions differ:
//
//   1. "it never receives your message" is STRUCTURAL. The contract has no field a message could
//      travel in, so the guard is over the built signal's keys — the move DAR-65 used to keep dollar
//      figures out of the lead rubric and DAR-66 used to keep answers out of a funnel row.
//   2. "waitlist entries are not sent to it at all" is a claim about ABSENT CODE, exactly like
//      DAR-121's "we don't send marketing". Nothing in the type system keeps it true; the allowlist
//      having one entry is what does, and the waitlist producer is not hypothetical — it is DAR-136's
//      deferred half, so the next person here is the one this exists for.

/** What a producer is FOR, and whose data it moves. `waitlist` is deliberately sayable: a union of
 * only the honest value would make the rule unstatable and this spec would assert that a set of
 * strings equals itself. Being able to write it is what turns the /privacy sentence into a claim a
 * file can contradict. */
type SignalSource = 'website_form' | 'waitlist';

/**
 * Every module that may enqueue a CRM signal, what it sends, and how many sends it makes.
 *
 * `sends` is PER CALL SITE rather than per file, which DAR-102 measured to matter on the sibling
 * rule: a second produce appended INSIDE an already-listed file inherits that file's pass otherwise.
 */
const PRODUCERS: Record<string, { sends: number; source: SignalSource; what: string }> = {
	'src/lib/server/crm/contact-lead.ts': {
		sends: 1,
		source: 'website_form',
		what:
			'one signal per committed contact_submission row — the name, email and company of somebody ' +
			'who chose to write to us, and never the message they wrote'
	}
};

const QUEUE_MODULE = '$lib/server/crm/queue';
const PRODUCE = 'postContactSignal';
const BINDING = 'CRM_INGEST';
const declared = Object.keys(PRODUCERS);

/**
 * THE SURFACE: the worker AND the hand-run scripts, for DAR-121's measured reason — a script is how
 * a one-off backfill would actually get written here, and "push every old submission into the CRM" is
 * precisely the shape of script someone reaches for. A rule that stopped at the deployment boundary
 * would be a rule about the wrong thing.
 */
const surface = () => [...appSourcePaths(), ...scriptSourcePaths()];

/** Files that reach the produce function by name. An alias reports as `postContactSignal`. */
const producers = () =>
	surface().filter((path) => importedNames(path, QUEUE_MODULE).includes(PRODUCE));

describe('the CRM egress is one declared route', () => {
	// A derivation matching nothing — or an allowlist naming files that have moved — makes everything
	// below vacuously true. Pin both against the tree first.
	it('found the surface, and every declared producer is in it', () => {
		for (const required of [...declared, 'src/lib/server/crm/queue.ts']) {
			expect(surface()).toContain(required);
		}
		expect(scriptSourcePaths().some((path) => path.endsWith('.mjs'))).toBe(true);
	});

	// THE RULE. A new producer fails here until someone writes down what it sends.
	it('lets only declared modules import the produce function', () => {
		expect(producers().sort()).toEqual([...declared].sort());
	});

	// THE CLAIM ON /privacy that costs something to break.
	it('produces nothing from the waitlist — which is what the privacy policy says', () => {
		for (const [path, producer] of Object.entries(PRODUCERS)) {
			expect(
				producer.source,
				`${path} is declared as producing WAITLIST signals, and /privacy still says the opposite ` +
					`(privacy_processors_twenty_body: "waitlist entries are not sent to it at all").\n` +
					`\n` +
					`Being declared here is not authorization. DAR-136 deferred the waitlist half ` +
					`deliberately and it needs three things first:\n` +
					`  1. the CRM must own a 'waitlist' source key. Its SOURCES registry is the validator ` +
					`     (isSourceKey), so a signal naming a key it does not have is dead-lettered as ` +
					`     malformed — the consumer deploys FIRST, then this producer;\n` +
					`  2. a decision, on the ticket, about whether a signup reaches the contact graph ` +
					`     before the person is invited. A waitlist address is unverified — anyone can type ` +
					`     somebody else's in — which is the whole premise DAR-139's consent gate rests on;\n` +
					`  3. privacy_processors_twenty_body rewritten and PRIVACY_UPDATED (src/lib/legal.ts) ` +
					`     bumped in the SAME change (docs/legal.md).\n` +
					`\n` +
					`This spec cannot read intent and does not try to. It makes the decision loud.`
			).not.toBe('waitlist');
		}
	});

	// PER CALL SITE, not per file — see the note on `sends`.
	it('holds each producer to the number of sends it declares', () => {
		for (const [path, producer] of Object.entries(PRODUCERS)) {
			const calls = sourceText(path).match(/postContactSignal\(/g)?.length ?? 0;
			expect(
				calls,
				`${path} declares ${producer.sends} produce(s) — "${producer.what}" — but makes ${calls}. ` +
					`A new signal is a new decision: say what it is here.`
			).toBe(producer.sends);
		}
	});

	// An entry that no longer produces anything is dead weight, and dead weight is how an allowlist
	// rots into a list of files nobody checks. The paired assertion `email-senders.spec.ts` makes.
	it('keeps no entry for a module that has stopped producing', () => {
		for (const path of declared) {
			expect(
				importedNames(path, QUEUE_MODULE),
				`${path} is declared as producing "${PRODUCERS[path].what}" but no longer imports ` +
					`${PRODUCE} — drop the entry rather than leaving a declaration nothing backs.`
			).toContain(PRODUCE);
		}
	});

	// The walk-past routes a by-name rule has. Absolute, because no legitimate caller needs either:
	// a namespace import binds every export without naming one, and a dynamic import is not parsed by
	// the static scan at all (`scripts/gen-og.mjs` already lazy-loads that way, so it is this repo's
	// own idiom rather than an exotic dodge).
	it('lets nobody reach the produce function through a namespace or a dynamic import', () => {
		const sideways = surface().filter(
			(path) => importsNamespace(path, QUEUE_MODULE) || importsDynamically(path, QUEUE_MODULE)
		);
		expect(sideways).toEqual([]);
	});

	// AND THE CHOKEPOINT ITSELF. Everything above is only worth asserting if `postContactSignal` is
	// the single route out; a second `platform.env.CRM_INGEST.send(...)` anywhere would make every
	// one of those assertions true and beside the point.
	//
	// THE BINDING NAME is what to scan for, and it is a complete rule rather than a heuristic: the
	// binding is the ONLY handle on the queue that exists in this runtime, so a second route has to
	// name it. That is also why `postContactSignal` resolves it from `platform` instead of accepting a
	// `Queue` — being handed one would let a caller name the binding legitimately, and this assertion
	// would have to be loosened to allow it.
	//
	// `wrangler.jsonc` names it too and is not source, so it is outside this surface; that half is
	// pinned in `preview-worker.spec.ts` (prod declares it, `[env.preview]` deliberately does not).
	it('names the queue binding in exactly one source file', () => {
		const callers = surface().filter((path) => sourceText(path).includes(BINDING));
		expect(callers).toEqual(['src/lib/server/crm/queue.ts']);
	});
});

// The structural half of claim 1. Not a source scan — the signal is a value, so it can simply be
// built and its keys read.
describe('a contact signal cannot carry the message', () => {
	const lead = {
		submissionId: 'row-1',
		createdAt: new Date('2026-07-29T12:00:00.000Z'),
		name: 'Ada Lovelace',
		email: '  Ada@Example.COM ',
		company: 'Analytical Engines'
	};

	// EXHAUSTIVE, not "does not contain message". A `toEqual` on the key set is what makes an added
	// field fail: a `not.toContain('message')` passes just as happily against a signal that grew
	// `interest`, `ipHash` or `userAgent`, none of which the CRM has any use for and all of which sit
	// on the row right beside the fields it does.
	it('emits exactly the declared fields, and nothing else from the row', () => {
		expect(Object.keys(buildContactLeadSignal(lead)).sort()).toEqual([
			'company',
			'createdBy',
			'displayName',
			'email',
			'identities',
			'occurredAt',
			'source',
			'sourceRef',
			'v'
		]);
	});

	it('carries the row id as the idempotency key, and the row time as occurredAt', () => {
		const signal = buildContactLeadSignal(lead);
		expect(signal.sourceRef).toBe('row-1');
		expect(signal.occurredAt).toBe('2026-07-29T12:00:00.000Z');
		expect(signal.source).toBe('website_form');
		expect(signal.v).toBe(1);
	});

	// The consumer matches identities by exact string, so the producer has to normalize the same way
	// the CRM does or the same person arrives twice under two spellings of one address.
	it('normalizes the email in both the identity and its mirror', () => {
		const signal = buildContactLeadSignal(lead);
		expect(signal.identities).toEqual([
			{ platform: 'email', externalId: 'ada@example.com', handle: 'ada@example.com' }
		]);
		expect(signal.email).toBe('ada@example.com');
	});

	// An empty company must be ABSENT, not `''`. The consumer fills empty fields on an existing
	// contact, so a blank string is a value that can overwrite a real company with nothing.
	it('omits company and displayName rather than sending blanks', () => {
		const signal = buildContactLeadSignal({ ...lead, name: '  ', company: '   ' });
		expect('company' in signal).toBe(false);
		expect('displayName' in signal).toBe(false);
	});
});
