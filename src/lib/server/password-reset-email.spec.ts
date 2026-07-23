import { describe, expect, test } from 'vitest';
import { buildPasswordResetEmail } from './password-reset-email';

// The password-reset-email builder is pure, so it's unit-testable without Resend/env. These lock in
// the wire shape (from/to/replyTo) and — the security-relevant part — that the caller-supplied name
// and the reset URL are HTML-escaped in the html body. The URL carries a second query param so there
// is an `&` to prove the href is escaped (better-auth's real link has the token in the path).
const URL =
	'https://darcstar.tech/api/auth/reset-password/tok123?callbackURL=%2Freset-password&x=1';

describe('buildPasswordResetEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = buildPasswordResetEmail({ to: 'user@example.com', name: 'Ada', url: URL }, 'en');
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.to).toBe('user@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
		expect(email.subject).toBeTruthy();
	});

	test('both parts carry the reset link; the html escapes the & in the URL', () => {
		const email = buildPasswordResetEmail({ to: 'user@example.com', name: 'Ada', url: URL }, 'en');
		// text/plain keeps the raw URL (no escaping needed).
		expect(email.text).toContain(URL);
		// text/html escapes & → &amp; inside the href, and never emits the raw ampersand.
		expect(email.html).toContain('callbackURL=%2Freset-password&amp;x=1');
		expect(email.html).not.toContain('callbackURL=%2Freset-password&x=1');
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = buildPasswordResetEmail(
			{ to: 'user@example.com', name: '<script>alert(1)</script>', url: URL },
			'en'
		);
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		// text/plain is not markup, so it carries the name verbatim.
		expect(email.text).toContain('<script>alert(1)</script>');
	});
});
