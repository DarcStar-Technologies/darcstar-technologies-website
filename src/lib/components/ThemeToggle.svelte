<script lang="ts">
	import { browser } from '$app/environment';
	import { Switch } from '@skeletonlabs/skeleton-svelte';

	// The no-flash script in app.html sets data-mode before hydration, so we can
	// read the applied mode synchronously here (browser-only) as the initial value.
	let checked = $state(browser && document.documentElement.getAttribute('data-mode') === 'dark');

	function onCheckedChange(event: { checked: boolean }) {
		checked = event.checked;
		const mode = checked ? 'dark' : 'light';
		document.documentElement.setAttribute('data-mode', mode);
		localStorage.setItem('mode', mode);
	}
</script>

<div class="flex items-center gap-2">
	<!-- Sun: dimmed in dark mode -->
	<svg
		class="size-4 transition-opacity"
		class:opacity-30={checked}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="4" />
		<path
			d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
		/>
	</svg>

	<Switch {checked} {onCheckedChange} name="theme-mode">
		<Switch.Label class="sr-only">Toggle dark mode</Switch.Label>
		<Switch.Control>
			<Switch.Thumb />
		</Switch.Control>
		<Switch.HiddenInput />
	</Switch>

	<!-- Moon: dimmed in light mode -->
	<svg
		class="size-4 transition-opacity"
		class:opacity-30={!checked}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
	</svg>
</div>
