import { describe, expect, test } from 'vitest';
import { m } from '$lib/paraglide/messages.js';
import { buildActivationEmail } from './activation-email';
import { buildPasswordResetEmail } from './password-reset-email';

// The activation builder is pure, so it's unit-testable without Resend/env. The LAYOUT it shares with
// its reset + verification siblings is proven once in link-email.spec.ts; what is left here is what is
// true of THIS email alone — and it carries more of that than the other two, because it is the one
// whose copy has to work against what the shared token would otherwise imply. The link is a
// password-reset token either way, so nothing but the prose stops an invitee being told to "reset" a
// password they have never had.
const URL =
	'https://darcstar.tech/api/auth/reset-password/tok123?callbackURL=%2Freset-password%3Finvite%3D1&x=1';
// Paraglide's url strategy has no locale outside a request, so every message call here names one
// explicitly — exactly as the builders do.
const EN = { locale: 'en' } as const;
const build = (name = 'Ada') =>
	buildActivationEmail({ to: 'lead@example.com', name, url: URL }, 'en');

describe('buildActivationEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = build();
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.to).toBe('lead@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
	});

	// See password-reset-email.spec.ts for why. This family is the best covered of the three, because
	// FIVE of its eight values differ from its siblings' (expiry included), so a mis-wire has fewer
	// places to hide here than anywhere else.
	test('wires the activation copy family, not a sibling one', () => {
		const email = build();
		expect(email.subject).toBe(m.activation_email_subject({}, EN));
		expect(email.text).toContain(m.activation_email_body({}, EN));
		expect(email.html).toContain(m.activation_email_button({}, EN));
		expect(email.text).toContain(m.activation_email_ignore({}, EN));
		expect(email.text).toContain(m.activation_email_expiry({}, EN));

		expect(email.text).not.toContain(m.reset_email_body({}, EN));
		expect(email.text).not.toContain(m.verify_email_body({}, EN));
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = build('<script>alert(1)</script>');
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		// text/plain is not markup, so it carries the name verbatim.
		expect(email.text).toContain('<script>alert(1)</script>');
	});

	// The invitee has no old password, so "reset yours" would be both wrong and a phishing tell. The
	// two builders take the same input, mint the same KIND of token and now share a template — this is
	// the assertion that they didn't quietly converge on one message.
	test('reads as an invitation, not as a password reset', () => {
		const input = { to: 'lead@example.com', name: 'Ada', url: URL };
		const activation = buildActivationEmail(input, 'en');
		const reset = buildPasswordResetEmail(input, 'en');
		expect(activation.subject).not.toBe(reset.subject);
		expect(activation.text).not.toBe(reset.text);
		expect(activation.subject).toMatch(/invited/i);
		// Never claims the recipient asked for this — they didn't; staff did.
		expect(activation.text).not.toMatch(/we received a request/i);
	});

	// The token's TTL is a week (auth-options.ts ACTIVATION_TOKEN_TTL_SECONDS) — NOT the hour that
	// self-service resets get. Copy that says anything else sends people to a dead link and support to
	// a wild goose chase, and "an hour" is the specific wrong answer to expect here: this builder was
	// cloned from the password-reset one, and now shares a template with it, so `expiry` is the one
	// slot where picking up the sibling's key would be both easy and materially wrong.
	test('states the seven-day expiry that the token actually has', () => {
		const email = build();
		expect(email.text).toMatch(/seven days/i);
		expect(email.text).not.toMatch(/hour/i);
	});
});
