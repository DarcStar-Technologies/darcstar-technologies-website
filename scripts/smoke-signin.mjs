// End-to-end sign-in smoke test for the admin area (#69).
//
// Drives the REAL endpoints over HTTP (no browser): sign-in via the /login form action →
// authenticated /admin → sign-out → the guard. It's the happy-path counterpart to the
// guard-redirect e2e (which runs in CI); this one writes a session to Turso, so — like the contact
// happy-path — it's run manually, not in CI.
//
// Sign-in goes through the /login form action, which forwards to Better Auth's handler directly, so
// it works against ANY origin/port (no ORIGIN match needed). Just build + serve, then run:
//
//   pnpm build && pnpm preview                                            # one shell (port 4173)
//   ADMIN_EMAIL=you@darcstar.tech ADMIN_PASSWORD='…' pnpm smoke:signin    # another
//
// Prereqs: a provisioned operator (`pnpm admin:create`) and the `rate_limit` table (`pnpm db:push`).
// Override the target with SMOKE_BASE (default http://localhost:4173). Exits non-zero on the first
// failed assertion.

const BASE = (process.env.SMOKE_BASE || 'http://localhost:4173').replace(/\/$/, '');
const email = process.env.ADMIN_EMAIL?.trim();
const password = process.env.ADMIN_PASSWORD;
const origin = new URL(BASE).origin;

function die(msg) {
	console.error(`✗ ${msg}`);
	process.exit(1);
}
function ok(msg) {
	console.log(`✓ ${msg}`);
}

if (!email || !password) {
	die(
		'ADMIN_EMAIL and ADMIN_PASSWORD are required — e.g. ADMIN_EMAIL=you@… ADMIN_PASSWORD=… pnpm smoke:signin'
	);
}

// 1. Sign in via the /login form action — the no-JS path. `origin` satisfies SvelteKit's CSRF
// check; `accept: text/html` gets the native 303 redirect (a `*/*` accept would instead get the
// enhanced JSON action response).
const signIn = await fetch(`${BASE}/login?/signin`, {
	method: 'POST',
	redirect: 'manual',
	headers: {
		'content-type': 'application/x-www-form-urlencoded',
		accept: 'text/html',
		origin
	},
	body: new URLSearchParams({ email, password })
});
if (signIn.status === 429)
	die('sign-in got 429 — rate-limited by a prior run; wait ~1 min and retry.');
if (signIn.status !== 303 || signIn.headers.get('location') !== '/admin') {
	die(
		`sign-in: expected 303 → /admin, got ${signIn.status} → ${signIn.headers.get('location')} (wrong credentials?)`
	);
}
const cookie = signIn.headers
	.getSetCookie()
	.map((c) => c.split(';', 1)[0])
	.join('; ');
if (!/session_token=/.test(cookie)) die('sign-in: 303 but no session cookie was set');
ok('sign-in via /login succeeded (303 → /admin + session cookie)');

// 2. The forwarded session cookie unlocks the admin area (proves it survived forwarding intact).
const authed = await fetch(`${BASE}/admin`, { headers: { cookie }, redirect: 'manual' });
if (authed.status !== 200) die(`/admin (authed): expected 200, got ${authed.status}`);
if (!(await authed.text()).includes('Contact submissions')) {
	die('/admin (authed): 200 but the submissions view did not render');
}
ok('/admin renders the submissions view when authenticated');

// 2b. The navbar reflects auth state site-wide: a signed-in request to the marketing home page
// resolves the session (cookie-gated lookup in hooks.server.ts → page.data.user) and renders the
// signed-in controls. The Sign-out form's `action="/logout"` is the unambiguous marker — it's
// absent for anonymous visitors, proving the swap is real and not always-on.
const homeAuthed = await fetch(`${BASE}/`, { headers: { cookie }, redirect: 'manual' });
const homeAuthedHtml = await homeAuthed.text();
if (homeAuthed.status !== 200) die(`/ (authed): expected 200, got ${homeAuthed.status}`);
if (!homeAuthedHtml.includes('action="/logout"')) {
	die('/ (authed): the navbar did not render the signed-in Sign-out control');
}
ok('/ navbar shows the signed-in controls when authenticated');

