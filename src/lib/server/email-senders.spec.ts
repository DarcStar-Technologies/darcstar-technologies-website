import { describe, expect, it } from 'vitest';
import {
	appSourcePaths,
	importedNames,
	importsDynamically,
	importsNamespace,
	scriptSourcePaths,
	sourceText
} from './source-scan';

// DAR-121. `/privacy` now makes a claim about mail we do NOT send: the optional product-and-research
// updates the step-1 tick box collects are "not sending those yet", and won't go out until the
// address is confirmed by email and every message carries a login-free unsubscribe. It is true today
// and there is nothing in the type system that keeps it true — a marketing sender is an ordinary new
// module, and the page it falsifies is three directories away in `messages/en.json`.
//
// So this is the tripwire. The surface is DERIVED (every file that imports the one function that
// reaches the mail provider) and held against a hand-written ALLOWLIST — DAR-102's shape, and its
// polarity argument applies unchanged: deleting a scan entry makes a scan blind, silently, while
// deleting an allowlist entry makes the rule STRICTER and that file starts failing. Both directions
// of edit report themselves.
//
// WHAT THIS BUYS, PRECISELY. It cannot read a sender's intent — someone determined to ship marketing
// can type `kind: 'operational'` here and be wrong. What it removes is the SILENT path: a new mailer
// fails closed until it is declared, and declaring it puts the word `marketing` and the failure
// message below in front of a reviewer at the moment the decision is made. A legal page quietly going
// stale becomes a line in a diff.
//
// WHY `postEmail` IS THE RIGHT CHOKEPOINT: it is the only function that talks to the provider, which
// the last assertion here pins rather than assumes.

/**
 * What a sender is FOR. `marketing` is deliberately sayable — a union of the two honest values would
 * make the rule unstatable and this spec would only ever assert that a set of strings equals itself.
 * Being able to write it is what turns "we don't send marketing" into a claim a file can contradict.
 */
type SenderKind = 'operational' | 'internal' | 'marketing';

/**
 * Every module that may POST an email, what it sends, and how many sends it makes.
 *
 * `sends` is what makes the declaration PER CALL SITE rather than per file, and that distinction was
 * measured in DAR-102 on the sibling rule: a new send appended INSIDE an already-listed file inherits
 * that file's pass otherwise. A second `postEmail` call in one of these is a new decision and needs
 * its own line here.
 *
 * `internal` = into our own inbox; nobody outside the company receives it, so consent is not the
 * question. `operational` = to a member of the public, sent because that person asked us for the
 * thing it is about. A file whose sends are MIXED (the two fan-outs each mail info@ AND the person)
 * takes the label of its most exposed send, so the kind is never a weaker claim than the file makes.
 */
const SENDERS: Record<string, { sends: number; kind: SenderKind; what: string }> = {
	'src/lib/server/contact-notify.ts': {
		sends: 2,
		kind: 'operational',
		what: 'the lead into info@, and the auto-reply acknowledgement to whoever wrote in'
	},
	'src/lib/server/waitlist-notify.ts': {
		sends: 2,
		kind: 'operational',
		what: 'the lead into info@, and the signup confirmation to the address that joined'
	},
	'src/lib/server/waitlist-priority-notify.ts': {
		sends: 1,
		kind: 'internal',
		what: 'the Priority-A alert into info@ (DAR-82) — never to the lead'
	},
	'src/lib/server/activation-email.ts': {
		sends: 1,
		kind: 'operational',
		what: 'the early-access invitation, which is the thing joining the waitlist asks for (DAR-67)'
	},
	'src/lib/server/verification-email.ts': {
		sends: 1,
		kind: 'operational',
		what: 'account email verification, triggered by the account holder'
	},
	'src/lib/server/password-reset-email.ts': {
		sends: 1,
		kind: 'operational',
		what: 'the password-reset link, triggered by the account holder'
	}
};

const EMAIL_MODULE = '$lib/server/email';
const SEND = 'postEmail';
const declared = Object.keys(SENDERS);

/**
 * THE SURFACE: the worker AND the hand-run scripts.
 *
 * The scripts half is not thoroughness for its own sake — it is where the hole actually was. Measured:
 * with the surface at `src` alone this file passed 7/7 against a marketing blast planted at
 * `scripts/blast.ts`, and a script is precisely how a one-off send would get written here, two of them
 * (`smoke-invite`, `smoke-waitlist`) having sent real mail since the day they landed. A rule that stops
 * at the deployment boundary would be a rule about the wrong thing: `/privacy` promises the recipient
 * that no update goes out, not that none goes out FROM THE WORKER.
 */
const surface = () => [...appSourcePaths(), ...scriptSourcePaths()];

