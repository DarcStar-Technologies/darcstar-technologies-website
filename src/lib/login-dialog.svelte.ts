// Shared open-state for the single global login modal (#69) — the JS upgrade over the navbar's
// plain /login link. One instance, imported by the navbar trigger (Header.svelte) and by
// LoginDialog.svelte (rendered once in +layout.svelte). A runes-class singleton — the same
// pattern as src/lib/contact-dialog.svelte.ts.
class LoginDialogState {
	open = $state(false);

	show() {
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const loginDialog = new LoginDialogState();
