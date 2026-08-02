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
 *
 * `updateDetails` takes only the `owner` half of this, through `mayEditDetails` below.
 */
export function guardTarget(targetId: string, currentUserId: string): 'self' | 'owner' | null {
	if (targetId === currentUserId) return 'self';
	if (ownerIds().includes(targetId)) return 'owner';
	return null;
}

/**
 * May a roster admin edit this target's name and email? Blocks the `owner` case ONLY (DAR-230).
 *
 * Email is the sign-in identity, so re-addressing an account and then running self-service password
 * reset takes it over — and `ADMIN_USER_IDS` is keyed on the user **id**, which an email edit leaves
 * untouched, so the taken-over account is still an owner. That defeats the one guarantee the owner
 * tier gives, which is why the action carries a guard despite writing no destructive field: a
 * foot-gun guard earns its place on the action whose risk does NOT announce itself, and an email edit
 * reads like a typo fix where a role change or a delete does not.
 *
 * The `self` case stays open deliberately — correcting your own sign-in email is a real capability,
 * and it is why the guard was skipped here in the first place. `guardTarget` answers `self` BEFORE
 * `owner`, so an owner editing their own account still passes, and the bootstrap admits an
 * allowlisted owner whatever their role, so that is always available to a signed-in one.
 *
 * What this DOES remove: one admin re-addressing another owner, so an owner who has lost their
 * password AND access to their address can no longer be rescued from this page. That is the point
 * rather than a regression — a benign rescue and the takeover above are the same edit, and nothing at
 * this layer can tell them apart — and the recovery route is the ADMIN_USER_IDS allowlist, which
 * needs infrastructure access rather than an admin session.
 *
 * One rule, two callers: `updateDetails` gates on it and the detail page's `load` derives the flag it
 * renders the form from, so the page can never offer a form whose POST is refused. Reads env (through
 * `guardTarget`), so call it before the first `await`.
 */
export function mayEditDetails(targetId: string, currentUserId: string): boolean {
	return guardTarget(targetId, currentUserId) !== 'owner';
}

/** Map a thrown Better Auth error to a stable code the roster forms render as a localized message. */
export function adminErrorCode(err: unknown): 'email_taken' | 'generic' {
	const msg =
		err instanceof APIError ? err.message : err instanceof Error ? err.message : String(err);
	if (/already exists/i.test(msg)) return 'email_taken';
	return 'generic';
}
