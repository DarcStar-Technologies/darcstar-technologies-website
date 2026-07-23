// Pure waitlist helpers — no DB / SvelteKit-request imports, so they're unit-testable in isolation
// (src/lib/server/waitlist.spec.ts). The remote function (src/lib/waitlist.remote.ts) is the only
// caller: it maps `errors` to `invalid(issue.*())` and UPSERTs `cleaned`. The slug lists are the
// client-safe single sources shared with the form's <select>s; `interest` is deliberately free text.
import { WAITLIST_ROLES, type WaitlistRole } from '$lib/waitlist-roles';
import { WAITLIST_COMPANY_SIZES, type WaitlistCompanySize } from '$lib/waitlist-company-sizes';
import {
	WAITLIST_REFERRAL_SOURCES,
	type WaitlistReferralSource
} from '$lib/waitlist-referral-sources';

/** Only email surfaces an inline error — everything else is optional and coerced, never rejected. */
export type WaitlistFieldError = 'email';

export interface CleanedWaitlist {
	email: string; // normalized to lowercase for the unique index / dedupe
	name: string | null;
	company: string | null;
	role: string | null; // validated slug or null
	companySize: string | null; // validated slug or null
	interest: string | null; // FREE TEXT (trimmed) — a growing list, not an enum
	hearAbout: string | null; // validated slug or null
	phone: string | null;
}

export interface WaitlistValidation {
	ok: boolean;
	cleaned: CleanedWaitlist;
	errors: WaitlistFieldError[];
}

// Length bounds — ceilings cap payload abuse; the optional fields have no floors (they may be empty).
const EMAIL_MAX = 254; // RFC 5321 practical maximum
const NAME_MAX = 100;
const COMPANY_MAX = 200;
const INTEREST_MAX = 120; // a short phrase, not an essay — keeps the free-text datalist tidy
const PHONE_MAX = 40;

// Pragmatic email shape check (same as the contact validator): one @, a dot in the domain, no
// whitespace. The real validity test is a successful reply.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isRole = (v: string): v is WaitlistRole => (WAITLIST_ROLES as readonly string[]).includes(v);
const isCompanySize = (v: string): v is WaitlistCompanySize =>
	(WAITLIST_COMPANY_SIZES as readonly string[]).includes(v);
const isReferral = (v: string): v is WaitlistReferralSource =>
	(WAITLIST_REFERRAL_SOURCES as readonly string[]).includes(v);

// Optional free-text field → trimmed + length-capped value, or null when blank.
const optionalText = (v: unknown, max: number): string | null => {
	const s = str(v);
	return s ? s.slice(0, max) : null;
};

/**
 * Validate + normalize a raw waitlist signup. Only `email` can fail (required + shape); a tampered or
 * unknown slug (`role`/`companySize`/`hearAbout`) coerces to null rather than erroring (the selects
 * only offer valid slugs). Email is lowercased so the unique index dedupes case-insensitively.
 */
export function validateWaitlist(data: {
	email?: unknown;
	name?: unknown;
	company?: unknown;
	role?: unknown;
	companySize?: unknown;
	interest?: unknown;
	hearAbout?: unknown;
	phone?: unknown;
}): WaitlistValidation {
	const email = str(data.email).toLowerCase();
	const role = str(data.role);
	const companySize = str(data.companySize);
	const hearAbout = str(data.hearAbout);

	const errors: WaitlistFieldError[] = [];
	if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) errors.push('email');

	return {
		ok: errors.length === 0,
		cleaned: {
			email,
			name: optionalText(data.name, NAME_MAX),
			company: optionalText(data.company, COMPANY_MAX),
			role: isRole(role) ? role : null,
			companySize: isCompanySize(companySize) ? companySize : null,
			interest: optionalText(data.interest, INTEREST_MAX),
			hearAbout: isReferral(hearAbout) ? hearAbout : null,
			phone: optionalText(data.phone, PHONE_MAX)
		},
		errors
	};
}
