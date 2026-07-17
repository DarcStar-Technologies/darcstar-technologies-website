import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GlassSelectHarness from './GlassSelectHarness.svelte';

const OPTIONS = [
	{ value: 'robotics', label: 'Robotics & control' },
	{ value: 'markets', label: 'Financial markets' },
	{ value: 'other', label: 'Something else' }
];

function setup() {
	render(GlassSelectHarness, {
		options: OPTIONS,
		placeholder: 'Select an area…',
		label: 'Area of interest'
	});
	// Zag's select trigger renders as role=combobox with aria-haspopup=listbox.
	const trigger = page.getByRole('combobox');
	const hiddenValue = () =>
		(document.querySelector('input[name="interest"]') as HTMLInputElement | null)?.value;
	return { trigger, hiddenValue };
}

describe('GlassSelect', () => {
	it('renders the label and placeholder with nothing selected', async () => {
		const { trigger, hiddenValue } = setup();
		await expect.element(page.getByText('Area of interest')).toBeVisible();
		await expect.element(trigger).toHaveTextContent('Select an area…');
		expect(hiddenValue()).toBe('');
	});

	it('opens on click and lists every option', async () => {
		const { trigger } = setup();
		await trigger.click();
		for (const opt of OPTIONS) {
			await expect.element(page.getByRole('option', { name: opt.label })).toBeVisible();
		}
	});

	it('selecting an option binds its value and shows its label', async () => {
		const { trigger, hiddenValue } = setup();
		await trigger.click();
		await page.getByRole('option', { name: 'Financial markets' }).click();

		// The bound value (→ hidden input → FormData) is the slug, not the label.
		await expect.poll(hiddenValue).toBe('markets');
		await expect.element(trigger).toHaveTextContent('Financial markets');
		// List closes after a selection.
		await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
	});

	it('reflects the chosen option as selected when reopened', async () => {
		const { trigger } = setup();
		await trigger.click();
		await page.getByRole('option', { name: 'Something else' }).click();
		await trigger.click();
		await expect
			.element(page.getByRole('option', { name: 'Something else' }))
			.toHaveAttribute('aria-selected', 'true');
	});

	it('is operable by keyboard (open, arrow, select)', async () => {
		const { trigger, hiddenValue } = setup();
		// Real, trusted keyboard input via the browser driver — Zag ignores synthetic events.
		await userEvent.click(trigger); // opens, trigger holds focus (activedescendant pattern)
		await expect.element(page.getByRole('listbox')).toBeVisible();
		await userEvent.keyboard('{ArrowDown}{Enter}');

		// Keyboard selection flows through the same onValueChange → bound value path,
		// so a valid slug landing in the hidden input proves the wiring end-to-end.
		const val = hiddenValue();
		const chosen = OPTIONS.find((o) => o.value === val);
		expect(chosen, `expected a real slug, got ${JSON.stringify(val)}`).toBeDefined();
		await expect.element(trigger).toHaveTextContent(chosen!.label);
	});
});
