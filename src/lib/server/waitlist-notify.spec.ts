import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildWaitlistLeadEmail,
	buildWaitlistAckEmail,
	sendWaitlistEmails
} from './waitlist-notify';
import type { CleanedWaitlist } from './waitlist';

const full: CleanedWaitlist = {
	email: 'ada@example.com',
	name: 'Ada Lovelace',
	company: 'Acme Robotics',
	role: 'engineering',
	companySize: '11-50',
	interest: 'Autonomous robotics',
	hearAbout: 'search',
	phone: '+1 555 000 1234',
	countryRegion: 'north-america',
	consentUpdates: true
};

const minimal: CleanedWaitlist = {
	email: 'grace@example.com',
	name: null,
	company: null,
	role: null,
	companySize: null,
	interest: null,
	hearAbout: null,
	phone: null,
	countryRegion: null,
	consentUpdates: false
};

describe('buildWaitlistLeadEmail', () => {
	it('addresses info@, replies to the signer, and lists every field with English slug labels', () => {
		const email = buildWaitlistLeadEmail(full);
		expect(email.to).toBe('info@darcstar.tech');
		expect(email.replyTo).toBe('ada@example.com');
		expect(email.subject).toContain('ada@example.com');
		expect(email.text).toContain('Region: North America');
		expect(email.text).toContain('Role: Engineering');
		expect(email.text).toContain('Company size: 11–50');
		expect(email.text).toContain('Heard via: Search');
		expect(email.text).toContain('Interest: Autonomous robotics'); // free text echoed verbatim
		expect(email.text).toContain('Marketing consent: Yes (unverified)');
	});

	it('shows "Not provided" for missing optional fields', () => {
		const email = buildWaitlistLeadEmail(minimal);
		expect(email.text).toContain('Name: Not provided');
		expect(email.text).toContain('Region: Not provided');
		expect(email.text).toContain('Role: Not provided');
		expect(email.text).toContain('Interest: Not provided');
		expect(email.text).toContain('Marketing consent: No');
	});

	it('escapes HTML in dynamic values', () => {
		const email = buildWaitlistLeadEmail({ ...full, interest: '<script>x</script>' });
		expect(email.html).not.toContain('<script>x</script>');
		expect(email.html).toContain('&lt;script&gt;');
	});
});

describe('buildWaitlistAckEmail', () => {
	it('greets by name when provided and marks itself an auto-reply', () => {
		const email = buildWaitlistAckEmail(full);
		expect(email.to).toBe('ada@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
		expect(email.text).toContain('Ada Lovelace');
		expect(email.headers?.['Auto-Submitted']).toBe('auto-replied');
	});

	it('uses a generic greeting when no name was given', () => {
		const email = buildWaitlistAckEmail(minimal);
		expect(email.text).toContain('Hi there');
	});

	it('escapes HTML in the name', () => {
		const email = buildWaitlistAckEmail({ ...full, name: '<b>x</b>' });
		expect(email.html).not.toContain('<b>x</b>');
	});

	// DAR-63 acceptance: the step-4A free text (`deployment_scale`) is stored but must never be
	// surfaced back to the submitter. The structural guarantee is the signature — both builders take
	// CleanedWaitlist, which is step 1 only, and the ack echoes nothing but the name. This pins the
	// behaviour anyway, since a future "here's what you told us" ack would be exactly the regression:
	// smuggle the qualification answers in past the type and assert none of them reach the message.
	it('never echoes qualification answers back to the submitter', () => {
		const smuggled = {
			...full,
			deploymentScale: 'SENTINEL-SCALE',
			pilotInterest: 'SENTINEL-PILOT',
			budgetRange: 'SENTINEL-BUDGET',
			economicImpact: 'SENTINEL-IMPACT'
		} as CleanedWaitlist;

		const email = buildWaitlistAckEmail(smuggled);
		for (const body of [email.subject, email.text, email.html]) {
			expect(body).not.toContain('SENTINEL');
		}
	});

	// DAR-173. The ack is gated on `isNew`, which caps a victim at one of these — but a cap on the
	// COUNT is not evidence about WHO typed the address, so the submitter does not get to pick the
	// language of somebody else's welcome. Pinned by signature, exactly as the confirmation email's
	// missing `name` is: there is nothing to pass. Restoring the parameter leaves this directive
	// unused, which `pnpm check` reports.
	it('accepts no locale from its caller', () => {
		// @ts-expect-error — the second argument is gone on purpose; see buildWaitlistAckEmail.
		const forced = buildWaitlistAckEmail(full, 'es');
		expect(forced.subject).toBe(buildWaitlistAckEmail(full).subject);
	});
});

// The fan-out itself, which had no test on this side — `contact-notify.spec.ts` covered the identical
// hand-written copy and this one was taken on trust. It matters more now that both go through the
// shared `settleSends`: the log prefix used to be a string literal inside this function and is now an
// ARGUMENT, so "the lead survives an ack failure" is covered by the sibling's test while passing the
// wrong label here is a new way to be wrong that nothing would have noticed. A misleading role line is
// only a log defect, but logs are what somebody reads at 3am when the acks start bouncing.
describe('sendWaitlistEmails', () => {
	// Both: unstubAllGlobals for the fetch stub, restoreAllMocks so the console spy returns even if
	// an assertion throws first (a manual mockRestore is skipped on failure).
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('sends the lead even when the ack bounces, and logs that by role', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse((init?.body as string) ?? '{}');
			// Fail only the ack (to the signer); the lead into info@ must still go out.
			return body.to === 'ada@example.com'
				? new Response('bounced', { status: 422 })
				: new Response('{"id":"abc"}', { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(sendWaitlistEmails('re_test_key', full)).resolves.toBeUndefined();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(errSpy).toHaveBeenCalledTimes(1);
		// By role and under THIS fan-out's name — never the recipient address (no PII in logs).
		expect(errSpy.mock.calls[0][0]).toBe('waitlist ack email failed');
	});
});
