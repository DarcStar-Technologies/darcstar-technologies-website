// Login audit — the Better Auth `hooks.after` middleware that records every sign-in ATTEMPT
// (success and failure). This module is kept env-free (it imports only `better-auth/api`, no
// `$app/server`, no DB client) so `auth-audit.spec.ts` can exercise the hook against a throwaway
// in-memory Better Auth instance — the same split as `auth-options.ts` vs `auth.ts`. The env-bound
// DB write lives in `login-audit-store.ts` and is INJECTED as `persist`, so tests can pass a spy.
//
// The hook fires for BOTH `auth.handler()` (the /login form action) and a direct
// `POST /api/auth/sign-in/email` — it's the single chokepoint for sign-ins. The ONE case it can't
// see is a rate-limit 429: the router rejects those in `onRequest`, before endpoint dispatch, so the
// login action records those itself (see routes/login/+page.server.ts). Returning `undefined` from
// the hook leaves the response untouched, so the user-facing generic error / anti-enumeration is
// unchanged — the audit is server-side only.
import { createAuthMiddleware, getIp, isAPIError } from 'better-auth/api';

// The Better Auth endpoint path (basePath-relative) for email/password sign-in.
const SIGN_IN_PATH = '/sign-in/email';

export type LoginAuditRecord = {
	/** The attempted email, lowercased/trimmed; null if the request body carried none. */
	email: string | null;
	/** Resolved only on a successful sign-in (from the new session); null on failure. */
	userId: string | null;
	success: boolean;
	/** Coarse machine reason on failure (`invalid_credentials` / `banned` / `rate_limited` / a
	 *  lowercased Better Auth error code); null on success. */
	reason: string | null;
	/** HTTP status of the attempt (401/403/429/200); null if unknown. */
	status: number | null;
	/** Raw client IP (not hashed) — the point is to track a source across attempts. */
	ipAddress: string | null;
	userAgent: string | null;
};

/** Normalize an attempted email for storage/matching; null when absent/blank. */
export function normalizeEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim().toLowerCase();
	return trimmed === '' ? null : trimmed;
}

/** Bucket a Better Auth sign-in error code + status into a coarse, stable `reason`. */
function normalizeReason(code: string | undefined, status: number | null): string {
	const c = (code ?? '').toUpperCase();
	if (c.includes('PASSWORD') || c === 'INVALID_EMAIL_OR_PASSWORD' || status === 401)
		return 'invalid_credentials';
	if (c.includes('BANNED') || status === 403) return 'banned';
	if (status === 429) return 'rate_limited';
	return code ? code.toLowerCase() : 'error';
}

/**
 * Read the outcome of a sign-in from the after-hook's `ctx.context.returned`: on failure it's an
 * `APIError` instance (its `.statusCode` / `.body.code` carry the detail); on success it's the
 * endpoint's plain result object. Pure + exported for unit testing.
 */
export function mapSignInOutcome(returned: unknown): {
	success: boolean;
	status: number | null;
	reason: string | null;
} {
	if (isAPIError(returned)) {
		const status = typeof returned.statusCode === 'number' ? returned.statusCode : null;
		const code = returned.body?.code;
		return { success: false, status, reason: normalizeReason(code, status) };
	}
	return { success: true, status: 200, reason: null };
}

/** Resolve the raw client IP from the hook context, defensively (getIp can throw on odd input). */
function resolveIp(ctx: { headers?: Headers; context: { options: unknown } }): string | null {
	try {
		// getIp walks the configured ip headers (default x-forwarded-for, which the /login action
		// sets to cf-connecting-ip) and falls back to localhost in test/dev.
		return getIp(ctx.headers ?? new Headers(), ctx.context.options as never) ?? null;
	} catch {
		return null;
	}
}

/** Build the audit record from an after-hook context on the sign-in path. */
export function buildAuditRecord(ctx: {
	body?: unknown;
	headers?: Headers;
	context: { returned?: unknown; newSession?: { user?: { id?: string } } | null; options: unknown };
}): LoginAuditRecord {
	const returned = ctx.context?.returned;
	const { success, status, reason } = mapSignInOutcome(returned);
	const email = normalizeEmail((ctx.body as { email?: unknown } | undefined)?.email);
	const userId = success
		? (ctx.context?.newSession?.user?.id ??
			(returned as { user?: { id?: string } } | undefined)?.user?.id ??
			null)
		: null;
	return {
		email,
		userId,
		success,
		reason,
		status,
		ipAddress: resolveIp(ctx),
		userAgent: ctx.headers?.get('user-agent') ?? null
	};
}

/**
 * Emit a single structured server-side line per attempt. Cloudflare Workers Logs captures `console.*`
 * (observability.logs enabled + persist), so this is the "trackable in the log stream" channel that
 * complements the DB row. NEVER logs the password. Failures are `warn` (so they stand out), successes
 * `info`. Workers Logs timestamps each line itself, so no `ts` field here.
 */
export function logLoginAttempt(record: LoginAuditRecord): void {
	const payload = JSON.stringify({
		email: record.email,
		ip: record.ipAddress,
		ua: record.userAgent,
		reason: record.reason,
		status: record.status,
		userId: record.userId
	});
	if (record.success) console.info('[auth] login.success', payload);
	else console.warn('[auth] login.failure', payload);
}

/**
 * The Better Auth `hooks.after` middleware. `persist` is injected (auth.ts passes the env-bound
 * `persistLoginAudit`; tests pass a collector) so this module stays free of `$app/server`/the DB.
 */
export function createLoginAuditHook(persist: (record: LoginAuditRecord) => void) {
	return createAuthMiddleware(async (ctx) => {
		if (ctx.path !== SIGN_IN_PATH) return;
		const record = buildAuditRecord(ctx);
		logLoginAttempt(record);
		persist(record);
		// Return nothing: leave the response (and its anti-enumeration generic error) untouched.
	});
}
