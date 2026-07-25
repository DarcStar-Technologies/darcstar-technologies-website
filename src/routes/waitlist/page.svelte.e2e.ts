import { expect, test, type Locator } from '@playwright/test';

// /waitlist (DAR-60 step 1 + DAR-61 step 2) through the Cloudflare worker build. Hermetic against the
// placeholder DB (DATABASE_URL=…invalid in CI): every path exercised here returns BEFORE any DB
// round-trip. Step 1's honeypot short-circuit accepts-but-does-not-persist and hands back a decoy
// continuation token (pure crypto, no DB) — that's what lets these specs reach and drive step 2
// without a real database. Selectors are scoped to <main> for consistency with the contact spec (the
// layout mounts the hidden contact modal outside <main>).

// Step 1 — the required core signup: Name + Email, the "Join the waitlist" submit, and the DAR-44
// data-handling notice beside it.
test('waitlist step-1 form renders with required fields and its data-handling notice', async ({
	page
}) => {
	await page.goto('/waitlist');

	const main = page.getByRole('main');
	await expect(
		main.getByRole('heading', { level: 1, name: 'Get early access to GIDE' })
	).toBeVisible();
	await expect(main.getByLabel('Name', { exact: true })).toBeVisible();
	await expect(main.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(main.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
	await expect(main.getByRole('link', { name: 'How we handle your data' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);
});

// Drive a signup via the honeypot (accepted, not persisted → decoy token, no DB) and assert the page
// advances IN-PLACE to the step-2 questions rather than the confirmation.
async function advanceToStep2(main: Locator) {
	// Name + Email are `required`, so native browser validation would block the submit if they were
	// empty. Fill them so the form actually submits — the off-screen honeypot is what keeps this
	// hermetic: the server short-circuits on a non-empty honeypot BEFORE validation or any DB round-
	// trip, returning success + a decoy continuation token. Belt-and-braces — the email is
	// deliberately dot-less (`bot@bot`: valid to the browser's <input type=email>, but rejected by the
	// server's stricter check, which runs before any DB access), so even if that short-circuit
	// regressed this spec still couldn't write a row.
	await main.getByLabel('Name', { exact: true }).fill('Bot McBotface');
	await main.getByLabel('Email', { exact: true }).fill('bot@bot');
	await main.locator('input[name="website"]').fill('bot', { force: true });
	await main.getByRole('button', { name: 'Join the waitlist' }).click();
	await expect(
		main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
	).toBeVisible();
}

test('signup advances to the step-2 questions, and "Skip for now" reaches the confirmation', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep2(main);

	// The three optional single-selects and both actions render.
	await expect(main.getByText('Primary application')).toBeVisible();
	await expect(main.getByText('Your role')).toBeVisible();
	await expect(main.getByText('Evaluation timeline')).toBeVisible();
	await expect(main.getByRole('button', { name: 'Continue' })).toBeVisible();
	await expect(main.getByRole('button', { name: 'Skip for now' })).toBeVisible();

	// Skip persists nothing (no DB) and lands on the terminal confirmation, inline — no navigation to
	// the raw remote action, and no duplicate-attach / other runtime error.
	await main.getByRole('button', { name: 'Skip for now' }).click();
	await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	await expect(page).toHaveURL(/\/waitlist$/);
	expect(errors).toEqual([]);
});

test('"Continue" with no answers selected reaches the confirmation', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep2(main);

	// Every select left blank → nothing to persist (all three fields are optional), so Continue also
	// short-circuits the DB and terminates at the confirmation.
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	await expect(page).toHaveURL(/\/waitlist$/);
});

// Without JavaScript both steps must still submit: each remote form degrades to a native per-step
// POST. Verify step 1's form carries the native-submit contract (method + action) without submitting
// (that would need a real DB).
test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the step-1 form falls back to a native POST', async ({ page }) => {
		await page.goto('/waitlist');

		const form = page.getByRole('main').locator('form');
		await expect(form).toHaveAttribute('method', /post/i);
		await expect(form).toHaveAttribute('action', /joinWaitlist/);
		await expect(page.getByRole('main').getByLabel('Name', { exact: true })).toBeVisible();
	});
});
