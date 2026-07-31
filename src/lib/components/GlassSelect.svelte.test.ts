import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GlassSelectHarness from './GlassSelectHarness.svelte';

// DAR-198: these tests drive the component with DISPATCHED events rather than the browser
// driver (`locator.click()` / `userEvent`), and that is a deliberate, measured choice.
//
// A driver interaction is not in-page work: it is a round trip out to the node process and
// back over CDP, so its latency is set by how busy that process is — not by the component.
// This file was the ONLY one of the 21 client-project files that made such round trips, and
// it was consequently the only one that ever flaked. Measured, one `trigger.click()`:
//
//   file alone, idle box .................    114 ms
//   file alone, loadavg 52 ...............   ~400 ms
//   client project (21 files), loadavg 36 .  8,878 ms
//   full suite (90 files), loadavg 34 ..... 19,397 ms   <- times out at 15s
//
// The dilation is ~170x and tracks the number of other files sharing the pipeline, NOT the
// worker limit — `--maxWorkers=3` measured 9,559 ms, no better than the default. So neither
// a bigger timeout (the distribution has no bound worth naming) nor lower parallelism fixes
// it; removing the round trips does, and it makes this file as cheap as its 20 neighbours.
//
// What that costs, and why it is affordable: dispatched events skip real hit-testing. This
// environment loads no CSS at all — the trigger renders at its unstyled 119x127 and nothing
// animates — so a driver click here never tested "can a user really hit this" in the first
// place. That check is real in `src/routes/waitlist/page.svelte.e2e.ts`, whose `chooseOption`
// helper drives this same hydrated glass menu with genuine Playwright input against the built
// site, with CSS — and DAR-198 added the keyboard path there for the same reason. What is
// left for this file is the component's logic: bound value, rendered label, aria-selected,
// keyboard wiring, all of it in-page.
//
// The premise this file used to carry, "Zag ignores synthetic events", is false: measured,
// the machine opens on a plain `element.click()`, on a pointer sequence, on a mouse sequence
// and on a dispatched Enter. Zag's handlers are ordinary DOM listeners and do not consult
// `isTrusted`. If that ever changes, these tests fail loudly rather than silently passing.

const OPTIONS = [
	{ value: 'robotics', label: 'Robotics & control' },
	{ value: 'markets', label: 'Financial markets' },
	{ value: 'other', label: 'Something else' }
];

/** A full pointer sequence, which is what the Zag select machine listens for. */
function pointerClick(el: Element) {
	for (const type of ['pointerdown', 'pointerup', 'click']) {
		el.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				composed: true,
				cancelable: true,
				button: 0,
				pointerId: 1,
				isPrimary: true
			})
		);
	}
}

/**
 * A key press delivered to whatever currently holds focus, which is what typing does.
 * Targeting the focused element rather than a named one is load-bearing here: measured,
 * Zag moves focus to the LISTBOX when the menu opens (the trigger keeps neither focus nor
 * the `aria-activedescendant`), so keys aimed at the trigger are simply dropped.
 */
function typeKey(key: string) {
	const el = document.activeElement ?? document.body;
	for (const type of ['keydown', 'keyup']) {
		el.dispatchEvent(
			new KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true })
		);
	}
}

function setup() {
	render(GlassSelectHarness, {
		options: OPTIONS,
		placeholder: 'Select an area…',
		label: 'Area of interest'
	});
	// Zag's select trigger renders as role=combobox with aria-haspopup=listbox.
	const trigger = page.getByRole('combobox');
	const triggerEl = () => document.querySelector<HTMLElement>('[role="combobox"]')!;
	const optionEl = (label: string) =>
		[...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
			(li) => li.textContent?.trim() === label
		)!;
	const hiddenValue = () =>
		(document.querySelector('input[name="interest"]') as HTMLInputElement | null)?.value;
	return { trigger, triggerEl, optionEl, hiddenValue };
}

describe('GlassSelect', () => {
	it('renders the label and placeholder with nothing selected', async () => {
		const { trigger, hiddenValue } = setup();
		await expect.element(page.getByText('Area of interest')).toBeVisible();
		await expect.element(trigger).toHaveTextContent('Select an area…');
		expect(hiddenValue()).toBe('');
	});

	it('opens on click and lists every option', async () => {
		const { triggerEl } = setup();
		pointerClick(triggerEl());
		for (const opt of OPTIONS) {
			await expect.element(page.getByRole('option', { name: opt.label })).toBeVisible();
		}
	});

	it('selecting an option binds its value and shows its label', async () => {
		const { trigger, triggerEl, optionEl, hiddenValue } = setup();
		pointerClick(triggerEl());
		await expect.element(page.getByRole('option', { name: 'Financial markets' })).toBeVisible();
		pointerClick(optionEl('Financial markets'));

		// The bound value (→ hidden input → FormData) is the slug, not the label.
		await expect.poll(hiddenValue).toBe('markets');
		await expect.element(trigger).toHaveTextContent('Financial markets');
		// List closes after a selection.
		await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
	});

	it('reflects the chosen option as selected when reopened', async () => {
		const { triggerEl, optionEl, hiddenValue } = setup();
		pointerClick(triggerEl());
		await expect.element(page.getByRole('option', { name: 'Something else' })).toBeVisible();
		pointerClick(optionEl('Something else'));
		await expect.poll(hiddenValue).toBe('other');

		pointerClick(triggerEl());
		await expect
			.element(page.getByRole('option', { name: 'Something else' }))
			.toHaveAttribute('aria-selected', 'true');
	});

	it('is operable by keyboard (open, arrow, select)', async () => {
		const { trigger, triggerEl, hiddenValue } = setup();
		// Focus the trigger, then type — focus moves to the listbox as the menu opens, and
		// `typeKey` follows it exactly as a real keyboard user's keys would.
		triggerEl().focus();
		typeKey('Enter');
		await expect.element(page.getByRole('listbox')).toBeVisible();
		// Focus lands in the menu a beat AFTER it becomes visible, so wait for it rather than
		// for the element — and assert it, since "opening moves focus into the list" is the
		// a11y contract the arrow keys depend on.
		await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('listbox');
		typeKey('ArrowDown');
		typeKey('Enter');

		// Keyboard selection flows through the same onValueChange → bound value path,
		// so a valid slug landing in the hidden input proves the wiring end-to-end.
		await expect.poll(hiddenValue).not.toBe('');
		const val = hiddenValue();
		const chosen = OPTIONS.find((o) => o.value === val);
		expect(chosen, `expected a real slug, got ${JSON.stringify(val)}`).toBeDefined();
		await expect.element(trigger).toHaveTextContent(chosen!.label);
	});
});
