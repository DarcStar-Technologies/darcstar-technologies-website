import { describe, expect, test } from 'vitest';
import { m } from '$lib/paraglide/messages.js';
import { buildVerificationEmail } from './verification-email';

// The verification-email builder (#96 PR2) is pure, so it's unit-testable without Resend/env. The
// LAYOUT it shares with its reset + activation siblings is proven once in link-email.spec.ts; what is
// left here is what is true of THIS email alone — that it is wired to its own copy family — plus the
// escaping guarantee, asserted per email because it must hold for this message however it is built.
const URL = 'https://darcstar.tech/api/auth/verify-email?token=abc123&callbackURL=%2Faccount';
// Paraglide's url strategy has no locale outside a request, so every message call here names one
// explicitly — exactly as the builders do.
const EN = { locale: 'en' } as const;
const build = (name = 'Ada') =>
	buildVerificationEmail({ to: 'user@example.com', name, url: URL }, 'en');

describe('buildVerificationEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = build();
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.to).toBe('user@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
	});

	// See password-reset-email.spec.ts for why this exists and what it cannot see: one wrong message
	// prefix among eight structurally identical lines is invisible without it. Only the keys whose
	// values actually differ between the families are detectable — for this pair that is subject, body,
	// button and ignore, `expiry` being the same "one hour" in both.
	test('wires the verification copy family, not a sibling one', () => {
		const email = build();
		expect(email.subject).toBe(m.verify_email_subject({}, EN));
		expect(email.text).toContain(m.verify_email_body({}, EN));
		expect(email.html).toContain(m.verify_email_button({}, EN));
		expect(email.text).toContain(m.verify_email_ignore({}, EN));

		expect(email.text).not.toContain(m.reset_email_body({}, EN));
		expect(email.text).not.toContain(m.activation_email_body({}, EN));
		// Asking someone to "reset" a password when we mean "confirm your address" is the specific
		// wrong turn here, and the subject is where a recipient would see it.
		expect(email.subject).not.toBe(m.reset_email_subject({}, EN));
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = build('<script>alert(1)</script>');
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		// text/plain is not markup, so it carries the name verbatim.
		expect(email.text).toContain('<script>alert(1)</script>');
	});
});
