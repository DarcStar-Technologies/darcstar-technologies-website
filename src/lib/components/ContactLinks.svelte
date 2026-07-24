<script lang="ts">
	// The brand's two public contact channels (src/lib/site.ts), rendered identically wherever a
	// surface lists them — the /about facts and the /privacy + /terms contact sections — so the
	// copies can't drift (the DAR-44 review caught three hand-copies already diverging in order).
	// Parents own the wrapper element (dd/p) and its layout classes; this is just the anchors.
	import { CONTACT_EMAIL, GITHUB_URL, GITHUB_HANDLE } from '$lib/site';
</script>

<a href={`mailto:${CONTACT_EMAIL}`} class="text-body transition-colors hover:text-primary-500"
	>{CONTACT_EMAIL}</a
>
<a
	href={GITHUB_URL}
	target="_blank"
	rel="noreferrer"
	class="text-body transition-colors hover:text-primary-500">{GITHUB_HANDLE}</a
>
