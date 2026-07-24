import { isNotNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { waitlist } from '$lib/server/db/schema';
import { mergeInterestSuggestions } from '$lib/waitlist-interest-suggestions';
import { waitlistInterestSeed } from '$lib/waitlist-interest-seed-labels';
import type { PageServerLoad } from './$types';

// The <datalist> for the free-text "interest" field GROWS from real submissions. Privacy guard: only
// surface interests SEVERAL people have entered (>= the floor) so a one-off free-text value — which
// could be junk or contain PII — never leaks into the public form. Capped; the merge (with the
// curated seed) is a pure, unit-tested helper.
const SUGGESTION_MIN_COUNT = 3;
const SUGGESTION_DB_LIMIT = 24;

export const load: PageServerLoad = async () => {
	// The observed set is an enhancement — a DB outage must NOT 500 the lead-capture page, so it
	// degrades to the curated seed alone (same resilience posture as the Sanity list loads). This
	// is also what keeps the page hermetic for the e2e suite, which previews with a placeholder DB.
	let observed: string[] = [];
	try {
		// getDb() reads platform.env via getRequestEvent(), so it must run before the first await.
		const rows = await getDb()
			.select({ interest: waitlist.interest, n: sql<number>`count(*)` })
			.from(waitlist)
			.where(isNotNull(waitlist.interest))
			.groupBy(waitlist.interest)
			.having(sql`count(*) >= ${SUGGESTION_MIN_COUNT}`)
			.orderBy(sql`count(*) desc`)
			.limit(SUGGESTION_DB_LIMIT);
		observed = rows.map((r) => r.interest).filter((s): s is string => Boolean(s));
	} catch (err) {
		console.warn('[waitlist] interest-suggestion query failed, serving the seed only:', err);
	}
	// Resolve the curated seed for the request locale (getLocale is set for this request), then merge.
	const seed = waitlistInterestSeed.map((label) => label());
	return { interestSuggestions: mergeInterestSuggestions(seed, observed) };
};
