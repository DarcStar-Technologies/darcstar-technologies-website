import { describe, expect, it } from 'vitest';
import { buildUpdatesConfirmEmail, type UpdatesConfirmEmailInput } from './waitlist-updates-notify';
import { m } from '$lib/paraglide/messages.js';

// DAR-139's one new send. What is worth pinning here is not the prose but the two properties the
// message is declared `operational` on the strength of: it carries BOTH links (the confirm and the
// escape hatch), and it contains nothing that would make it an update in its own right.

const INPUT: UpdatesConfirmEmailInput = {
	to: 'ada@example.com',
	name: 'Ada Lovelace',
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

	it('greets a signup that gave no name without leaving a gap', () => {
		const mail = build({ name: null });
		expect(mail.text).toContain(
			m.waitlist_updates_confirm_email_greeting_generic({}, { locale: 'en' })
		);
		expect(mail.text).not.toContain('null');
		expect(mail.html).not.toContain('null');
	});

	// The name is submitter-supplied and the form is unauthenticated, so it is the one field an
	// attacker fully controls in a message we send to somebody else's inbox.
	it('escapes the name in the html body', () => {
		const mail = build({ name: '<script>alert(1)</script>' });
		expect(mail.html).not.toContain('<script>');
		expect(mail.html).toContain('&lt;script&gt;');
	});

	// Machine-generated, so an out-of-office responder must not answer it and open a loop — the same
	// headers the waitlist ack carries, for the same reason.
	it('marks itself as an auto-reply', () => {
		expect(build().headers).toMatchObject({ 'Auto-Submitted': 'auto-replied' });
	});
});
