// Shared open-state for the single global contact modal (issue #11). One instance,
// imported by the triggers (hero + CTA buttons in +page.svelte, the footer link)
// and by ContactDialog.svelte (rendered once in +layout.svelte). A runes-class
// singleton — the same pattern as src/lib/paraglide.svelte.ts.
class ContactDialogState {
	open = $state(false);

	show() {
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const contactDialog = new ContactDialogState();
