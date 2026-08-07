<script lang="ts">
	// One-line data-handling notice rendered next to every data-collecting form's submit
	// (DAR-44). Shared so the forms can't drift and a new form gets its notice by dropping this
	// in with a message pair. `onLinkClick` lets a modal host close itself before the
	// client-side navigation (otherwise the layout-mounted dialog lingers over /privacy); page hosts
	// just omit it, and since DAR-214 removed the login dialog the contact one is the only host that
	// passes it. The link treatment is the shared
	// $lib/styles inlineLinkClass (it used to live here; content pages need it without
	// importing a form component).
	import { localizeHref } from '$lib/paraglide/runtime';
	import { inlineLinkClass } from '$lib/styles';

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
