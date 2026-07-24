<script module lang="ts">
	// The site's one inline-link treatment (the login/signup cross-link style). Exported — the
	// ContactFields fieldClass/submitButtonClass pattern — so a notice that needs a custom line
	// (signup's two-link agreement) can't drift from the shared one.
	export const inlineLinkClass =
		'font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline';
</script>

<script lang="ts">
	// One-line data-handling notice rendered next to every data-collecting form's submit
	// (DAR-44). Shared so the forms can't drift and a new form gets its notice by dropping this
	// in with a message pair. `onLinkClick` lets a modal host close itself before the
	// client-side navigation (the LoginDialog convention — otherwise the layout-mounted dialog
	// lingers over /privacy); page hosts just omit it.
	import { localizeHref } from '$lib/paraglide/runtime';

	let {
		notice,
		linkLabel,
		onLinkClick
	}: { notice: string; linkLabel: string; onLinkClick?: () => void } = $props();
</script>

<p class="text-xs leading-relaxed text-faint">
	{notice}
	<a href={localizeHref('/privacy')} class={inlineLinkClass} onclick={onLinkClick}>{linkLabel}</a>
</p>