/** Files that reach the send function by name. An alias (`{ postEmail as send }`) reports as `postEmail`. */
const senders = () => surface().filter((path) => importedNames(path, EMAIL_MODULE).includes(SEND));

// Named for what it PROVES, not for the nicer-sounding "every email is one a person asked for" — the
// internal alerts into info@ are nobody's request, and a headline a declared entry already falsifies
// is the kind a reviewer stops trusting.
describe('this site sends no marketing email', () => {
	// A derivation that matched nothing — or an allowlist naming files that have moved — would make
	// everything below vacuously true. Pin both against the tree first, and include a `scripts/` file
	// and a `.mjs` one: losing either half of the surface is invisible to every other assertion here
	// (they are all "nothing else matched"), which is exactly how the scripts hole went unnoticed.
	it('found the surface, and every declared sender is in it', () => {
		for (const required of [
			...declared,
			'src/lib/server/email.ts',
			// A script that already causes real mail to be sent — the hazard class this rule exists for,
			// so naming it is not incidental coupling the way naming any old script would be.
			'scripts/smoke-invite.ts'
		]) {
			expect(surface()).toContain(required);
		}

		// The `.mjs` half of the scripts reader, asserted by SHAPE rather than by filename: what has to
		// stay true is that both extensions reach the scan, and pinning whichever `.mjs` happens to
		// exist today would fail on an unrelated rename while proving nothing more.
		expect(scriptSourcePaths().some((path) => path.endsWith('.mjs'))).toBe(true);
	});

	// THE RULE. A new mailer fails here until someone writes down what it sends.
	it('lets only declared modules import the send function', () => {
		expect(senders().sort()).toEqual([...declared].sort());
	});

	// THE CLAIM ON /privacy. This is the assertion that costs something to break.
	it('sends nothing marketing — which is what the privacy policy says', () => {
		for (const [path, sender] of Object.entries(SENDERS)) {
			expect(
				sender.kind,
				`${path} is declared a MARKETING sender. /privacy currently promises the opposite ` +
					`(privacy_use_updates_body: "We are not sending those yet"), so shipping this means ` +
					`rewriting that message, bumping PRIVACY_UPDATED (src/lib/legal.ts), and building the ` +
					`gate it describes first: double opt-in, and an unsubscribe honored without a login. ` +
					`consent_updates on its own is an unverified claim from an unauthenticated form and is ` +
					`not permission to send (docs/waitlist.md#consent).`
			).not.toBe('marketing');
		}
	});

	// PER CALL SITE, not per file — see the note on `sends`.
	it('holds each sender to the number of sends it declares', () => {
		for (const [path, sender] of Object.entries(SENDERS)) {
			const calls = sourceText(path).match(/postEmail\(/g)?.length ?? 0;
			expect(
				calls,
				`${path} declares ${sender.sends} send(s) — "${sender.what}" — but makes ${calls}. ` +
					`A new send is a new decision: say what it is here.`
			).toBe(sender.sends);
		}
	});

	// An entry that no longer sends anything is dead weight, and dead weight is how an allowlist rots
	// into a list of files nobody checks. Same paired assertion `waitlist-funnel.spec.ts` makes.
	it('keeps no entry for a module that has stopped sending mail', () => {
		for (const path of declared) {
			expect(
				importedNames(path, EMAIL_MODULE),
				`${path} is declared as sending "${SENDERS[path].what}" but no longer imports ` +
					`${SEND} — drop the entry rather than leaving a declaration nothing backs.`
			).toContain(SEND);
		}
	});

	// THE TWO WALK-PAST ROUTES a by-name rule has, both absolute because no legitimate caller needs
	// either: a namespace import binds every export without naming one, and a DYNAMIC import isn't
	// parsed by the static scan at all. The second is not hypothetical — this repo already lazy-loads
	// that way (`scripts/gen-og.mjs`), and a blast written `const { postEmail } = await import(…)`
	// was measured passing 7/7 here before this assertion existed.
	it('lets nobody reach the mailer through a namespace or a dynamic import', () => {
		const sideways = surface().filter(
			(path) => importsNamespace(path, EMAIL_MODULE) || importsDynamically(path, EMAIL_MODULE)
		);
		expect(sideways).toEqual([]);
	});

	// AND THE CHOKEPOINT ITSELF. `postEmail` is only worth guarding if it is the single route out;
	// a second `fetch` at the provider would make every assertion above true and beside the point.
	//
	// HONEST RESIDUAL: this pins "no second route to THIS provider". A different provider is a new
	// dependency that also has to be named in the policy's processors list — so it surfaces in review,
	// not here.
	it('reaches the mail provider from exactly one file', () => {
		const callers = surface().filter((path) => sourceText(path).includes('api.resend.com'));
		expect(callers).toEqual(['src/lib/server/email.ts']);
	});
});
