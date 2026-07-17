import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLeadEmail, sendLeadNotification } from './contact-notify';
import type { CleanedContact } from './contact';

const base: CleanedContact = {
	name: 'Ada Lovelace',
	email: 'ada@example.com',
	company: 'Analytical Engines',
	interest: 'robotics',
	message: 'I would like to discuss a control problem.'
};

describe('buildLeadEmail', () => {
	it('subjects with the name and the human interest label', () => {
		// Loose match so the em-dash separator can vary without breaking the test.
		expect(buildLeadEmail(base).subject).toMatch(
			/^New contact: Ada Lovelace .* Robotics & control$/
		);
	});

	it('replies to the submitter address', () => {
		expect(buildLeadEmail(base).replyTo).toBe('ada@example.com');
	});

	it('includes every field in the text body', () => {
		const { text } = buildLeadEmail(base);
		expect(text).toContain('Name: Ada Lovelace');
		expect(text).toContain('Email: ada@example.com');
		expect(text).toContain('Company: Analytical Engines');
		expect(text).toContain('Interest: Robotics & control');
		expect(text).toContain('I would like to discuss a control problem.');
	});

	it('maps known interest slugs to their labels', () => {
		expect(buildLeadEmail({ ...base, interest: 'formal-methods' }).subject).toContain(
			'Formal methods & verification'
		);
		expect(buildLeadEmail({ ...base, interest: 'markets' }).subject).toContain('Financial markets');
	});

	it('falls back to "Not specified" for a null or unknown interest', () => {
		expect(buildLeadEmail({ ...base, interest: null }).text).toContain('Interest: Not specified');
		expect(buildLeadEmail({ ...base, interest: 'bogus' }).text).toContain(
			'Interest: Not specified'
		);
	});

	it('shows a placeholder when company is absent', () => {
		expect(buildLeadEmail({ ...base, company: null }).text).toContain('Company: Not provided');
	});

	it('escapes HTML-significant characters in the html body but not the text body', () => {
		const { html, text } = buildLeadEmail({
			...base,
			name: 'Ada <script>',
			message: 'x < y && "quoted"'
		});
		// Raw markup never reaches the HTML body...
		expect(html).not.toContain('<script>');
		expect(html).toContain('Ada &lt;script&gt;');
		expect(html).toContain('x &lt; y &amp;&amp; &quot;quoted&quot;');
		// ...but the text/plain part stays literal.
		expect(text).toContain('x < y && "quoted"');
	});
});

describe('sendLeadNotification', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('POSTs the lead to Resend with bearer auth and a JSON payload', async () => {
		let captured: { url: string; init: RequestInit } | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
				captured = { url: String(url), init: init ?? {} };
				return new Response('{"id":"abc"}', { status: 200 });
			})
		);

		await sendLeadNotification('re_test_key', base);

		expect(captured).toBeDefined();
		expect(captured!.url).toBe('https://api.resend.com/emails');
		expect(captured!.init.method).toBe('POST');
		const headers = captured!.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer re_test_key');
		expect(headers['Content-Type']).toBe('application/json');

		const body = JSON.parse(captured!.init.body as string);
		expect(body.to).toBe('info@darcstar.tech');
		expect(body.from).toContain('info@darcstar.tech');
		expect(body.reply_to).toBe('ada@example.com');
		expect(body.subject).toContain('Ada Lovelace');
		expect(body.text).toContain('Email: ada@example.com');
		expect(body.html).toContain('<table');
	});

	it('throws when Resend responds non-2xx', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('rate limited', { status: 429 }))
		);
		await expect(sendLeadNotification('re_test_key', base)).rejects.toThrow(/429/);
	});
});
