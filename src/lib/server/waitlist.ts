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
import {
	WAITLIST_REGIONS,
	WAITLIST_APPLICATIONS,
	WAITLIST_V2_ROLES,
	WAITLIST_TIMELINES,
	WAITLIST_APPROACHES,
	WAITLIST_IMPACTS,
	WAITLIST_BUDGETS,
	WAITLIST_EVIDENCE,
	WAITLIST_EVIDENCE_MAX,
	WAITLIST_PILOT_INTERESTS,
	WAITLIST_CONTACT_METHODS,
	WAITLIST_RESEARCH_PREFERENCES,
	WAITLIST_DEPLOYMENT_SCALE_MAX,
	isPositivePilotInterest
} from '$lib/waitlist-qualification';

/**
 * The required core fields surface an inline error; everything else is optional and coerced, never
 * rejected. v2 step 1 (DAR-60) made `name` required alongside `email` — the v1 form asked for email
 * only. Old rows may still carry a null name (they predate the requirement); the store's keep-existing
 * enrich never erases one, and only NEW writes go through this gate.
 */
export type WaitlistFieldError = 'email' | 'name';

export interface CleanedWaitlist {
	email: string; // normalized to lowercase for the unique index / dedupe
	name: string | null;
	company: string | null;
	role: string | null; // validated slug or null
	companySize: string | null; // validated slug or null
	interest: string | null; // FREE TEXT (trimmed) — a growing list, not an enum
	hearAbout: string | null; // validated slug or null
	phone: string | null;
	countryRegion: string | null; // validated slug or null (v2 step 1)
	consentUpdates: boolean; // marketing opt-in checkbox — absent/unchecked is false, never null
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

/** Unknown/absent → null; a value only survives if the allowlist contains it. */
const slugOrNull = <T extends string>(v: unknown, list: readonly T[]): T | null => {
	const s = str(v);
	return (list as readonly string[]).includes(s) ? (s as T) : null;
};

// HTML checkbox → boolean. A checkbox only appears in the payload when CHECKED (unchecked boxes
// submit nothing), so PRESENCE is the signal: any non-empty string value — the default 'on', or a
// custom `value="yes"`/`"1"` the DAR-60/63 markup might set — reads as true; absent/blank reads as
// false. (Anti-pattern this avoids: hard-coding an allowlist of accepted values, which silently
// drops a real opt-in the moment the form ships a `value=` attribute the server didn't anticipate.)
const checkbox = (v: unknown): boolean => v === true || (typeof v === 'string' && v.length > 0);

// Multi-select → allowlisted, deduped, capped array — or null when nothing valid was selected.
// WIRE CONTRACT for the DAR-62/63 forms: name a checkbox GROUP `foo[]`, not `foo`. SvelteKit's
// form-data conversion THROWS ("Form cannot contain duplicated keys") on a repeated plain name, and
// only the `[]` suffix yields an array (arriving here under key `foo`, always string[] — even a
// single check is `['x']`; zero checks omit the key → undefined, handled below).
const slugArray = <T extends string>(v: unknown, list: readonly T[], max: number): T[] | null => {
	const raw = Array.isArray(v) ? v : [v];
	const seen = new Set<T>();
	for (const item of raw) {
		const slug = slugOrNull(item, list);
		if (slug !== null) seen.add(slug);
		if (seen.size === max) break;
	}
	return seen.size > 0 ? [...seen] : null;
};

/**
 * Validate + normalize a raw waitlist signup. `email` (required + shape) and `name` (required, DAR-60)
 * can fail; a tampered or unknown slug (`role`/`companySize`/`hearAbout`/`countryRegion`) coerces to
 * null rather than erroring (the selects only offer valid slugs). Email is lowercased so the unique
 * index dedupes case-insensitively.
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
	countryRegion?: unknown;
	consentUpdates?: unknown;
}): WaitlistValidation {
	const email = str(data.email).toLowerCase();
	const name = optionalText(data.name, NAME_MAX); // null when blank → the required-name gate below
	const role = str(data.role);
	const companySize = str(data.companySize);
	const hearAbout = str(data.hearAbout);

	const errors: WaitlistFieldError[] = [];
	if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) errors.push('email');
	if (name === null) errors.push('name'); // required since v2 step 1; empty/whitespace fails

	return {
		ok: errors.length === 0,
		cleaned: {
			email,
			name,
			company: optionalText(data.company, COMPANY_MAX),
			role: isRole(role) ? role : null,
			companySize: isCompanySize(companySize) ? companySize : null,
			interest: optionalText(data.interest, INTEREST_MAX),
			hearAbout: isReferral(hearAbout) ? hearAbout : null,
			phone: optionalText(data.phone, PHONE_MAX),
			countryRegion: slugOrNull(data.countryRegion, WAITLIST_REGIONS),
			consentUpdates: checkbox(data.consentUpdates)
		},
		errors
	};
}

// ---------------------------------------------------------------------------------------------
// v2 progressive-flow step validators (DAR-59). Same posture as v1: nothing in these steps is
// required, so nothing errors — a tampered/unknown slug coerces to null (it is REJECTED in the
// sense that it never reaches the DB), arrays are filtered to their allowlist + deduped + capped,
// free text is trimmed + length-capped. Each validator emits EXACTLY its own step's columns; the
// store (waitlist-store.ts applyWaitlistStep) writes only those, so a crafted POST can't reach
// step-1 identity fields through a later step.

export interface CleanedWaitlistStep2 {
	role: string | null;
	primaryApplication: string | null;
	evaluationTimeline: string | null;
}

export function validateWaitlistStep2(data: {
	role?: unknown;
	primaryApplication?: unknown;
	evaluationTimeline?: unknown;
}): CleanedWaitlistStep2 {
	return {
		role: slugOrNull(data.role, WAITLIST_V2_ROLES),
		primaryApplication: slugOrNull(data.primaryApplication, WAITLIST_APPLICATIONS),
		evaluationTimeline: slugOrNull(data.evaluationTimeline, WAITLIST_TIMELINES)
	};
}

export interface CleanedWaitlistStep3 {
	currentApproach: string | null;
	economicImpact: string | null;
	budgetRange: string | null;
	adoptionEvidence: string[] | null;
}

export function validateWaitlistStep3(data: {
	currentApproach?: unknown;
	economicImpact?: unknown;
	budgetRange?: unknown;
	adoptionEvidence?: unknown;
}): CleanedWaitlistStep3 {
	return {
		currentApproach: slugOrNull(data.currentApproach, WAITLIST_APPROACHES),
		economicImpact: slugOrNull(data.economicImpact, WAITLIST_IMPACTS),
		budgetRange: slugOrNull(data.budgetRange, WAITLIST_BUDGETS),
		adoptionEvidence: slugArray(data.adoptionEvidence, WAITLIST_EVIDENCE, WAITLIST_EVIDENCE_MAX)
	};
}

export interface CleanedWaitlistStep4A {
	pilotInterest: string | null;
	deploymentScale: string | null;
	// TRI-STATE, matching schema.ts's contact_permission: null = the question wasn't shown (pilot
	// interest not positive), false = shown and declined, true = granted. The store keep-existings a
	// null so a not-shown submit can't clobber a real prior answer.
	contactPermission: boolean | null;
	contactMethod: string | null;
	phone: string | null;
}

export function validateWaitlistStep4A(data: {
	pilotInterest?: unknown;
	deploymentScale?: unknown;
	contactPermission?: unknown;
	contactMethod?: unknown;
	phone?: unknown;
}): CleanedWaitlistStep4A {
	const pilotInterest = slugOrNull(data.pilotInterest, WAITLIST_PILOT_INTERESTS);
	// The contact block only exists for a positive pilot answer (DAR-63 renders it on the same
	// predicate). Outside that, contact_permission is "never asked" (null) — NOT a decline — so a
	// negative/absent-pilot submit preserves any standing grant instead of silently revoking it.
	return {
		pilotInterest,
		deploymentScale: optionalText(data.deploymentScale, WAITLIST_DEPLOYMENT_SCALE_MAX),
		contactPermission: isPositivePilotInterest(pilotInterest)
			? checkbox(data.contactPermission)
			: null,
		contactMethod: slugOrNull(data.contactMethod, WAITLIST_CONTACT_METHODS),
		phone: optionalText(data.phone, PHONE_MAX)
	};
}

export interface CleanedWaitlistStep4B {
	researchPreferences: string[] | null;
}

export function validateWaitlistStep4B(data: {
	researchPreferences?: unknown;
}): CleanedWaitlistStep4B {
	return {
		// "Uncapped" = the whole list is selectable; the list length is the natural ceiling.
		researchPreferences: slugArray(
			data.researchPreferences,
			WAITLIST_RESEARCH_PREFERENCES,
			WAITLIST_RESEARCH_PREFERENCES.length
		)
	};
}
