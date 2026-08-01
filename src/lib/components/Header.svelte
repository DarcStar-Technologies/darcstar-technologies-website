<script lang="ts">
	import { slide } from 'svelte/transition';
	import { page } from '$app/state';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { loginDialog } from '$lib/login-dialog.svelte';
	import Wordmark from './Wordmark.svelte';
	import Icon from './Icon.svelte';
	import IconClose from './IconClose.svelte';

	// Nav links — plain localized path links. No "Home" item: the Wordmark logo already links to
	// `/`, so a separate Home link was redundant (issues #11/#8). About points at the real /about
	// page (issue #61; the old `/#about` footer-anchor workaround is retired). `$derived` so hrefs +
	// labels track the active locale; `id` is a stable {#each} key across switches.
	const links = $derived([
		{ id: 'about', label: m.nav_about(), href: localizeHref('/about') },
		{ id: 'news', label: m.nav_news(), href: localizeHref('/news') },
		{ id: 'research', label: m.nav_research(), href: localizeHref('/research') },
		{ id: 'people', label: m.nav_people(), href: localizeHref('/people') }
	]);

	// Site-wide sign-in state from the root `+layout.server.ts` load (`page.data.user` — email or
	// null). Signed in → the nav shows a dashboard link + Sign out; signed out → the "Sign in"
	// link/dialog. `isStaff` (also root-set) picks the dashboard link: Admin for staff, Account for
	// an end-user (#96). `invalidateAll` on sign-in and the native /logout redirect both re-run that
	// load, so this flips reactively.
	const user = $derived(page.data.user);
	const isStaff = $derived(page.data.isStaff ?? false);

	// The two nav-item treatments, one const each. Every item in a list wears the identical string,
	// retyped at all ten call sites until DAR-57 had to touch each of them — so they're one const
	// per list now, and `hover-focus:` gives the keyboard the same state change the pointer gets
	// (the ring itself is site-wide, in layout.css). Component-local, so NOT $lib/styles.ts:
	// nothing outside this file renders a nav item.
	//
	// `whitespace-nowrap` is on the DESKTOP treatment only, and the asymmetry is the rule rather than
	// an omission (DAR-213). A desktop item sits in a horizontal row that the flex algorithm will
	// squeeze, so "Sign in" breaking after "Sign" is a mid-phrase break of a label, which is never
	// what a nav means. A mobile item is a full-width block in a vertical stack, where a long label
	// wrapping is the correct rendering and nowrap would push it out of the panel instead.
	const desktopLinkClass =
		'rounded px-3 py-2 text-sm font-medium whitespace-nowrap text-primary-500 transition-colors hover-focus:text-primary-400';
	const mobileLinkClass =
		'block rounded px-3 py-2 text-base font-medium text-primary-500 transition-colors hover-focus:preset-tonal-primary';

	let open = $state(false);
	let stuck = $state(false);

	// The header lifts its shadow only once it detaches from the top of the page. The
	// sentinel below sits at the document top; IntersectionObserver flips `stuck` as it
	// scrolls out of view — no per-scroll handler, only a fire at the crossing.
	function stickWatch(node: HTMLElement) {
		const io = new IntersectionObserver(([entry]) => (stuck = !entry.isIntersecting));
		io.observe(node);
		return () => io.disconnect();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
/>

<!-- One link markup for both the desktop and mobile lists; `className` carries the
     per-list styling so the two never drift. Plain path links now, so the click only
     closes the mobile menu (the router handles navigation). -->
{#snippet navLink(link: { id: string; label: string; href: string }, className: string)}
	<a href={link.href} onclick={() => (open = false)} class={className}>
		{link.label}
	</a>
{/snippet}

<!-- Login link: a real /login anchor (the no-JS fallback), upgraded when JS is present to open
     the frosted login dialog instead of navigating (issue #69). Same markup for both nav lists. -->
{#snippet loginLink(className: string)}
	<a
		href={localizeHref('/login')}
		data-sveltekit-preload-data="off"
		onclick={(e) => {
			// Honour modified clicks (⌘/Ctrl/Shift/Alt) — let the browser follow the href (e.g.
			// open /login in a new tab) rather than the dialog. A plain left-click with JS opens
			// the frosted dialog; with no JS the click falls through to the href.
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			e.preventDefault();
			open = false;
			loginDialog.show();
		}}
		class={className}
	>
		{m.nav_login()}
	</a>
{/snippet}

<!-- Request-access link: a plain anchor for anonymous visitors (issue #96). Unlike the login link it
     never opens a dialog, so a normal navigation is correct with or without JS. Sits beside "Sign in"
     so the path to an account is reachable from the nav, not only via the login dialog's prompt.
     DAR-67 pointed it at /waitlist rather than /signup: registration is closed, /signup is now only a
     notice saying so, and the waitlist is where a would-be account holder actually needs to arrive.
     `preload-data="tap"` overrides the body-wide `hover` — this link is on EVERY page, and /waitlist's
     load records the funnel's `waitlist_viewed` event (DAR-66), so hover-prefetching it would count a
     view for every incidental mouse pass across the navbar. -->
{#snippet requestAccessLink(className: string)}
	<a
		href={localizeHref('/waitlist')}
		data-sveltekit-preload-data="tap"
		onclick={() => (open = false)}
		class={className}
	>
		{m.nav_request_access()}
	</a>
{/snippet}

<!-- Signed-in controls (replace the login link when `user` is set): a destination link + a Sign-out
     button. Staff (admin/operator) get the gated admin dashboard; an end-user (#96) gets their own
     /account portal — `isStaff` from the root layout picks which. Sign-out is a real form POST
     to /logout so it works without JS; a native full-page navigation re-runs the layout load,
     flipping the nav back. -->
{#snippet adminLink(className: string)}
	<a href={localizeHref('/admin')} onclick={() => (open = false)} class={className}>
		{m.nav_admin()}
	</a>
{/snippet}

{#snippet accountLink(className: string)}
	<a href={localizeHref('/account')} onclick={() => (open = false)} class={className}>
		{m.nav_account()}
	</a>
{/snippet}

{#snippet signoutForm(className: string)}
	<form method="post" action={localizeHref('/logout')} onsubmit={() => (open = false)}>
		<button type="submit" class={className}>{m.nav_signout()}</button>
	</form>
{/snippet}

<!-- Sticky-detection sentinel: out of flow at the document top (no layout shift), it
     scrolls out of view as the header sticks, flipping `stuck` → the shadow-on-scroll. -->
<div
	{@attach stickWatch}
	aria-hidden="true"
	class="pointer-events-none absolute top-0 left-0 h-px w-px"
></div>

<header class="sticky top-0 z-50 px-4 pt-[var(--header-gap-top)]">
	<nav
		class="glass-nav mx-auto max-w-5xl rounded-2xl px-4"
		data-stuck={stuck}
		aria-label={m.nav_primary_label()}
	>
		<div class="flex h-[var(--header-bar-h)] items-center justify-between gap-6">
			<a
				href={localizeHref('/')}
				onclick={() => (open = false)}
				class="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white sm:text-4xl"
			>
				<Wordmark markClass="size-20" />
			</a>

			<div class="flex items-center gap-2 lg:gap-4">
				<!-- Desktop links. The tier is `lg:` and it is MEASURED, not a taste call (DAR-213): the
				     bar is capped at `max-w-5xl`, so the row's usable width is `min(viewport − 64, 992)`,
				     the lockup wants 498 of that on one line and the six anonymous items 528 once they
				     may not break mid-phrase. 1050 against a ceiling of 992 — the row has never fitted,
				     which is why the previous tier asserted a fit at 640px that was false at EVERY width
				     rather than in a band: below ~780px it spilled outside the glass panel, and above it
				     the last two items broke mid-phrase out past 1600px.
				     Everything clears at 951px. `md:` (768) is nowhere near it, and the ~880 that looks
				     like it fits does not: nothing wraps and nothing overflows there, but the bar has
				     squeezed the lockup so far past its own minimum that its text lies across the nav by
				     46.5px. 960 clears by 9px and leaves 2px per label to grow; `lg:` leaves 13px per
				     label — the first standard tier with margin in both directions.
				     Re-measure rather than re-derive if the labels or the lockup change; the numbers
				     above are rendered measurements, not arithmetic.
				     The other three `lg:` sites — this list's gap on the wrapper above, and the toggle
				     and the collapsed menu below — move in lockstep with this one: reveal the row where
				     it fits, and keep the menu everywhere else. -->
				<ul class="hidden items-center gap-1 lg:flex">
					{#each links as link (link.id)}
						<li>
							{@render navLink(link, desktopLinkClass)}
						</li>
					{/each}
					{#if user}
						<li>
							{@render (isStaff ? adminLink : accountLink)(desktopLinkClass)}
						</li>
						<li>
							{@render signoutForm(desktopLinkClass)}
						</li>
					{:else}
						<li>
							{@render loginLink(desktopLinkClass)}
						</li>
						<li>
							{@render requestAccessLink(desktopLinkClass)}
						</li>
					{/if}
				</ul>

				<!-- Mobile menu toggle -->
				<button
					type="button"
					class="btn-icon hover-focus:preset-tonal lg:hidden"
					aria-label={open ? m.nav_menu_close() : m.nav_menu_open()}
					aria-expanded={open}
					aria-controls="mobile-nav"
					onclick={() => (open = !open)}
				>
					{#if open}
						<IconClose class="size-6" />
					{:else}
						<Icon class="size-6">
							<path d="M3 6h18M3 12h18M3 18h18" />
						</Icon>
					{/if}
				</button>
			</div>
		</div>

		<!-- Mobile links -->
		{#if open}
			<ul
				id="mobile-nav"
				class="flex flex-col gap-1 pb-3 lg:hidden"
				transition:slide={{ duration: 150 }}
			>
				{#each links as link (link.id)}
					<li>
						{@render navLink(link, mobileLinkClass)}
					</li>
				{/each}
				{#if user}
					<li>
						{@render (isStaff ? adminLink : accountLink)(mobileLinkClass)}
					</li>
					<li>
						{@render signoutForm(`${mobileLinkClass} w-full text-left`)}
					</li>
				{:else}
					<li>
						{@render loginLink(mobileLinkClass)}
					</li>
					<li>
						{@render requestAccessLink(mobileLinkClass)}
					</li>
				{/if}
			</ul>
		{/if}
	</nav>
</header>
