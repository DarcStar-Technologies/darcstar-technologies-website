// Contact-form submission (issue #11) — a SvelteKit remote `form` function, so it
// works as a progressively-enhanced POST and is called via `<form {...submitContact}>`
// in ContactDialog.svelte. Lives in $lib (allowed) — remote functions may sit
// anywhere under src EXCEPT $lib/server.
import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';
import { hashIp, validateContact } from '$lib/server/contact';
import { m } from '$lib/paraglide/messages.js';

// Abuse throttle: at most THROTTLE_MAX submissions per hashed IP per window.
const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MAX = 5;

type ContactInput = {
	name: string;
	email: string;
	company: string;
	interest: string;
	message: string;
	website: string; // honeypot — must stay empty
};

export const submitContact = form<ContactInput, { success: true }>(
	'unchecked',
	async (data, issue) => {
		// Grab request-scoped handles FIRST (before any await): on workerd
		// `platform.env` is only valid during the request and getRequestEvent()
		// must be called before the first await. getDb() reads it synchronously.
		const db = getDb();
		const event = getRequestEvent();
		const ip = event.getClientAddress();
		const userAgent = event.request.headers.get('user-agent') ?? null;

		// Honeypot: humans never fill the hidden `website` field; bots do. Silently
		// accept (don't persist, don't reveal the trap).
		if (typeof data.website === 'string' && data.website.trim() !== '') {
			return { success: true };
		}

		const { ok, cleaned, errors } = validateContact(data);
		if (!ok) {
			const issues = [];
			if (errors.includes('name')) issues.push(issue.name(m.contact_error_name()));
			if (errors.includes('email')) issues.push(issue.email(m.contact_error_email()));
			if (errors.includes('message')) issues.push(issue.message(m.contact_error_message()));
			invalid(...issues); // throws; fields.*.issues() populate client-side
		}

		// Light IP/time throttle (honeypot handles most bots; this caps floods).
		const ipHash = await hashIp(ip);
		const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
		const recent = await db
			.select({ id: contactSubmission.id })
			.from(contactSubmission)
			.where(and(eq(contactSubmission.ipHash, ipHash), gt(contactSubmission.createdAt, since)));
		if (recent.length >= THROTTLE_MAX) invalid(m.contact_error_ratelimit());

		await db.insert(contactSubmission).values({
			name: cleaned.name,
			email: cleaned.email,
			company: cleaned.company,
			interest: cleaned.interest,
			message: cleaned.message,
			ipHash,
			userAgent
		});

		return { success: true };
	}
);
