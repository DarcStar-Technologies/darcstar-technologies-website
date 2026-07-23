// Waitlist signup — a SvelteKit remote `form` function, spread onto the /waitlist page's <form> so it
// progressively enhances with JS and degrades to a native POST without. Lives in $lib (allowed);
// remote functions may sit anywhere under src EXCEPT $lib/server. Mirrors submitContact
// (contact.remote.ts); the key differences are the email-unique insert-or-enrich (waitlist-store.ts)
// and gating the notification emails on a genuine new signup.
import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { waitlist } from '$lib/server/db/schema';
import { validateWaitlist } from '$lib/server/waitlist';
import { upsertWaitlist } from '$lib/server/waitlist-store';
import { hashIp } from '$lib/server/contact'; // shared truncated-SHA-256 IP hash (same throttle model)
import { sendWaitlistEmails } from '$lib/server/waitlist-notify';
import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime';

// Abuse throttle: at most THROTTLE_MAX signups per hashed IP per window (same as the contact form).
const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MAX = 5;

type WaitlistInput = {
	email: string;
	name: string;
	company: string;
	role: string;
	companySize: string;
	interest: string;
	hearAbout: string;
	phone: string;
	website: string; // honeypot — must stay empty
};

export const joinWaitlist = form<WaitlistInput, { success: true }>(
	'unchecked',
	async (data, issue) => {
		// Grab request-scoped handles FIRST (before any await): on workerd platform.env is only valid
		// during the request and getRequestEvent() must precede the first await. getDb() reads it sync.
		const db = getDb();
		const event = getRequestEvent();
		const ip = event.getClientAddress();
		const userAgent = event.request.headers.get('user-agent') ?? null;
		const platform = event.platform;
		const locale = getLocale();

		// Honeypot: humans never fill the hidden `website` field; bots do. Silently accept (don't persist,
		// don't reveal the trap).
		if (typeof data.website === 'string' && data.website.trim() !== '') {
			return { success: true };
		}

		const { ok, cleaned, errors } = validateWaitlist(data);
		if (!ok) {
			const issues = [];
			if (errors.includes('email')) issues.push(issue.email(m.waitlist_error_email()));
			invalid(...issues); // throws; fields.email.issues() populate client-side
		}

		// Light IP/time throttle (honeypot handles most bots; this caps floods).
		const ipHash = await hashIp(ip);
		const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
		const recent = await db
			.select({ id: waitlist.id })
			.from(waitlist)
			.where(and(eq(waitlist.ipHash, ipHash), gt(waitlist.createdAt, since)));
		if (recent.length >= THROTTLE_MAX) invalid(m.waitlist_error_ratelimit());

		// Insert this email, or enrich the existing row (case-insensitive unique on lower(email)). The
		// same success response either way keeps this from being an email-enumeration oracle.
		// `isNew` is true only on a GENUINE first signup — see waitlist-store.ts.
		const { isNew } = await upsertWaitlist(db, cleaned, ipHash, userAgent);

		// Fire-and-forget notifications (lead + signer ack), same pattern as the contact form: the row
		// is already persisted, so a send failure must NOT fail the signup — log and move on.
		// ctx.waitUntil keeps the Worker alive until the sends resolve after the response; without a key
		// (unconfigured) or ctx (vite dev) we skip. Never awaited.
		//
		// Gated on `isNew`: a re-signup of an existing email must NOT re-mail. This is also the anti-
		// abuse boundary — the row-count throttle above can't see same-email replays (they enrich, not
		// insert, so they add no row), so without this gate the ack would be an unthrottled mailbomb
		// aimed at any address a script submits, plus a flood into info@. New emails still hit the
		// throttle (each is a fresh row), so distinct-email floods stay capped.
		const resendKey = platform?.env?.RESEND_API_KEY;
		if (isNew && resendKey) {
			const send = sendWaitlistEmails(resendKey, cleaned, locale).catch((err) =>
				console.error('waitlist notifications failed', err)
			);
			if (platform?.ctx) platform.ctx.waitUntil(send);
		}

		return { success: true };
	}
);
