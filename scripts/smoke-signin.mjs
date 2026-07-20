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
const signIn = await fetch(`${BASE}/login`, {
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

// 3. Sign out clears the session cookies.
const signOut = await fetch(`${BASE}/admin?/signout`, {
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
const cleared = signOut.headers
	.getSetCookie()
	.some(
		(c) =>
			/session_token=;|session_token=""?;/.test(c) || /session_token=[^;]*;[^]*max-age=0/i.test(c)
	);
if (!cleared) die(`sign-out: session cookie was not cleared (status ${signOut.status})`);
ok('sign-out clears the session');

// 4. The guard bounces an unauthenticated request.
const guard = await fetch(`${BASE}/admin`, { redirect: 'manual' });
if (guard.status !== 303 || guard.headers.get('location') !== '/login') {
	die(
		`/admin (guard): expected 303 → /login, got ${guard.status} → ${guard.headers.get('location')}`
	);
}
ok('/admin redirects to /login when unauthenticated');

console.log('\n✓ sign-in smoke test passed');
