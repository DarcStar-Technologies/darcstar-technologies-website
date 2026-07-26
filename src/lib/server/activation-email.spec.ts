import { describe, expect, test } from 'vitest';
import { buildActivationEmail } from './activation-email';
import { buildPasswordResetEmail } from './password-reset-email';

// The activation-email builder is pure, so it's unit-testable without Resend/env. Same coverage as
// its password-reset sibling — wire shape plus the security-relevant escaping — with one extra
// assertion the sibling has no reason to make: that this is genuinely DIFFERENT copy. The link is a
// password-reset token either way, so nothing but the prose stops an invitee being told to "reset"
// a password they have never had.
const URL =
	'https://darcstar.tech/api/auth/reset-password/tok123?callbackURL=%2Freset-password%3Finvite%3D1&x=1';

describe('buildActivationEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = buildActivationEmail({ to: 'lead@example.com', name: 'Ada', url: URL }, 'en');
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.to).toBe('lead@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
		expect(email.subject).toBeTruthy();
	});

	test('both parts carry the activation link; the html escapes the & in the URL', () => {
		const email = buildActivationEmail({ to: 'lead@example.com', name: 'Ada', url: URL }, 'en');
		expect(email.text).toContain(URL);
		expect(email.html).toContain('&amp;x=1');
		expect(email.html).not.toContain('%3D1&x=1');
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = buildActivationEmail(
			{ to: 'lead@example.com', name: '<script>alert(1)</script>', url: URL },
			'en'
		);
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		// text/plain is not markup, so it carries the name verbatim.
		expect(email.text).toContain('<script>alert(1)</script>');
	});

	// The invitee has no old password, so "reset yours" would be both wrong and a phishing tell. The
	// two builders take the same input and mint the same KIND of token — this is the assertion that
	// they didn't quietly converge on one message.
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
	// a wild goose chase, and "an hour" is the specific wrong answer to expect here, since this builder
	// was cloned from the password-reset one.
	test('states the seven-day expiry that the token actually has', () => {
		const email = buildActivationEmail({ to: 'lead@example.com', name: 'Ada', url: URL }, 'en');
		expect(email.text).toMatch(/seven days/i);
		expect(email.text).not.toMatch(/hour/i);
	});
});
