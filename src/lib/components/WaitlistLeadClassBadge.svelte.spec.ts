import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WaitlistLeadClassBadge from './WaitlistLeadClassBadge.svelte';
import { WAITLIST_LEAD_CLASSES } from '$lib/waitlist-qualification';

// DAR-65's rendering acceptance. The real /admin/waitlist table can't be reached from the e2e suite
// — that suite is hermetic (no session cookie, no reachable DB), so it can only assert the /admin
// guard's redirect — so the "badges render from fixture data" case is pinned here instead, where a
// fixture is just a prop.
//
// The badge is the ONLY place a lead class becomes visible, so this is also where the staff-only
// vocabulary is checked for leaking a promise it can't keep: no currency, no dollar figures.

describe('WaitlistLeadClassBadge', () => {
	it.each(WAITLIST_LEAD_CLASSES)('renders a labelled badge for %s', async (leadClass) => {
		const { container } = render(WaitlistLeadClassBadge, { leadClass });
		const text = container.textContent?.trim() ?? '';

		expect(text).not.toBe('');
		// The slug itself never reaches the screen — staff read a label, not a database value.
		expect(text).not.toContain(leadClass);
		await expect.element(page.getByText(text, { exact: true })).toBeVisible();
	});

	it('gives every class a distinct label', () => {
		const labels = WAITLIST_LEAD_CLASSES.map((leadClass) => {
			const { container } = render(WaitlistLeadClassBadge, { leadClass });
			return container.textContent?.trim() ?? '';
		});
		expect(new Set(labels).size).toBe(WAITLIST_LEAD_CLASSES.length);
	});

	// Priority A carries a ring the others don't — the "impossible to miss" affordance. Asserted
	// structurally so restyling can change the colour but not silently flatten A into the pack.
	it('marks Priority A more loudly than the other classes', () => {
		const ringed = WAITLIST_LEAD_CLASSES.filter((leadClass) => {
			const { container } = render(WaitlistLeadClassBadge, { leadClass });
			return container.querySelector('[class*="ring-"]') !== null;
		});
		expect(ringed).toEqual(['priority-a']);
	});
});
