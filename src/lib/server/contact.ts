// Pure contact-form helpers (issue #11) — no DB / SvelteKit-request imports, so
// they're unit-testable in isolation (src/lib/server/contact.spec.ts). The remote
// function (src/lib/contact.remote.ts) is the only caller: it maps `errors` to
// per-field `invalid(issue.*())` messages and persists `cleaned`. `INTERESTS` is the
// client-safe shared slug list (single source with the form's <option>s).
import { INTERESTS, type Interest } from '$lib/contact-interests';

/** Fields whose validation surfaces an inline error in the UI. */
export type ContactFieldError = 'name' | 'email' | 'message';

export interface CleanedContact {
	name: string;
	email: string;
	company: string | null;
	interest: string | null;
	message: string;
}

export interface ContactValidation {
	ok: boolean;
	cleaned: CleanedContact;
	errors: ContactFieldError[];
}

// Length bounds — floors are UX minimums; ceilings cap payload abuse.
const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 254; // RFC 5321 practical maximum
const COMPANY_MAX = 200;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

// Pragmatic email shape check (no local-part RFC gymnastics): one @, a dot in the
// domain, no whitespace. The real validity test is a successful reply.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isInterest = (v: string): v is Interest => (INTERESTS as readonly string[]).includes(v);

/**
 * Validate + normalize a raw contact submission. A tampered/unknown `interest`
 * is coerced to null rather than erroring (the select only offers valid slugs);
 * `company` is optional and truncated to a sane ceiling.
 */
export function validateContact(data: {
	name?: unknown;
	email?: unknown;
	company?: unknown;
	interest?: unknown;
	message?: unknown;
}): ContactValidation {
	const name = str(data.name);
	const email = str(data.email);
	const company = str(data.company);
	const interest = str(data.interest);
	const message = str(data.message);

	const errors: ContactFieldError[] = [];
	if (name.length < NAME_MIN || name.length > NAME_MAX) errors.push('name');
	if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) errors.push('email');
	if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) errors.push('message');

	return {
		ok: errors.length === 0,
		cleaned: {
			name,
			email,
			company: company ? company.slice(0, COMPANY_MAX) : null,
			interest: isInterest(interest) ? interest : null,
			message
		},
		errors
	};
}

/**
 * Truncated SHA-256 (hex) of the client IP for the abuse throttle. We never store
 * the raw address — only this opaque hash, enough to rate-limit repeat submitters
 * without retaining PII. Web Crypto (`crypto.subtle`) is available on workerd and
 * in the Node test runner.
 */
export async function hashIp(ip: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 32);
}
