import { describe, expect, test } from 'vitest';
import { buildVerificationEmail } from './verification-email';

// The verification-email builder (#96 PR2) is pure, so it's unit-testable without Resend/env. These
// assertions lock in the wire shape (from/to/replyTo) and — the security-relevant part — that the
// caller-supplied name and the verify URL are HTML-escaped in the html body.
const URL = 'https://darcstar.tech/api/auth/verify-email?token=abc123&callbackURL=%2Faccount';

describe('buildVerificationEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = buildVerificationEmail({ to: 'user@example.com', name: 'Ada', url: URL }, 'en');
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.to).toBe('user@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
		expect(email.subject).toBeTruthy();
	});

	test('both parts carry the verify link; the html escapes the & in the URL', () => {
		const email = buildVerificationEmail({ to: 'user@example.com', name: 'Ada', url: URL }, 'en');
		// text/plain keeps the raw URL (no escaping needed).
		expect(email.text).toContain(URL);
		// text/html escapes & → &amp; inside the href, and never emits the raw ampersand.
		expect(email.html).toContain('token=abc123&amp;callbackURL=%2Faccount');
		expect(email.html).not.toContain('token=abc123&callbackURL');
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = buildVerificationEmail(
			{ to: 'user@example.com', name: '<script>alert(1)</script>', url: URL },
			'en'
		);
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		// text/plain is not markup, so it carries the name verbatim.
		expect(email.text).toContain('<script>alert(1)</script>');
	});
});
