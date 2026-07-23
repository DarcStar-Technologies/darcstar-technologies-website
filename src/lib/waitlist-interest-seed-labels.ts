import { m } from '$lib/paraglide/messages.js';

// Curated seed for the free-text "interest" datalist, as localizable Paraglide accessors. The
// DB-derived half of the datalist can't be localized (it's raw user input), but these curated
// examples can — so they live in messages like the rest of the UI copy. Resolved for the request
// locale in the /waitlist load (server-side getLocale), then merged with observed values via the
// pure `mergeInterestSuggestions`. Call the accessors inside the load (or a `$derived`) so they
// resolve against the active locale.
export const waitlistInterestSeed: (() => string)[] = [
	m.waitlist_interest_seed_robotics,
	m.waitlist_interest_seed_autonomous,
	m.waitlist_interest_seed_markets,
	m.waitlist_interest_seed_formal,
	m.waitlist_interest_seed_safety,
	m.waitlist_interest_seed_partnership
];
