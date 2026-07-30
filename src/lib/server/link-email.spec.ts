import { describe, expect, test } from 'vitest';
import { buildLinkEmail, type LinkEmailCopy } from './link-email';

// The layout the password-reset, verification and activation emails share. It used to be three copies
// of one template, each with its own copy of these assertions; the mechanics are proven ONCE here
// against synthetic copy, and each family spec keeps only what is true of that email alone.
//
// Synthetic sentinels rather than real messages on purpose: this file is about the template, so a copy
// change must not be able to fail it, and a sentinel per slot is what lets "the button says the button
// text, not the body text" be asserted at all.
const COPY: LinkEmailCopy = {
	subject: 'SUBJECT-X',
	greeting: ({ name }) => `GREETING-X ${name},`,
	body: 'BODY-X',
	button: 'BUTTON-X',
	linkFallback: 'FALLBACK-X',
	expiry: 'EXPIRY-X',
	ignore: 'IGNORE-X',
	signoff: 'SIGNOFF-X'
};

const URL = 'https://darcstar.tech/api/auth/reset-password/tok123?callbackURL=%2Fx&x=1';
const build = (over: Partial<{ to: string; name: string; url: string }> = {}) =>
	buildLinkEmail(COPY, { to: 'user@example.com', name: 'Ada', url: URL, ...over });

describe('buildLinkEmail', () => {
	test('addresses: from the role alias, reply-to info@, to the recipient', () => {
		const email = build();
		// The literal, not EMAIL_FROM restated — this pins the address mail actually leaves from, and
		// a test that reads the same constant the code reads would agree with any value.
		expect(email.from).toBe('DarcStar Technologies <info@darcstar.tech>');
		expect(email.replyTo).toBe('info@darcstar.tech');
		expect(email.to).toBe('user@example.com');
		expect(email.subject).toBe('SUBJECT-X');
	});

	// Every slot reaches the output, in both parts. A slot silently dropped from the template is the
	// failure this catches — losing `expiry` would leave three emails that never say when the link dies.
	test('renders all eight pieces of copy into both parts', () => {
		const email = build();
		for (const piece of ['GREETING-X', 'BODY-X', 'EXPIRY-X', 'IGNORE-X', 'SIGNOFF-X']) {
			expect(email.text, `text/plain should carry ${piece}`).toContain(piece);
			expect(email.html, `text/html should carry ${piece}`).toContain(piece);
		}
		// The button and its fallback caption are HTML affordances; text/plain carries the bare URL
		// instead, so it deliberately has neither.
		expect(email.html).toContain('BUTTON-X');
		expect(email.html).toContain('FALLBACK-X');
	});

	test('both parts carry the link, and the html links it twice — button and copyable text', () => {
		const email = build();
		expect(email.text).toContain(URL);
		// The button, then the same link repeated as visible text for a client that strips it.
		const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs).toHaveLength(2);
		expect(new Set(hrefs).size).toBe(1);
		expect(hrefs[0]).toBe(
			'https://darcstar.tech/api/auth/reset-password/tok123?callbackURL=%2Fx&amp;x=1'
		);
	});

	// THE SECURITY-RELEVANT PART. Both dynamic values are caller-supplied.
	test('escapes the & in the url so it cannot break out of the href attribute', () => {
		const email = build();
		expect(email.html).toContain('callbackURL=%2Fx&amp;x=1');
		expect(email.html).not.toContain('callbackURL=%2Fx&x=1');
		// text/plain is not markup, so it carries the URL verbatim — anything else would corrupt a
		// link the recipient is told to paste.
		expect(email.text).toContain('callbackURL=%2Fx&x=1');
	});

	test('escapes a hostile display name in the html (no tag injection)', () => {
		const email = build({ name: '<script>alert(1)</script>' });
		expect(email.html).not.toContain('<script>alert(1)</script>');
		expect(email.html).toContain('&lt;script&gt;');
		expect(email.text).toContain('<script>alert(1)</script>');
	});

	// The greeting is the one slot rendered TWICE from one input, and the two renderings differ: the
	// name is escaped for HTML and raw for text. A refactor that resolved it once and reused the string
	// would either double-escape the text part or leave the html unescaped, and only comparing the two
	// renderings catches it.
	test('renders the greeting once per part, escaped only in the html', () => {
		const email = build({ name: 'A & B' });
		expect(email.text).toContain('GREETING-X A & B,');
		expect(email.html).toContain('GREETING-X A &amp; B,');
		expect(email.html).not.toContain('GREETING-X A & B,');
	});

	test('survives an empty name and url without emitting a broken document', () => {
		const email = build({ name: '', url: '' });
		expect(email.html).toContain('</div>');
		expect(email.text).toContain('BODY-X');
	});
});
