import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContactDialog from './ContactDialog.svelte';
import { contactDialog } from '$lib/contact-dialog.svelte';

// The modal is driven by the shared `contactDialog` rune (opened from buttons
// elsewhere). These tests exercise the render/open wiring and the honeypot — the
// submit path (validation, Turso) is covered by the server unit test + e2e.
afterEach(() => contactDialog.close());

describe('ContactDialog', () => {
	it('is closed until the shared rune opens it', async () => {
		render(ContactDialog);
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		contactDialog.show();
		await expect.element(page.getByRole('dialog')).toBeVisible();
	});

	it('renders the intake fields and submit control when open', async () => {
		render(ContactDialog);
		contactDialog.show();

		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByLabelText('Name')).toBeVisible();
		await expect.element(dialog.getByLabelText('Email')).toBeVisible();
		await expect.element(dialog.getByLabelText('Message')).toBeVisible();
		await expect.element(dialog.getByRole('combobox')).toBeVisible(); // interest picker
		await expect.element(dialog.getByRole('button', { name: 'Send message' })).toBeVisible();
	});

	it('includes a honeypot field that is hidden from users and the a11y tree', async () => {
		render(ContactDialog);
		contactDialog.show();
		await expect.element(page.getByRole('dialog')).toBeVisible();

		const honeypot = document.querySelector('input[name="website"]') as HTMLInputElement | null;
		expect(honeypot, 'honeypot input should exist').not.toBeNull();
		// Off-screen + out of the a11y tree + unfocusable → a human never fills it.
		expect(honeypot!.closest('[aria-hidden="true"]')).not.toBeNull();
		expect(honeypot!.tabIndex).toBe(-1);
		await expect.element(page.getByRole('textbox', { name: 'website' })).not.toBeInTheDocument();
	});
});
