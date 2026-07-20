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

// 5. The flip side of 2b: an anonymous home request skips the session lookup entirely (no cookie)
// and the navbar shows the plain "Sign in" affordance — no signed-in controls.
const homeAnon = await fetch(`${BASE}/`, { redirect: 'manual' });
const homeAnonHtml = await homeAnon.text();
if (homeAnon.status !== 200) die(`/ (anon): expected 200, got ${homeAnon.status}`);
if (homeAnonHtml.includes('action="/logout"')) {
	die('/ (anon): the navbar rendered signed-in controls for an unauthenticated visitor');
}
ok('/ navbar shows only "Sign in" when unauthenticated');

console.log('\n✓ sign-in smoke test passed');
