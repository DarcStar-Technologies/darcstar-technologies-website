// Shared open-state for the single global login modal (#69) — the JS upgrade over the navbar's
// plain /login link. One instance, imported by the navbar trigger (Header.svelte) and by
// LoginDialog.svelte (rendered once in +layout.svelte). The class lives in dialog-state.svelte.ts
// and is shared with the contact modal so the two can't drift.
import { createDialogState } from '$lib/dialog-state.svelte';

export const loginDialog = createDialogState();
