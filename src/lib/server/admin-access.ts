// Roster-admin gate + the ADMIN_USER_IDS parser. Env-free (takes the raw CSV string, not a DB or
// $app import) so it's shared by the live auth instance (auth.ts), the /admin nav's `isAdmin` flag,
// and the /admin/users route guard — and unit-testable in isolation.

/** Parse the comma-separated ADMIN_USER_IDS allowlist into trimmed, non-empty ids. */
export function parseAdminIds(csv: string | undefined): string[] {
	if (!csv) return [];
	return csv
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * May this signed-in operator manage the roster? True when they carry the `admin` role OR their id
 * is in the ADMIN_USER_IDS env allowlist (the owner bootstrap — an allowlisted owner can never be
 * locked out, even with a null role). Mirrors the Better Auth admin plugin's own `hasPermission`
 * short-circuit (`plugins/admin/has-permission.mjs`), so the UI guard matches what the endpoints
 * enforce. This is a convenience/UX gate only; every admin endpoint re-checks authoritatively.
 */
export function isRosterAdmin(
	user: { id: string; role?: string | null } | null | undefined,
	adminUserIdsCsv: string | undefined
): boolean {
	if (!user) return false;
	if (user.role === 'admin') return true;
	return parseAdminIds(adminUserIdsCsv).includes(user.id);
}

// The three assignable account roles (#95):
//   admin    — super user: manage the roster AND read/manage all messages.
//   operator — staff: read + manage (delete) all messages, but not the roster.
//   user     — end-user: their own account/data only; NO admin access (dormant until #96).
// Better Auth treats `role` as a free string (no access-control config), so this list is the single
// place that constrains what the roster can write. Env-free, so it's unit-tested here.
export const ROLES = ['admin', 'operator', 'user'] as const;
export type Role = (typeof ROLES)[number];

/** Coerce a form-submitted role to a valid Role, falling back when it's missing/unknown. */
export function coerceRole(value: unknown, fallback: Role = 'operator'): Role {
	return (ROLES as readonly string[]).includes(value as string) ? (value as Role) : fallback;
}

/**
 * Better Auth types its admin-API `role` param as the plugin's default union (`'admin' | 'user'`)
 * because we don't register access-control roles — yet it stores whatever string it's given. Cast a
 * validated Role through for `createUser`/`setRole`. Safe: authorization is enforced by our own
 * `isStaff`/`isRosterAdmin` gates plus the plugin's `adminRoles: ['admin']`, not by these labels.
 */
export function apiRole(role: Role): 'admin' | 'user' {
	return role as 'admin' | 'user';
}

/**
 * May this signed-in account reach the gated admin area (`/admin` — the message-triage view)? True
 * for STAFF: an `admin` (via the `admin` role OR the ADMIN_USER_IDS owner bootstrap) or an
 * `operator`. A `user` (end-user) or a role-less account is signed in but NOT staff, so it's bounced.
 * `isRosterAdmin` further narrows to who may manage the roster (`/admin/users`).
 */
export function isStaff(
	user: { id: string; role?: string | null } | null | undefined,
	adminUserIdsCsv: string | undefined
): boolean {
	if (!user) return false;
	if (user.role === 'operator') return true;
	return isRosterAdmin(user, adminUserIdsCsv);
}
