<script lang="ts">
	// The close/dismiss "X" glyph — the single source for the path shared by the dialog chrome
	// (GlassDialog) and the mobile-menu toggle (Header), so the copies can't drift. Wraps the shared
	// Icon (stroke, aria-hidden); size via `class`.
	import Icon from './Icon.svelte';

	let { class: klass = 'size-4' }: { class?: string } = $props();
</script>

<Icon class={klass}>
	<path d="M18 6 6 18M6 6l12 12" />
</Icon>
