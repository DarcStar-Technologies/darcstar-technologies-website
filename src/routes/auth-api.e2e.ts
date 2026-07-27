import { expect, test } from '@playwright/test';

// Better Auth's own endpoints, asserted against the deployed worker (DAR-81).
//
// These could not be written before. Two gates stood in front of them, and both were invisible —
// they turned every request into a plausible-looking failure rather than an error:
//
//   1. `isAuthPath()` mounts /api/auth ONLY for requests whose origin matches the configured
//      baseURL, so under the production ORIGIN the auth API did not exist in a preview and every
//      request 404'd in SvelteKit's router. `pnpm preview` now bakes an ORIGIN derived from the port
//      it binds (scripts/preview-vars.mjs).
//   2. The rate limiter runs before every auth route and stores its counters in the DATABASE, so
//      against this suite's placeholder DATABASE_URL every endpoint answered 500 — GET /ok
//      included — before better-auth decided anything. The preview now runs the limiter in memory.
//
// Both gates fail CLOSED into something that reads like a passing test: a `!res.ok()` assertion is
// satisfied by a 404 and by a 500 just as happily as by the refusal it means to check. That is why
// the tests below assert the exact status and better-auth's own error `code`, and why the mount is
// asserted separately and first — so a regression in the harness reports itself as a broken harness
// rather than as a boundary that still holds.
//
// Still DB-free, and that bounds what belongs here: anything reading or writing a row (sign-in,
// password reset, verification resend) 500s against the placeholder DB and stays in the unit specs
// (auth.spec.ts) or the hand-run smokes (scripts/smoke-invite.ts).

test('the auth API is mounted on this origin', async ({ request }) => {
	// better-auth's liveness endpoint, and the only one that touches neither a row nor a session —
	// which makes it the honest test of "is the API here at all", separate from what it answers.
	const res = await request.get('/api/auth/ok', { failOnStatusCode: false });

	// A 404 means the origin gate closed (the preview's ORIGIN stopped matching the port it serves);
	// a 500 means the rate limiter went looking for the database again. Both are harness failures,
	// and both would otherwise surface as a puzzling failure in the boundary test below.
	expect(res.status(), 'GET /api/auth/ok — 404 = not mounted, 500 = limiter hit the DB').toBe(200);
	expect(await res.json()).toEqual({ ok: true });
});

// DAR-67's boundary, end to end: the acceptance criterion that ticket wanted and could not write.
// `auth.spec.ts` proves the CONFIG refuses public sign-up; this proves the deployed worker does,
// which is a different claim — it is the one that catches the config being right and the wiring
// being wrong.
test('public sign-up is refused by the deployed worker', async ({ request }) => {
	const res = await request.post('/api/auth/sign-up/email', {
		data: { name: 'Probe', email: 'probe@example.com', password: 'a-long-enough-password' },
		failOnStatusCode: false
	});

	// The status and the code together are the point. 400 alone could be a malformed body; the code
	// is better-auth naming the reason, and it is what distinguishes "registration is closed" from
	// every other way this request could fail.
	//
	// A 429 here means the sign-up bucket (3/hour/IP, auth-options.ts) is already spent. The limiter
	// is in memory, so a fresh preview starts empty and one run spends one — but an
	// E2E_REUSE_SERVER=1 loop keeps the counters, so the 4th run within the hour trips it. Restart
	// the preview.
	expect(res.status(), '429 = spent sign-up bucket on a reused preview; restart it').toBe(400);
	expect((await res.json()).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');

	// The fact the old version of this test asserted, kept because it is the one that matters if
	// better-auth ever refuses in a way that still mints something: no session, whatever the status.
	const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
	expect(cookies.some((h) => h.value.includes('session_token'))).toBe(false);
});
