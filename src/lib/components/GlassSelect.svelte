<script lang="ts">
	// Accessible, theme-styled single-select dropdown (issue #11) — replaces the native
	// <select> so the popup wears the glass/theme and renders identically across
	// browsers. ARIA "select-only combobox" pattern (APG): a role=combobox button that
	// owns the keyboard and points `aria-activedescendant` at the highlighted option in
	// a role=listbox popup (options are NOT individually focusable). The chosen value is
	// plain state; the consumer serializes it for the remote form via a hidden input.
	interface Option {
		value: string;
		label: string;
	}

	let {
		options,
		value = $bindable(''),
		placeholder,
		labelId,
		id
	}: {
		options: Option[];
		value?: string;
		placeholder: string;
		labelId: string;
		id: string;
	} = $props();

	let open = $state(false);
	let activeIndex = $state(-1);
	let button = $state<HTMLButtonElement | null>(null);

	const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? placeholder);

	function openList() {
		open = true;
		const sel = options.findIndex((o) => o.value === value);
		activeIndex = sel >= 0 ? sel : 0;
	}
	function close(focusButton = true) {
		open = false;
		activeIndex = -1;
		if (focusButton) button?.focus();
	}
	function pick(i: number) {
		if (i >= 0 && i < options.length) value = options[i].value;
		close();
	}
	function onkeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				if (open) activeIndex = Math.min(activeIndex + 1, options.length - 1);
				else openList();
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (open) activeIndex = Math.max(activeIndex - 1, 0);
				else openList();
				break;
			case 'Home':
				if (open) {
					e.preventDefault();
					activeIndex = 0;
				}
				break;
			case 'End':
				if (open) {
					e.preventDefault();
					activeIndex = options.length - 1;
				}
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				if (open) pick(activeIndex);
				else openList();
				break;
			case 'Escape':
				if (open) {
					e.preventDefault();
					close();
				}
				break;
			case 'Tab':
				if (open) close(false);
				break;
		}
	}

	// Close when a pointer press lands outside the widget.
	function outsideClose(node: HTMLElement) {
		const handler = (e: PointerEvent) => {
			if (open && !node.contains(e.target as Node)) close(false);
		};
		document.addEventListener('pointerdown', handler, true);
		return () => document.removeEventListener('pointerdown', handler, true);
	}

	// Keep the highlighted option in view during keyboard navigation.
	$effect(() => {
		if (open && activeIndex >= 0) {
			document.getElementById(`${id}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
		}
	});
</script>

<div class="relative" {@attach outsideClose}>
	<button
		bind:this={button}
		type="button"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls="{id}-listbox"
		aria-labelledby={labelId}
		aria-activedescendant={open && activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
		class="glass-field flex w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm"
		onclick={() => (open ? close() : openList())}
		{onkeydown}
	>
		<span class={value ? 'text-white' : 'text-white/40'}>{selectedLabel}</span>
		<svg
			class="size-4 shrink-0 text-white/50 transition-transform duration-150 {open
				? 'rotate-180'
				: ''}"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	</button>

	{#if open}
		<ul
			id="{id}-listbox"
			role="listbox"
			aria-labelledby={labelId}
			class="absolute top-full left-0 z-[70] mt-1.5 max-h-60 w-full overflow-auto rounded-lg border border-white/10 bg-surface-900/95 p-1 shadow-2xl backdrop-blur-xl"
		>
			{#each options as opt, i (opt.value)}
				<!-- Options are controlled by the button via aria-activedescendant (APG
				     select-only combobox); they are not tab stops and have no key handlers
				     of their own — pointer handlers alone are correct here. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{id}-opt-{i}"
					role="option"
					aria-selected={opt.value === value}
					class="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition-colors {i ===
					activeIndex
						? 'bg-primary-500/25 text-white'
						: 'text-white/80'}"
					onclick={() => pick(i)}
					onpointermove={() => (activeIndex = i)}
				>
					{opt.label}
					{#if opt.value === value}
						<svg
							class="text-primary-400 size-4 shrink-0"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
