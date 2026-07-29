// The one way a SvelteKit form action hands a request to Better Auth's router (DAR-124).
//
// Four call sites used to build this by hand — /login's `signin` and `resend`, /forgot-password and
// /reset-password — each spelling out the client-address header as a literal. That is the drift
// DAR-124 is about: the limiter reads the header named in `auth-options.ts` and these set the header
// named here, and if the two ever disagree nothing fails. Better Auth just resolves no address,
// every form submission collapses into its shared `no-trusted-ip` bucket, and one person's sign-in
// attempts start spending everybody's allowance. There is no build error and no test that would
// notice; the symptom is a support ticket about a lockout months later.
//
// So the header is named ONCE (`CLIENT_IP_HEADER`, beside the `ipAddressHeaders` that reads it) and
// the request is built ONCE, here. `auth-subrequest.spec.ts` holds this to it, and a source scan
// there holds every `auth.handler(` caller to going through this function — because a fifth action
// added later is the realistic way this regresses, and no type can force a call site through a
// helper it simply never imports.
//
// Env-free on purpose (no `$app/server`, no DB), the same split as `auth-options.ts` vs `auth.ts`:
// the spec builds these requests and reads their headers without a request context.
import { CLIENT_IP_HEADER } from './auth-options';

/**
 * Build the sub-request a form action passes to `auth.handler()`, and report the client address it
 * was attributed to.
 *
 * The address is returned as well as set because /login's `signin` needs it a second time: a 429 is
 * the one sign-in outcome Better Auth's after-hook never sees (the router rejects it in `onRequest`,
 * before endpoint dispatch), so that action writes the audit row itself and needs the same address
 * the limiter just keyed on. Returning it here is what keeps those two the same value.
 *
 * DELIBERATELY NOT a cookie/origin-forwarding request. It carries only what Better Auth needs, which
 * is what lets it skip the origin check (that check only validates when a cookie is present) and so
 * work in every environment — including a local preview whose ORIGIN is a derived port.
 */
export function authSubrequest(options: {
	/** Full pathname under Better Auth's basePath, e.g. `/api/auth/sign-in/email`. */
	path: string;
	/** The current request's origin — the sub-request never leaves this Worker. */
	origin: string;
	/** JSON body for the endpoint. */
	body: unknown;
	/** The event's `getClientAddress`, passed rather than imported so this stays env-free. */
	getClientAddress: () => string;
}): { request: Request; clientIp: string | null } {
	const headers = new Headers({ 'content-type': 'application/json' });

	// On Cloudflare this resolves `cf-connecting-ip` (adapter-cloudflare's worker.js), the header the
	// edge refuses to accept from a caller — which is the whole reason a form action is keyed
	// correctly today and the raw API was not. It can return null, or throw on another adapter, when
	// no address is resolvable; then the header is omitted and Better Auth resolves no address rather
	// than a wrong one.
	let clientIp: string | null = null;
	try {
		// `|| null` rather than the raw return: an adapter that answers with an empty string means the
		// same thing as one that answers with nothing, and the difference used to survive into
		// `login_audit.ip_address` as `''` — a row that reads like an address was recorded when none
		// was. Caught by the spec, not by review.
		clientIp = options.getClientAddress() || null;
	} catch {
		// adapter couldn't resolve an address
	}
	if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);

	// Setting `cf-connecting-ip` on an outbound request would be refused at Cloudflare's edge (403,
	// error 1000 — measured). This one never goes out: `auth.handler()` is an in-process call, so the
	// header is read by Better Auth in the same isolate that wrote it.
	return {
		request: new Request(new URL(options.path, options.origin), {
			method: 'POST',
			headers,
			body: JSON.stringify(options.body)
		}),
		clientIp
	};
}
