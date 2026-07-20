// Shared open-state for a single global modal. One class, instantiated once per dialog (contact,
// login) via `createDialogState()`, so the near-identical rune singletons can't drift. It stays a
// CLASS (not a plain object) so `.open` remains a reactive `$state` field that consumers read and
// write directly — e.g. `contactDialog.open` in +layout.svelte, `contactDialog.open = e.open` in
// ContactDialog. Same runes-class pattern as before, just defined once.
class DialogState {
	open = $state(false);

	show() {
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export function createDialogState(): DialogState {
	return new DialogState();
}
