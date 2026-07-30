import { describe, expect, test } from 'vitest';
import { m } from '$lib/paraglide/messages.js';
import { buildPasswordResetEmail } from './password-reset-email';

// The password-reset builder is pure, so it's unit-testable without Resend/env. The LAYOUT it shares
// with its verification + activation siblings is proven once in link-email.spec.ts (escaping, both
// parts, the two hrefs); what is left here is what is true of THIS email alone — that it is wired to
// its own copy family — plus the escaping guarantee, which is asserted per email rather than only
// once, because it must hold for this message however it comes to be built.
const URL =
	'https://darcstar.tech/api/auth/reset-password/tok123?callbackURL=%2Freset-password&x=1';
// Paraglide's url strategy has no locale outside a request, so every message call here names one
// explicitly — exactly as the builders do.
const EN = { locale: 'en' } as const;
const build = (name = 'Ada') =>
	buildPasswordResetEmail({ to: 'user@example.com', name, url: URL }, 'en');

describe('buildPasswordResetEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = build();
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.to).toBe('user@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
	});

	// The three modules are now structurally identical and differ only in the message prefix on eight
	// lines, so one wrong prefix is an easy edit with nothing visible about it. This is the assertion
	// that makes it loud — positively, that this family's copy is here, and negatively, that a
	// sibling's is not.
	//
	// HONEST LIMIT: it can only see the keys whose VALUES differ. `greeting`, `link_fallback` and
	// `signoff` are identical strings in all three families, and `expiry` is identical to the
	// verification one — a mis-wire there is undetectable here and also harmless, being the same text.
	// The `expiry` that genuinely differs is activation's seven days, pinned in its own spec.
	test('wires the reset copy family, not a sibling one', () => {
		const email = build();
		expect(email.subject).toBe(m.reset_email_subject({}, EN));
		expect(email.text).toContain(m.reset_email_body({}, EN));
		expect(email.html).toContain(m.reset_email_button({}, EN));
		expect(email.text).toContain(m.reset_email_ignore({}, EN));

		expect(email.text).not.toContain(m.verify_email_body({}, EN));
		expect(email.text).not.toContain(m.activation_email_body({}, EN));
		expect(email.subject).not.toBe(m.activation_email_subject({}, EN));
	});

	test('states the one-hour expiry the reset token actually has', () => {
		expect(build().text).toMatch(/one hour/i);
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = build('<script>alert(1)</script>');
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		// text/plain is not markup, so it carries the name verbatim.
		expect(email.text).toContain('<script>alert(1)</script>');
	});
});
