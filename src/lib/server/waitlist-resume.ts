// Waitlist v2 resume state (DAR-75) — what lets a RELOAD land on the step the visitor left off at
// instead of a blank signup form.
//
// THE PROBLEM. The whole flow is driven by SvelteKit remote-form results (`joinWaitlist.result`,
// `submitWaitlistStep*.result`), which are per-response: they vanish on reload or navigation. Before
// this, `/waitlist` had nothing on a fresh GET that could say "this browser already signed up", so a
// visitor who reloaded at step 3 was shown the empty step-1 form again — confusing, though never
// lossy (step 1 persists the row before step 2 ever renders).
//
// WHY A COOKIE, AND NOT THE OTHER TWO OPTIONS THE TICKET LISTED:
//
//   - The continuation token in the URL (`/waitlist?c=…`). REJECTED. It puts a row-authorizing
//     capability into browser history, `Referer` headers and any link the visitor shares. Materially
//     worse than the bug.
//   - Soften the copy so a re-submit of a known address lands on the confirmation. REJECTED: it can't
//     be built without branching on `isNew`, and new vs existing addresses have to stay
//     indistinguishable (waitlist.remote.ts' anti-enumeration note).
//   - A cookie. What this is. It is STRICTLY NECESSARY in the ePrivacy sense — it does nothing but
//     remember where the visitor is in a form they are actively filling in — so it needs disclosure
//     (privacy_collect_technical_body, which used to say the only cookies here are the sign-in ones)
//     but no consent banner. Nothing about it is shared, and it is first-party, httpOnly and expires
//     with the flow.
//
// WHY IT IS SIGNED rather than a plain JSON blob. `stage` is a routing decision, and this codebase
// keeps those server-decided and untamperable (DAR-63's flow claim, for exactly the same reason). The
// MAC also gets us an expiry that the browser can't extend by editing the cookie's own Max-Age, and it
// means a junk cookie is one cheap generic `null` rather than a parse tree of half-trusted fields.
// Tampering with the stage would not actually grant anything — routing is UX, not authorization
// (waitlist-flow.ts) — but "the client cannot choose its own step" is a property worth keeping
// structural instead of arguing about per field.
//
// IT NEVER READS THE DATABASE. Everything the resumed page needs is inside the visitor's own cookie,
// so a GET of /waitlist still makes no query about who is on the list. That is the same reason the
// step endpoints derive `next` from the answers just submitted rather than from stored state.
//
// Pure module apart from the two cookie helpers: callers resolve the secret and pass it in, so the
// mint/verify half is unit-testable without a request (waitlist-resume.spec.ts).
import type { Cookies } from '@sveltejs/kit';
import { mintSignedValue, verifySignedValue, WAITLIST_TOKEN_TTL_SECONDS } from './waitlist-token';
import {
	WAITLIST_AUDIENCES,
	WAITLIST_STEP4_BRANCHES,
	type WaitlistAudience,
	type WaitlistNextStep,
	type WaitlistStep4Branch
} from './waitlist-flow';
import { WAITLIST_CTAS, type WaitlistCta } from '$lib/waitlist-qualification';
import { isWaitlistFlowId, type WaitlistFlowId } from '$lib/waitlist-funnel';
/**
 * The stages a visitor can be resumed INTO — every screen the flow can leave someone on. It is
 * `WaitlistNextStep` (what a step endpoint routes to) plus `step2`, which only step 1 routes to and
 * which therefore isn't in that union; the `satisfies` makes a new next-step slug a compile error
 * here until it is a resumable one.
 *
 * `step1` is deliberately absent: it is the ABSENCE of resume state, not a state to store.
 *
 * This lives server-side with everything else because nothing client-facing needs it — the page
 * compares `data.resume.stage` against literals and the type reaches it through `PageData`. (It was
 * briefly split into a `$lib/waitlist-resume.ts` so a component could import the restart QUERY
 * PARAM; making the restart a POST removed that import and the file with it.)
 */
export const WAITLIST_RESUME_STAGES = [
	'step2',
	'step3',
	'step4a',
	'step4b',
	'done'
] as const satisfies readonly ('step2' | WaitlistNextStep)[];
export type WaitlistResumeStage = (typeof WAITLIST_RESUME_STAGES)[number];

