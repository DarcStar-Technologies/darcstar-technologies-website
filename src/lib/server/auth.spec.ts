import { describe, expect, test } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailAndPassword } from './auth-options';

// #96 (PR 2): public email/password sign-up is now OPEN — reversing the #48 lockdown — but gated. A
// sign-up creates an UNVERIFIED account and does NOT sign the visitor in; `requireEmailVerification`
// then blocks sign-IN until the email is confirmed. (Cloudflare Turnstile is the other gate, but it's
// an onRequest plugin needing a live siteverify call, so it's out of scope for this hermetic test.)
//
// This can't be exercised through the e2e preview: better-auth's isAuthPath() rejects any request
// whose origin differs from the configured baseURL (ORIGIN), and the preview serves on localhost:4173
// while ORIGIN is the production host — so the endpoint 404s before the auth logic runs. Instead we
// build a throwaway instance from the SAME `emailAndPassword` config the app uses (auth-options.ts),
// backed by an in-memory adapter, so the assertions are hermetic (no DB, no origin, no env) and guard
// the real config values: that sign-up is enabled AND that verification is required to sign in.
function buildAuth(opts: typeof emailAndPassword) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		// Seed the core Better Auth models so a real sign-up has tables to write to.
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: opts
	});
}

const PASSWORD = 'a-long-enough-password';

// A throwaway instance wired with a RECORDING `sendVerificationEmail`. Two reasons: it (a) enables the
// `/send-verification-email` endpoint (better-auth 400s "not enabled" without the callback) so the
// #115 resend affordance can be exercised, and (b) lets a test assert exactly WHICH addresses actually
// triggered a send. `sendOnSignUp` records the sign-up mail too (tests clear the sink before probing).
// Uses the same shared `emailAndPassword` (requireEmailVerification: true) as prod — accounts start
// unverified, which is the regime the resend path serves.
function buildAuthWithVerifySink(sink: { email: string; url: string }[]) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword,
		emailVerification: {
			sendOnSignUp: true,
			sendVerificationEmail: async ({ user, url }) => {
				sink.push({ email: user.email, url });
			}
		}
	});
}