// 2c. Roster management (admin-only). As the owner (an ADMIN_USER_IDS admin), exercise the full
// user lifecycle against a THROWAWAY operator so it cleans up after itself: create → non-admin
// guard → reset password → force logout → disable → enable → delete. Needs the admin-plugin
// columns (`pnpm db:push` after this change).
const rosterView = await fetch(`${BASE}/admin/users`, { headers: { cookie }, redirect: 'manual' });
if (rosterView.status !== 200) die(`/admin/users (owner): expected 200, got ${rosterView.status}`);
if (!(await rosterView.text()).includes('Users')) {
	die('/admin/users (owner): 200 but the roster did not render');
}
ok('/admin/users renders the roster for an admin');

// Owner-authenticated no-JS form POST helper (native 303 or 200 re-render, per the action).
const post = (path, body, jar = cookie) =>
	fetch(`${BASE}${path}`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
			origin,
			cookie: jar
		},
		body: new URLSearchParams(body)
	});

const opEmail = `smoke-op-${Date.now()}@example.com`;
const opPassword = 'smoke-operator-pw-123';

// create → 303 to the new operator's detail page (/admin/users/<id>).
const created = await post('/admin/users?/create', {
	name: 'Smoke Operator',
	email: opEmail,
	password: opPassword,
	// `operator` (staff): the assertions below require /admin access (200) but NOT roster access.
	// A `user` (end-user) would be bounced from /admin entirely — a latent mismatch since the 3-role
	// split (#95/#98) that this section always intended as an operator.
	role: 'operator'
});
const createdLoc = created.headers.get('location') || '';
const opIdMatch = createdLoc.match(/\/admin\/users\/([^/?#]+)/);
if (created.status !== 303 || !opIdMatch) {
	die(`create operator: expected 303 → /admin/users/<id>, got ${created.status} → ${createdLoc}`);
}
const opId = opIdMatch[1];
ok(`created operator ${opEmail} (id ${opId})`);

// Two-role split: the new operator can view submissions but is bounced away from /admin/users.
const opSignIn = await fetch(`${BASE}/login?/signin`, {
	method: 'POST',
	redirect: 'manual',
	headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', origin },
	body: new URLSearchParams({ email: opEmail, password: opPassword })
});
if (opSignIn.status !== 303) die(`operator sign-in: expected 303, got ${opSignIn.status}`);
const opCookie = opSignIn.headers
	.getSetCookie()
	.map((c) => c.split(';', 1)[0])
	.join('; ');
const opRoster = await fetch(`${BASE}/admin/users`, {
	headers: { cookie: opCookie },
	redirect: 'manual'
});
if (opRoster.status !== 303 || opRoster.headers.get('location') !== '/admin') {
	die(
		`operator /admin/users: expected 303 → /admin, got ${opRoster.status} → ${opRoster.headers.get('location')}`
	);
}
const opSubmissions = await fetch(`${BASE}/admin`, {
	headers: { cookie: opCookie },
	redirect: 'manual'
});
if (opSubmissions.status !== 200) {
	die(
		`operator /admin: expected 200 (operators may view submissions), got ${opSubmissions.status}`
	);
}
ok('a plain operator can view submissions but is redirected away from /admin/users');

// reset password → 200 re-render with the confirmation.
const reset = await post(`/admin/users/${opId}?/resetPassword`, {
	newPassword: 'smoke-new-pw-456'
});
if (reset.status !== 200 || !(await reset.text()).includes('Password reset.')) {
	die(`reset password: expected 200 + confirmation, got ${reset.status}`);
}
ok('reset the operator password');

// force logout everywhere → 200 re-render with the confirmation.
const forced = await post(`/admin/users/${opId}?/forceLogout`, {});
if (forced.status !== 200 || !(await forced.text()).includes('All sessions revoked.')) {
	die(`force logout: expected 200 + confirmation, got ${forced.status}`);
}
ok('forced logout across all operator sessions');

// Immediate revocation: the operator's OWN cookie is now dead at /admin on the very next request —
// the hook resolves /admin authoritatively (bypasses the session_data cookie-cache), so a
// force-logout doesn't linger behind the cache's maxAge.
const opAfterLogout = await fetch(`${BASE}/admin`, {
	headers: { cookie: opCookie },
	redirect: 'manual'
});
if (opAfterLogout.status !== 303 || opAfterLogout.headers.get('location') !== '/login') {
	die(
		`force logout not immediate: operator /admin expected 303 → /login, got ${opAfterLogout.status} → ${opAfterLogout.headers.get('location')}`
	);
}
ok('force logout is immediate — the revoked operator is bounced from /admin at once');

// disable → the detail page now offers "Enable account".
const disabled = await post(`/admin/users/${opId}?/disable`, {});
if (disabled.status !== 200 || !(await disabled.text()).includes('Enable account')) {
	die(`disable: expected 200 + enable control, got ${disabled.status}`);
}
ok('disabled the operator account');

// enable → the detail page offers "Disable account" again.
const enabled = await post(`/admin/users/${opId}?/enable`, {});
if (enabled.status !== 200 || !(await enabled.text()).includes('Disable account')) {
	die(`enable: expected 200 + disable control, got ${enabled.status}`);
}
ok('re-enabled the operator account');

// delete (confirm checkbox) → 303 back to the roster; then it's gone.
const deleted = await post(`/admin/users/${opId}?/delete`, { confirm: 'on' });
if (deleted.status !== 303 || deleted.headers.get('location') !== '/admin/users') {
	die(
		`delete: expected 303 → /admin/users, got ${deleted.status} → ${deleted.headers.get('location')}`
	);
}
const afterDelete = await fetch(`${BASE}/admin/users`, { headers: { cookie }, redirect: 'manual' });
if ((await afterDelete.text()).includes(opEmail))
	die('delete: operator still appears in the roster');
ok('deleted the operator and it no longer appears in the roster');

// 3. Sign out via /logout — the navbar's global sign-out target (a native form POST). Clears the
// session cookies and lands on the home page (303 → /). This is the /admin sign-out button's twin
// (same `auth.api.signOut`), but reachable from any page.
const signOut = await fetch(`${BASE}/logout`, {
	method: 'POST',
	redirect: 'manual',
	headers: {
		'content-type': 'application/x-www-form-urlencoded',
		accept: 'text/html',
		origin,
		cookie
	},
	body: ''
});
if (signOut.status !== 303 || signOut.headers.get('location') !== '/') {
	die(`/logout: expected 303 → /, got ${signOut.status} → ${signOut.headers.get('location')}`);
}
const cleared = signOut.headers
	.getSetCookie()
	.some(
		(c) =>
			/session_token=;|session_token=""?;/.test(c) || /session_token=[^;]*;[^]*max-age=0/i.test(c)
	);
if (!cleared) die(`/logout: session cookie was not cleared (status ${signOut.status})`);
ok('/logout clears the session and redirects home');

// 4. The guard bounces an unauthenticated request.
const guard = await fetch(`${BASE}/admin`, { redirect: 'manual' });
if (guard.status !== 303 || guard.headers.get('location') !== '/login') {
	die(
		`/admin (guard): expected 303 → /login, got ${guard.status} → ${guard.headers.get('location')}`
	);
}
ok('/admin redirects to /login when unauthenticated');

// 5. The flip side of 2b: an anonymous home request skips the session lookup entirely (no cookie)
// and the navbar shows the anonymous affordances ("Sign in" + "Sign up", #96) — no signed-in controls.
const homeAnon = await fetch(`${BASE}/`, { redirect: 'manual' });
const homeAnonHtml = await homeAnon.text();
if (homeAnon.status !== 200) die(`/ (anon): expected 200, got ${homeAnon.status}`);
if (homeAnonHtml.includes('action="/logout"')) {
	die('/ (anon): the navbar rendered signed-in controls for an unauthenticated visitor');
}
if (!homeAnonHtml.includes('href="/signup"')) {
	die('/ (anon): the navbar did not render the "Sign up" link for an unauthenticated visitor');
}
ok('/ navbar shows the anonymous "Sign in" + "Sign up" affordances when unauthenticated');

console.log('\n✓ sign-in smoke test passed');
