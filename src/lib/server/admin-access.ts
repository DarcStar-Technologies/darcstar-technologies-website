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
