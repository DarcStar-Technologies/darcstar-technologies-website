import { describe, expect, it } from 'vitest';
import { buildUpdatesConfirmEmail, type UpdatesConfirmEmailInput } from './waitlist-updates-notify';
import { m } from '$lib/paraglide/messages.js';

// DAR-139's one new send. What is worth pinning here is not the prose but the two properties the
// message is declared `operational` on the strength of: it carries BOTH links (the confirm and the
// escape hatch), and it contains nothing that would make it an update in its own right.

const INPUT: UpdatesConfirmEmailInput = {
	to: 'ada@example.com',
	confirmUrl: 'https://darcstar.tech/updates/confirm?token=c1.lead.999.mac',
	unsubscribeUrl: 'https://darcstar.tech/updates/unsubscribe?token=u1.lead.999.mac'
};

const build = (over: Partial<typeof INPUT> = {}) =>
	buildUpdatesConfirmEmail({ ...INPUT, ...over }, 'en');

describe('buildUpdatesConfirmEmail', () => {
	it('addresses the person whose consent is being confirmed', () => {
		const mail = build();
		expect(mail.to).toBe('ada@example.com');
		expect(mail.subject).toBe(m.waitlist_updates_confirm_email_subject({}, { locale: 'en' }));
		// The verified role alias, Reply-To a mailbox a human reads — this message invites an answer
		// more than any other in the repo, so a `no-reply@` here would be a defect. Sourced from the
		// shared `EMAIL_FROM`, asserted as the LITERAL, since a test reading the same constant the code
		// reads would agree with whatever that constant became.
		expect(mail.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(mail.replyTo).toBe('info@darcstar.tech');
	});

	// BOTH LINKS, IN BOTH BODIES. The escape hatch is the only control that helps somebody whose
	// address a stranger typed into the form, and a plain-text client that got the confirm link without
	// it would leave that person with no way to stop the asks except replying and waiting for a human.
	it.each(['text', 'html'] as const)(
		'carries the confirm and opt-out links in the %s body',
		(part) => {
			const mail = build();
			expect(mail[part]).toContain(INPUT.confirmUrl);
			expect(mail[part]).toContain(INPUT.unsubscribeUrl);
		}
	);

	// The claim `email-senders.spec.ts` declares this file on. A confirmation request that advertised
	// the product would be the marketing send arriving before its own permission — so the message asks
	// about updates and contains none, which is a property of the copy and therefore has to be asserted
	// on the copy. Deliberately a check for OUR OWN links rather than a word blocklist: prose changes,
	// and "no http(s) URL here is one we did not put there" is the version that survives a rewrite.
	it('links nowhere except the two landing pages', () => {
		const mail = build();
		const urls = [...mail.html.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((match) => match[0]);
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect([INPUT.confirmUrl, INPUT.unsubscribeUrl]).toContain(url);
		}
	});

	// NAMES NOBODY, and it is the one message here where that is a security property rather than a
	// missing nicety. The waitlist name is typed by whoever filled in the form, and this mail exists
	// precisely because that person may not be the recipient — so a greeting would let a stranger choose
	// how we address someone else in their own inbox (DAR-67 met the same hazard on the invitation).
	// Pinned by TYPE as well: `UpdatesConfirmEmailInput` has no name field, so putting one back is a
	// compile error at the call site rather than a quiet reintroduction here.
	it('addresses the recipient generically, naming nobody', () => {
		const mail = build();
		const greeting = m.waitlist_updates_confirm_email_greeting({}, { locale: 'en' });
		expect(mail.text.startsWith(greeting)).toBe(true);
		expect(mail.html).toContain(greeting);
	});

	// Machine-generated, so an out-of-office responder must not answer it and open a loop — the same
	// headers the waitlist ack carries, for the same reason.
	it('marks itself as an auto-reply', () => {
		expect(build().headers).toMatchObject({ 'Auto-Submitted': 'auto-replied' });
	});
});
