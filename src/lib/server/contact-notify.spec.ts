import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAckEmail, buildLeadEmail, sendContactEmails } from './contact-notify';
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

	it('sends from the verified role alias to the monitored inbox', () => {
		const lead = buildLeadEmail(base);
		expect(lead.from).toContain('info@darcstar.tech');
		expect(lead.to).toBe('info@darcstar.tech');
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

describe('buildAckEmail', () => {
	it('addresses the submitter, from the verified domain, replying to info@', () => {
		const ack = buildAckEmail(base, 'en');
		expect(ack.to).toBe('ada@example.com');
		expect(ack.from).toContain('info@darcstar.tech');
		// Unlike the lead, the ack invites a reply back to the monitored inbox.
		expect(ack.replyTo).toBe('info@darcstar.tech');
	});

	it('greets by name and confirms a human will follow up', () => {
		const { subject, text } = buildAckEmail(base, 'en');
		expect(subject).toContain('DarcStar Technologies');
		expect(text).toContain('Hi Ada Lovelace,');
		expect(text).toContain('a member of our team is reading it');
	});

	it('echoes the submitted message and localized interest label back to the sender', () => {
		const { text } = buildAckEmail(base, 'en');
		expect(text).toContain('I would like to discuss a control problem.');
		expect(text).toContain('Robotics & control');
	});

	it('omits the interest line when no interest was chosen', () => {
		const { text } = buildAckEmail({ ...base, interest: null }, 'en');
		expect(text).not.toContain('Area of interest');
	});

	it('carries auto-reply hygiene headers so it never opens a mail loop', () => {
		const { headers } = buildAckEmail(base, 'en');
		expect(headers?.['Auto-Submitted']).toBe('auto-replied');
		expect(headers?.['X-Auto-Response-Suppress']).toBe('All');
	});

	it('escapes HTML-significant characters in the html body but not the text body', () => {
		const { html, text } = buildAckEmail(
			{ ...base, name: 'Ada <script>', message: 'x < y && "quoted"' },
			'en'
		);
		expect(html).not.toContain('<script>');
		expect(html).toContain('Ada &lt;script&gt;');
		expect(html).toContain('x &lt; y &amp;&amp; &quot;quoted&quot;');
		// text/plain stays literal.
		expect(text).toContain('Ada <script>');
		expect(text).toContain('x < y && "quoted"');
	});
});

describe('sendContactEmails', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('POSTs both the lead and the ack to Resend with bearer auth', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
				calls.push({ url: String(url), init: init ?? {} });
				return new Response('{"id":"abc"}', { status: 200 });
			})
		);

		await sendContactEmails('re_test_key', base, 'en');

		expect(calls).toHaveLength(2);
		for (const { url, init } of calls) {
			expect(url).toBe('https://api.resend.com/emails');
			expect(init.method).toBe('POST');
			expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
		}

		const bodies = calls.map((c) => JSON.parse(c.init.body as string));
		const lead = bodies.find((b) => b.to === 'info@darcstar.tech');
		const ack = bodies.find((b) => b.to === 'ada@example.com');

		expect(lead).toBeDefined();
		expect(lead.reply_to).toBe('ada@example.com');

		expect(ack).toBeDefined();
		expect(ack.reply_to).toBe('info@darcstar.tech');
		expect(ack.headers['Auto-Submitted']).toBe('auto-replied');
	});

	it('logs but does not throw when one send fails, and still sends the other', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse((init?.body as string) ?? '{}');
			// Fail only the ack (to the visitor); the lead must still go out.
			return body.to === 'ada@example.com'
				? new Response('bounced', { status: 422 })
				: new Response('{"id":"abc"}', { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(sendContactEmails('re_test_key', base, 'en')).resolves.toBeUndefined();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(errSpy).toHaveBeenCalledTimes(1);
		// Logged by role, not by recipient address (no PII in logs).
		expect(errSpy.mock.calls[0][0]).toContain('ack');
		errSpy.mockRestore();
	});
});