/**
 * Everything a fresh GET of /waitlist needs to put the visitor back where they were.
 *
 * The three decision fields are stored rather than re-derived because the answers behind them are
 * never re-asked: `branch`/`audience` are step 2's (DAR-63's flow claim carries the same pair), and
 * `cta` is whichever terminal step resolved it (DAR-64). The load turns them back into the exact
 * props the page already takes — a continuation token minted from `submissionId`, a flow claim minted
 * from `branch`+`audience` — so the resumed render is indistinguishable from the in-flight one.
 */
export interface WaitlistResumeState {
	stage: WaitlistResumeStage;
	/**
	 * The submission the continuation token should be re-minted for, or null when there is nothing
	 * left to write.
	 *
	 * DELIBERATELY DROPPED AT `done`. Once the flow has ended there is no step left to authorize, so
	 * the cookie stops carrying a handle that could be turned back into a write token. A finished
	 * flow's cookie is inert: it chooses a screen and a link, nothing more.
	 */
	submissionId: string | null;
	branch: WaitlistStep4Branch | null;
	audience: WaitlistAudience | null;
	cta: WaitlistCta | null;
	/**
	 * The funnel flow (DAR-66) this visitor's events were recorded under — the BARE id, like the
	 * column, never the signed handle the hidden fields carry (DAR-86).
	 *
	 * Same shape as `submissionId` above and for a stronger reason than symmetry: the signing core
	 * splits on '.', so a signed value simply cannot be a field inside another signed value. The load
	 * re-mints a handle from this, exactly as it re-mints the continuation token from the row id.
	 *
	 * `''` when there is none — a deploy with no signing secret, or a value we didn't write.
	 */
	flowId: WaitlistFlowId | '';
}

/**
 * The cookie's name — legible on purpose. A visitor who opens devtools after reading the privacy page
 * should be able to match what they were told to what they see.
 */
export const WAITLIST_RESUME_COOKIE = 'waitlist_resume';

// Its own signing domain, so a resume value can never be presented as a continuation token or a flow
// claim (and neither of those as a resume value) even though all three key off BETTER_AUTH_SECRET.
// The `r1` prefix differs from `v1`/`f1` for the same reason.
const RESUME_DOMAIN = 'darcstar:waitlist-resume:v1';
const RESUME_PREFIX = 'r1';
// Joins the payload fields. The signing core reserves '.', so anything else would do; every field is
// either a closed vocabulary, a UUID, or a `decoy_`-prefixed base64url id, none of which can contain
// this. That reserved '.' is also why `flowId` is the bare id here rather than the signed handle the
// hidden fields carry — a signed value cannot be a field inside another signed value.
const RESUME_SEPARATOR = '|';
const RESUME_FIELDS = 6;

/**
 * How long a resume cookie lives. Same as the continuation token it re-mints, because the two cover
 * the same thing — one sitting with the form — and a cookie that outlived the token would resume a
 * visitor into a step whose writes then silently fail.
 *
 * Every step re-issues it, so the window is 24h from the last interaction rather than from signup.
 *
 * KNOWN AND ACCEPTED: a resume mints a FRESH token, so one can outlive the cookie that produced it by
 * up to another TTL (resume at hour 23 → a token good until hour 47, while the cookie dies at 24).
 * Bounding it would mean carrying the original expiry and minting for the remainder, which buys
 * nothing here: since DAR-88 a token addresses the submission its own holder created, so the whole
 * capability is "edit the answers you gave yourself", and DAR-68's per-row budget caps the volume
 * either way. It is the same guarantee a visitor who simply left the tab open already has.
 */
export const WAITLIST_RESUME_TTL_SECONDS = WAITLIST_TOKEN_TTL_SECONDS;

// Junk arriving in a cookie shouldn't buy an HMAC. A real value is ~150 chars.
const RESUME_VALUE_MAX = 512;

const narrow = <T extends string>(vocabulary: readonly T[], value: string): T | null =>
	(vocabulary as readonly string[]).includes(value) ? (value as T) : null;

