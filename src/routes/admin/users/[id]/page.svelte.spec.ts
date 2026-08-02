import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages.js';
import Page from './+page.svelte';

// The visible half of DAR-230. `updateDetails` refuses an ADMIN_USER_IDS owner, and a refusal alone
// would leave an operator pressing Save on an owner's page and getting a 403 banner from a form the
// site itself offered — DAR-226's own lesson about a control that silently 403s, arriving as the
// consequence of a fix rather than as a bug.
//
// `page.server.spec.ts` proves `detailsEditable` carries the right value; this proves the markup
// reads it. Nothing else can: the flag reaching the component and the `{#if}` around the card are
// separate one-line facts, and the server spec is satisfied by a page that ignores the flag entirely.
//
// It cannot be an e2e either — /admin redirects in CI (no session, no reachable DB), so the page is
// only ever reachable as a component with a fabricated `data`.

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/admin/users/t1'), data: {}, params: {}, route: {} }
}));

const at = new Date('2026-08-02T12:00:00Z');

/**
 * The smallest `data` this page renders from — `manageable` gates the note, `detailsEditable` the
 * card. It inherits both layouts' contributions (`user`/`isAdmin` from /admin, `socialLinks`/`isStaff`
 * from the root), so the fixture carries them rather than being cast past: getting one wrong is a
 * `pnpm check` error at this literal instead of a silent pass.
 */
const pageData = (over: { manageable: boolean; detailsEditable: boolean; isSelf?: boolean }) => ({
	user: {
		id: 'boss-1',
		name: 'Boss',
		email: 'boss@example.com',
		emailVerified: true,
		banned: false,
		createdAt: at,
		updatedAt: at
	},
	isAdmin: true,
	isStaff: true,
	socialLinks: [],
	target: {
		id: 't1',
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		emailVerified: true,
		image: null,
		role: 'user',
		banned: false,
		banReason: null,
		banExpires: null,
		createdAt: at,
		updatedAt: at
	},
	sessions: [],
	isSelf: over.isSelf ?? false,
	isOwner: !over.detailsEditable,
	manageable: over.manageable,
	detailsEditable: over.detailsEditable
});

const draw = (over: Parameters<typeof pageData>[0]) =>
	render(Page, { data: pageData(over), form: null });

const detailsForm = (root: HTMLElement) => root.querySelector('form[action="?/updateDetails"]');

describe('the details form follows the gate on the action that receives it', () => {
	// Two admitted cases and one refused, because an absence assertion on its own passes against a
	// page that renders no form under any circumstances.
	it.each([
		['an unrelated account', { manageable: true, detailsEditable: true }],
		['the acting admin’s own account', { manageable: false, detailsEditable: true, isSelf: true }]
	] as const)('offers it for %s', (_label, over) => {
		const { container } = draw(over);

		expect(detailsForm(container)).not.toBeNull();
	});

	it('withholds it for an owner', () => {
		const { container } = draw({ manageable: false, detailsEditable: false });

		expect(detailsForm(container)).toBeNull();
	});

	// The card is hidden by one flag and the explanation is rendered by another, so "the form is gone"
	// and "the page says why" are two claims. Without this an owner's page would simply lose a section
	// with nothing in its place, which reads as a rendering bug rather than as a policy.
	it('explains the absence with the owner note', () => {
		const { container } = draw({ manageable: false, detailsEditable: false });

		expect(container.textContent).toContain(m.admin_users_note_owner());
	});

	// The self note is the OTHER branch of that same `{:else}`, and it must not start standing in for a
	// missing details card: an admin on their own page keeps the form, and the note enumerates role,
	// password and status precisely because it does.
	it('keeps the form and the self note together on the acting admin’s own page', () => {
		const { container } = draw({ manageable: false, detailsEditable: true, isSelf: true });

		expect(detailsForm(container)).not.toBeNull();
		expect(container.textContent).toContain(m.admin_users_note_self());
	});
});
