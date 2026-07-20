// End-to-end sign-in smoke test for the admin area (#69).
//
// Drives the REAL endpoints over HTTP (no browser): sign-in → authenticated /admin → sign-out →
// the guard. It's the happy-path counterpart to the guard-redirect e2e (which runs in CI); this
// one writes a session to Turso, so — like the contact happy-path — it's run manually, not in CI.
//
// Better Auth only serves `/api/auth/*` when the request origin matches `ORIGIN` (its
// `isAuthPath` check), so point this at the server on the ORIGIN host+port. With the default
// `.env` (`ORIGIN=http://localhost:5173`) run the built worker there:
//
//   pnpm build && pnpm exec wrangler dev .svelte-kit/cloudflare/_worker.js --port 5173   # one shell
//   ADMIN_EMAIL=you@darcstar.tech ADMIN_PASSWORD='…' pnpm smoke:signin                    # another
//
// Prereqs: a provisioned operator (`pnpm admin:create`) and the `rate_limit` table (`pnpm db:push`).
// Override the target with SMOKE_BASE. Exits non-zero on the first failed assertion.

const BASE = (process.env.SMOKE_BASE || 'http://localhost:5173').replace(/\/$/, '');
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

// 1. Sign in through the same endpoint the login page's client posts to.
const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
	method: 'POST',
	redirect: 'manual',
	headers: { 'content-type': 'application/json', origin },
	body: JSON.stringify({ email, password })
});
if (signIn.status === 404) {
	die(`sign-in got 404 — the server's ORIGIN doesn't match ${origin}. Run it on that host+port.`);
}
if (signIn.status === 429)
	die('sign-in got 429 — rate-limited by a prior run; wait ~1 min and retry.');
if (signIn.status !== 200) die(`sign-in: expected 200, got ${signIn.status} (wrong credentials?)`);

const cookie = signIn.headers
	.getSetCookie()
	.map((c) => c.split(';', 1)[0])
	.join('; ');
if (!/session_token=/.test(cookie)) die('sign-in: 200 but no session cookie was set');
ok('sign-in succeeded (200 + session cookie)');

// 2. The session unlocks the admin area.
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
	headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
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
