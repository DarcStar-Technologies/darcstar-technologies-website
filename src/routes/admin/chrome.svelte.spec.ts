import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Component } from 'svelte';

/**
 * The four pages have four different `PageData` shapes, so iterating over them yields a UNION of
 * component types that no single `render` call can accept. Erasing the prop type here — once, at the
 * boundary — is what lets the table below stay a table; each fixture is still shaped by hand, so a
 * missing field is a `pnpm check` error at its own literal rather than a cast that hides it.
 */
const page = async (load: () => Promise<unknown>) =>
	((await load()) as { default: Component<Record<string, unknown>> }).default;

// The rest of /admin, plus /account (DAR-225). `/admin/waitlist` has had a rendering spec since
// DAR-65; these four had none at all — they are behind auth AND behind a database, so the hermetic
// e2e can only ever watch them redirect, and this worktree has no dev DB to point a preview at.
//
// They carry the same shared chrome the waitlist page does (`datagrid-*`, `heading-card`,
// `badge-micro`, the tonal controls), and DAR-223 rewrote all of it. What is asserted is COMPUTED
// style rather than class names, because the defect that motivated this — a `@utility` colliding
// with Skeleton's own — leaves the class name looking perfectly correct.
//
// Deliberately thin: this is chrome cover, not a behavioural spec for four pages. Each fixture is
// the smallest shape that renders one populated row.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/admin'), data: {}, params: {}, route: {} }
}));

const at = new Date('2026-07-31T12:00:00Z');

const PAGES = [
	{
		name: '/admin',
		load: () => import('./+page.svelte'),
		data: {
			submissions: [
				{
					id: 's1',
					name: 'Ada Lovelace',
					email: 'ada@example.com',
					company: 'Analytical Engines',
					interest: 'robotics',
					message: 'Hello',
					createdAt: at,
					userId: null
				}
			],
			limit: 200
		}
	},
	{
		name: '/admin/audit',
		load: () => import('./audit/+page.svelte'),
		data: {
			attempts: [
				{
					id: 'a1',
					email: 'ada@example.com',
					status: 'success',
					reason: null,
					ipAddress: '203.0.113.9',
					userAgent: 'probe',
					userId: 'u1',
					createdAt: at
				}
			],
			limit: 200
		}
	},
	{
		name: '/admin/users',
		load: () => import('./users/+page.svelte'),
		data: {
			users: [
				{
					id: 'u1',
					email: 'ada@example.com',
					name: 'Ada',
					role: 'admin',
					banned: false,
					emailVerified: true,
					createdAt: at
				}
			],
			total: 1,
			limit: 200,
			currentUserId: 'u1',
			ownerIds: ['u1']
		}
	},
	{
		name: '/account',
		load: () => import('../account/+page.svelte'),
		// This one inherits the root layout's half too — `socialLinks` and the nav's `user`/`isStaff` —
		// so the fixture carries them rather than being cast past. Getting it wrong was a `pnpm check`
		// error, not a silent pass, which is the point of typing the fixture at all.
		data: {
			user: { email: 'ada@example.com' },
			socialLinks: [],
			isStaff: false,
			name: 'Ada',
			email: 'ada@example.com',
			messages: [{ id: 'm1', interest: 'robotics', message: 'Hi', createdAt: at }]
		}
	}
] as const;

describe('the rest of /admin renders with the shared chrome', () => {
	beforeAll(async () => {
		await import('../layout.css');
		// `app.html` carries these on <html>, and without them the theme's custom properties never
		// resolve — the heading face falls back to the body face and every `--color-*` token is empty.
		// Setting them is what makes a computed-style assertion describe the real page rather than an
		// unthemed copy of it (measured: the heading assertion below fails without this).
		document.documentElement.setAttribute('data-mode', 'dark');
		document.documentElement.setAttribute('data-theme', 'darcstar');
	});

	for (const { name, load, data } of PAGES) {
		it(`${name} draws its record table`, async () => {
			const { container } = render(await page(load), { data, form: null });

			const table = container.querySelector<HTMLElement>('table');
			expect(table, `${name} rendered no table`).not.toBeNull();
			expect(table!.classList.contains('datagrid')).toBe(true);

			// Applied, not merely named — an unstyled render reports 0px here.
			const cell = container.querySelector<HTMLElement>('.datagrid-td');
			expect(cell, `${name} rendered no datagrid cell`).not.toBeNull();
			expect(getComputedStyle(cell!).paddingLeft).toBe('12px');

			const head = container.querySelector<HTMLElement>('.datagrid-head')!;
			expect(getComputedStyle(head).borderBottomWidth).toBe('1px');
		});

		it(`${name} sizes its headings from a tier`, async () => {
			const { container } = render(await page(load), { data, form: null });
			const headings = [...container.querySelectorAll('h1, h2, h3')];
			expect(headings.length, `${name} rendered no heading`).toBeGreaterThan(0);
			// Every heading resolves to the display face and a real size, whether it wears a tier or is
			// one of the documented one-offs.
			for (const h of headings) {
				const style = getComputedStyle(h);
				expect(Number.parseFloat(style.fontSize)).toBeGreaterThan(14);
				expect(style.fontFamily).toMatch(/Space Grotesk/);
			}
		});
	}
});
