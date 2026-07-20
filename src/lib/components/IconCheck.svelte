<script lang="ts">
	// The check/tick glyph — the single source for the path shared by the contact success panels
	// (modal + /contact page) and the GlassSelect selected-item indicator, so the copies can't
	// drift. Wraps the shared Icon (stroke, aria-hidden); size via `class`, weight via `strokeWidth`
	// (the dropdown wants a heavier 2.5).
	import Icon from './Icon.svelte';

	let { class: klass = 'size-6', strokeWidth = 2 }: { class?: string; strokeWidth?: number } =
		$props();
</script>

<Icon class={klass} {strokeWidth}>
	<path d="M20 6 9 17l-5-5" />
</Icon>
