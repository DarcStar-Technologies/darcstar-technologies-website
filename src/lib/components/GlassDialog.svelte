<script lang="ts">
	// Shared frosted-glass modal chrome (issue #69 follow-up) — Portal + backdrop + positioner +
	// glass panel + the top-right close button — so ContactDialog and LoginDialog can't drift. The
	// caller supplies the body (title/description + form/success) as `children`; those may still use
	// Skeleton's `Dialog.Title`/`Dialog.Description`/`Dialog.CloseTrigger` because the snippet renders
	// inside this component's `<Dialog>`, so the Dialog context reaches them.
	//
	// Open-state is controlled by the caller: `open` from its rune + a raw `onOpenChange` (the
	// contact dialog uses it to clear transient state on close). `maxWidth` sizes the panel.
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import IconClose from './IconClose.svelte';
	import type { Snippet } from 'svelte';

	let {
		open,
		onOpenChange,
		closeLabel,
		maxWidth = 'lg',
		children
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		closeLabel: string;
		maxWidth?: 'sm' | 'lg';
		children: Snippet;
	} = $props();

	// Both literals are referenced here so Tailwind generates them (and both were already in use).
	const widthClass = { sm: 'max-w-sm', lg: 'max-w-lg' };
</script>

<Dialog {open} onOpenChange={(e) => onOpenChange(e.open)}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" />
		<Dialog.Positioner
			class="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4"
		>
			<Dialog.Content
				class="glass-card relative my-8 w-full {widthClass[maxWidth]} p-6 text-left sm:p-8"
			>
				<Dialog.CloseTrigger
					class="glass-btn absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-body hover:text-white"
					aria-label={closeLabel}
				>
					<IconClose />
				</Dialog.CloseTrigger>

				{@render children()}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
