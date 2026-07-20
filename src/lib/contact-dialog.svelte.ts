// Shared open-state for the single global contact modal (issue #11). One instance, imported by the
// triggers (hero + CTA buttons in +page.svelte, the footer link) and by ContactDialog.svelte
// (rendered once in +layout.svelte). The class lives in dialog-state.svelte.ts and is shared with
// the login modal so the two can't drift.
import { createDialogState } from '$lib/dialog-state.svelte';

export const contactDialog = createDialogState();
