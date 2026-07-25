import { describe, expect, it } from 'vitest';
import { buildWaitlistLeadEmail, buildWaitlistAckEmail } from './waitlist-notify';
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
		const email = buildWaitlistAckEmail(full, 'en');
		expect(email.to).toBe('ada@example.com');
		expect(email.replyTo).toBe('info@darcstar.tech');
		expect(email.text).toContain('Ada Lovelace');
		expect(email.headers?.['Auto-Submitted']).toBe('auto-replied');
	});

	it('uses a generic greeting when no name was given', () => {
		const email = buildWaitlistAckEmail(minimal, 'en');
		expect(email.text).toContain('Hi there');
	});

	it('escapes HTML in the name', () => {
		const email = buildWaitlistAckEmail({ ...full, name: '<b>x</b>' }, 'en');
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

		const email = buildWaitlistAckEmail(smuggled, 'en');
		for (const body of [email.subject, email.text, email.html]) {
			expect(body).not.toContain('SENTINEL');
		}
	});
});
