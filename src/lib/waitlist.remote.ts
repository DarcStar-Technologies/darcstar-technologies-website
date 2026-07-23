// Waitlist signup — a SvelteKit remote `form` function, spread onto the /waitlist page's <form> so it
// progressively enhances with JS and degrades to a native POST without. Lives in $lib (allowed);
// remote functions may sit anywhere under src EXCEPT $lib/server. Mirrors submitContact
// (contact.remote.ts); the key difference is the email-unique UPSERT below.
import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { waitlist } from '$lib/server/db/schema';
import { validateWaitlist } from '$lib/server/waitlist';
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

		// UPSERT on the unique (lowercased) email: a re-signup ENRICHES the existing row instead of piling
		// up duplicate leads. `coalesce(excluded.x, x)` = prefer the newly-submitted value, else keep the
		// existing one — so a resubmit updates fields it fills and never erases ones it leaves blank
		// (the validator nulls empty fields). The same success response either way keeps this from being
		// an email-enumeration oracle. `updated_at` is bumped with the same clock as the DB default.
		await db
			.insert(waitlist)
			.values({
				email: cleaned.email,
				name: cleaned.name,
				company: cleaned.company,
				role: cleaned.role,
				companySize: cleaned.companySize,
				interest: cleaned.interest,
				hearAbout: cleaned.hearAbout,
				phone: cleaned.phone,
				ipHash,
				userAgent
			})
			.onConflictDoUpdate({
				target: waitlist.email,
				set: {
					name: sql`coalesce(excluded.name, name)`,
					company: sql`coalesce(excluded.company, company)`,
					role: sql`coalesce(excluded.role, role)`,
					companySize: sql`coalesce(excluded.company_size, company_size)`,
					interest: sql`coalesce(excluded.interest, interest)`,
					hearAbout: sql`coalesce(excluded.hear_about, hear_about)`,
					phone: sql`coalesce(excluded.phone, phone)`,
					updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`
				}
			});

		// Fire-and-forget notifications (lead + signer ack), same pattern as the contact form: the row is
		// already persisted, so a send failure must NOT fail the signup — log and move on. ctx.waitUntil
		// keeps the Worker alive until the sends resolve after the response; without a key (unconfigured)
		// or ctx (vite dev) we skip. Never awaited. Only reached past the honeypot + throttle, so the ack
		// can't be turned into an outbound-spam amplifier beyond the IP throttle.
		const resendKey = platform?.env?.RESEND_API_KEY;
		if (resendKey) {
			const send = sendWaitlistEmails(resendKey, cleaned, locale).catch((err) =>
				console.error('waitlist notifications failed', err)
			);
			if (platform?.ctx) platform.ctx.waitUntil(send);
		}

		return { success: true };
	}
);