describe('auth public sign-up + email verification (#96 PR2)', () => {
	test('our config allows sign-up, but leaves the account unverified and not signed in', async () => {
		const res = await buildAuth(emailAndPassword).api.signUpEmail({
			body: { name: 'probe', email: 'probe@example.com', password: PASSWORD }
		});
		// Sign-up is no longer locked down (#48 reversed).
		expect(res.user.email).toBe('probe@example.com');
		// requireEmailVerification → the new account starts unverified and gets no session token.
		expect(res.user.emailVerified).toBe(false);
		expect(res.token).toBeNull();
	});

	test('our config blocks sign-in until the email is verified', async () => {
		const auth = buildAuth(emailAndPassword);
		await auth.api.signUpEmail({
			body: { name: 'probe', email: 'verify@example.com', password: PASSWORD }
		});
		// Correct password, but unverified → rejected as EMAIL_NOT_VERIFIED (not a credentials error).
		await expect(
			auth.api.signInEmail({ body: { email: 'verify@example.com', password: PASSWORD } })
		).rejects.toThrow(/verif/i);
	});

	// Anti-enumeration: a sign-up for an ALREADY-registered address must be indistinguishable from a
	// fresh one, or the form leaks which emails have accounts. better-auth gives us this for free —
	// but ONLY because `requireEmailVerification` flips its `shouldReturnGenericDuplicateResponse`
	// path (sign-up.mjs): the duplicate returns a generic 200 with a synthetic, non-persisted user and
	// a null token instead of throwing USER_ALREADY_EXISTS. This test pins that behavior so a
	// better-auth upgrade (or someone flipping the flag) can't silently reopen the enumeration leak —
	// the signup form (signup/+page.server.ts) relies on `res.ok` staying true here. The second
	// attempt also uses a DIFFERENT case + password to prove the dedup is by normalized email alone.
	test('duplicate email returns a generic success, never a "user exists" leak', async () => {
		const auth = buildAuth(emailAndPassword);
		await auth.api.signUpEmail({
			body: { name: 'first', email: 'dup@example.com', password: PASSWORD }
		});
		// Same address, different case + password — must resolve (not throw) and look like a new signup.
		const res = await auth.api.signUpEmail({
			body: { name: 'second', email: 'DUP@example.com', password: 'a-different-password' }
		});
		expect(res.token).toBeNull(); // no session minted
		expect(res.user.email).toBe('dup@example.com'); // normalized (lowercased), synthetic
	});

	// Control: with verification OFF, the SAME duplicate DOES throw "user already exists" — proving the
	// generic response above is bound to requireEmailVerification, not incidental. If this ever stops
	// throwing, the anti-enumeration guarantee is no longer specifically ours to reason about.
	test('control: a duplicate email throws when verification is not required', async () => {
		const auth = buildAuth({
			enabled: true,
			disableSignUp: false,
			requireEmailVerification: false
		});
		await auth.api.signUpEmail({
			body: { name: 'first', email: 'dupctl@example.com', password: PASSWORD }
		});
		await expect(
			auth.api.signUpEmail({
				body: { name: 'second', email: 'dupctl@example.com', password: PASSWORD }
			})
		).rejects.toThrow(/already exists/i);
	});

	// Control: with verification NOT required, the same account can sign in immediately — proving the
	// block above comes from requireEmailVerification, not some unrelated misconfiguration.
	test('control: sign-in succeeds when verification is not required', async () => {
		const auth = buildAuth({
			enabled: true,
			disableSignUp: false,
			requireEmailVerification: false
		});
		await auth.api.signUpEmail({
			body: { name: 'probe', email: 'control@example.com', password: PASSWORD }
		});
		const res = await auth.api.signInEmail({
			body: { email: 'control@example.com', password: PASSWORD }
		});
		expect(res.user.email).toBe('control@example.com');
	});

	// #115 resend-verification affordance. The signup "check your email" panel forwards to
	// POST /send-verification-email, which MUST stay non-enumerating: an attacker probing addresses
	// can't be allowed to tell "unverified account exists" from "no account / already verified". These
	// pin better-auth's guarantee (email-verification.mjs) — identical `{ status: true }` for every
	// case, with a real mail sent ONLY to an existing unverified account — so an upgrade can't regress it.
	test('resend: identical response for absent vs unverified, and mails only the real unverified account', async () => {
		const sent: { email: string; url: string }[] = [];
		const auth = buildAuthWithVerifySink(sent);
		await auth.api.signUpEmail({
			body: { name: 'u', email: 'unverified@example.com', password: PASSWORD }
		});
		sent.length = 0; // drop the sign-up mail so the sink shows only what the resends triggered

		// Probe an address with no account, then the real unverified one (different case, to prove the
		// match is by normalized email). The client-visible response must be indistinguishable.
		const absent = await auth.api.sendVerificationEmail({ body: { email: 'nobody@example.com' } });
		const existing = await auth.api.sendVerificationEmail({
			body: { email: 'UNVERIFIED@example.com' }
		});
		expect(absent.status).toBe(true);
		expect(existing.status).toBe(true);
		// ...but only the existing, unverified account actually received a link.
		expect(sent.map((e) => e.email)).toEqual(['unverified@example.com']);
	});

	test('resend: an already-verified account gets the same generic response but no new mail', async () => {
		const sent: { email: string; url: string }[] = [];
		const auth = buildAuthWithVerifySink(sent);
		await auth.api.signUpEmail({
			body: { name: 'v', email: 'verified@example.com', password: PASSWORD }
		});
		// Verify the account using the token from the sign-up mail, then isolate the resend.
		const token = new URL(sent[0].url).searchParams.get('token');
		expect(token).toBeTruthy();
		await auth.api.verifyEmail({ query: { token: token as string } });
		sent.length = 0;

		const res = await auth.api.sendVerificationEmail({ body: { email: 'verified@example.com' } });
		expect(res.status).toBe(true); // same response as the unverified/absent cases above
		expect(sent).toEqual([]); // ...but nothing re-sent to an already-verified address
	});
});
