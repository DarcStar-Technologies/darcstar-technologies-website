// Server-only helpers shared by the roster pages (/admin/users and /admin/users/[id]): the owner
// allowlist, the self/owner action guard, and a stable APIError → UI-code mapper. Kept out of the
// route files so both pages stay DRY and the guard logic can't drift between them.
import { APIError } from 'better-auth/api';
import { isRosterAdmin, parseAdminIds } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';

// Triage view, not an archive — cap the roster read (pagination is a later follow-up).
export const USERS_LIMIT = 200;

/** Owner ids from the ADMIN_USER_IDS allowlist. Must be called inside a request (reads env). */
export function ownerIds(): string[] {
	return parseAdminIds(readEnv('ADMIN_USER_IDS'));
}

/**
 * Authorize a roster form action and return the acting admin (or `null` → the action must fail 403).
 * SvelteKit does NOT run the layout `load` guards before a form action (only on the re-render
 * after), so each action must gate itself — a bare `locals.user!.id` would otherwise 500 on a
 * no-session POST. The Better Auth admin endpoints re-check authoritatively too; this is the fast,
 * explicit gate, and it lets `guardTarget` trust the returned `id`. Reads env, so call it before the
 * first `await`.
 */
export function rosterAdmin(locals: App.Locals): NonNullable<App.Locals['user']> | null {
	return isRosterAdmin(locals.user, readEnv('ADMIN_USER_IDS')) ? locals.user! : null;
}

/**
 * Guard a destructive/role/session/password action against its target. Blocks acting on your OWN
 * account (`self`) or an ADMIN_USER_IDS owner (`owner`); returns `null` when the action may proceed.
 *
 * This is a UI foot-gun guard, not a hard security boundary: the Better Auth admin endpoints
 * (/api/auth/admin/*) authorize by role and have no owner concept, so a promoted admin could still
 * target an owner by calling the API directly. The load-bearing guarantee — that an owner can't be
 * locked out by role misconfiguration — comes from ADMIN_USER_IDS overriding role checks. The
 * plugin also blocks self-ban/self-remove at the endpoint (YOU_CANNOT_BAN/REMOVE_YOURSELF).
 */
export function guardTarget(targetId: string, currentUserId: string): 'self' | 'owner' | null {
	if (targetId === currentUserId) return 'self';
	if (ownerIds().includes(targetId)) return 'owner';
	return null;
}

/** Map a thrown Better Auth error to a stable code the roster forms render as a localized message. */
export function adminErrorCode(err: unknown): 'email_taken' | 'generic' {
	const msg =
		err instanceof APIError ? err.message : err instanceof Error ? err.message : String(err);
	if (/already exists/i.test(msg)) return 'email_taken';
	return 'generic';
}