/** Mint the signed resume value. `now` is unix ms (injectable for tests). */
export function mintWaitlistResume(
	secret: string,
	state: WaitlistResumeState,
	now: number = Date.now()
): Promise<string> {
	const payload = [
		state.stage,
		state.submissionId ?? '',
		state.branch ?? '',
		state.audience ?? '',
		state.cta ?? '',
		state.flowId
	].join(RESUME_SEPARATOR);

	return mintSignedValue(
		secret,
		RESUME_DOMAIN,
		RESUME_PREFIX,
		payload,
		WAITLIST_RESUME_TTL_SECONDS,
		now
	);
}

/**
 * A signed resume value → the state it carries, or null for ANY failure (absent, malformed, expired,
 * tampered, wrong secret, or a value signed for a different purpose).
 *
 * Fails CLOSED on an unrecognized vocabulary member rather than nulling that one field: every
 * component can only have come from us, so an unknown one means the value isn't ours to trust, and
 * showing a blank step-1 form is the safe answer — it is exactly the behaviour this feature replaces.
 */
export async function verifyWaitlistResume(
	secret: string,
	value: unknown,
	now: number = Date.now()
): Promise<WaitlistResumeState | null> {
	if (typeof value !== 'string' || value.length > RESUME_VALUE_MAX) return null;

	const payload = await verifySignedValue(secret, RESUME_DOMAIN, RESUME_PREFIX, value, now);
	if (payload === null) return null;

	const parts = payload.split(RESUME_SEPARATOR);
	if (parts.length !== RESUME_FIELDS) return null;
	const [rawStage, submissionId, rawBranch, rawAudience, rawCta, rawFlowId] = parts;

	const stage = narrow(WAITLIST_RESUME_STAGES, rawStage);
	if (stage === null) return null;

	// The optional three are absent as '' and only then; a non-empty value that isn't in its
	// vocabulary is a value we didn't write.
	const branch = rawBranch === '' ? null : narrow(WAITLIST_STEP4_BRANCHES, rawBranch);
	const audience = rawAudience === '' ? null : narrow(WAITLIST_AUDIENCES, rawAudience);
	const cta = rawCta === '' ? null : narrow(WAITLIST_CTAS, rawCta);
	if (
		(rawBranch !== '' && branch === null) ||
		(rawAudience !== '' && audience === null) ||
		(rawCta !== '' && cta === null)
	) {
		return null;
	}

	return {
		stage,
		submissionId: submissionId === '' ? null : submissionId,
		branch,
		audience,
		cta,
		// Shape-checked on the way out for the same reason the funnel checks it on the way in: the load
		// signs this into the handle it hands the page, and only ids of the column's own shape should
		// ever be signed. A junk one degrades to '' — the load then starts a fresh flow — rather than
		// taking the whole resume down with it.
		flowId: isWaitlistFlowId(rawFlowId) ? rawFlowId : ''
	};
}

/**
 * Mint + write the cookie. A no-op without a secret — the flow still works there, it just can't be
 * resumed, exactly as it can't be enriched.
 *
 * `secure` is left to SvelteKit's default (on, except plain-HTTP localhost) so this works unchanged
 * in `pnpm preview` and the e2e without a dev-only branch.
 *
 * PATH IS '/' RATHER THAN '/waitlist'. Locale lives in the URL (paraglide's `url` strategy), so the
 * page is reachable at both `/waitlist` and `/es/waitlist`; a path-scoped cookie would be silently
 * dropped for a visitor who switched language mid-flow, which is precisely the confusing
 * back-to-square-one this fixes. The value is inert everywhere else on the site and short-lived.
 */
export async function setWaitlistResume(
	cookies: Cookies,
	secret: string | undefined,
	state: WaitlistResumeState
): Promise<void> {
	if (!secret) return;
	cookies.set(WAITLIST_RESUME_COOKIE, await mintWaitlistResume(secret, state), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: WAITLIST_RESUME_TTL_SECONDS
	});
}

/** Drop the cookie (the `?restart` escape hatch). Same attributes, or the browser keeps the old one. */
export function clearWaitlistResume(cookies: Cookies): void {
	cookies.delete(WAITLIST_RESUME_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
}
