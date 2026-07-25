import { expect, test, type Locator } from '@playwright/test';

// /waitlist (DAR-60 step 1 · DAR-61 step 2 · DAR-62 step 3) through the Cloudflare worker build.
// Hermetic against the placeholder DB (DATABASE_URL=…invalid in CI): step 1's honeypot short-circuit
// accepts-but-does-not-persist and hands back a decoy continuation token (pure crypto, no DB) — that's
// what lets these specs reach and drive the later steps without a real database. The decoy verifies
// to a `decoy_` id, which the step endpoints deliberately skip the enrich write for (it addresses no
// real row), so even the ANSWERED paths below stay DB-free. Belt and braces: the enrich is
// best-effort anyway (waitlist-steps.remote.ts logs a failure rather than breaking the flow).
// Selectors are scoped to <main> for consistency with the contact spec (the layout mounts the hidden
// contact modal outside <main>).

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

// Pick a value from a hydrated GlassSelect (the Zag glass menu, not the no-JS <select> fallback).
async function chooseOption(main: Locator, field: RegExp, option: string) {
	await main.getByRole('combobox', { name: field }).click();
	await main.getByRole('option', { name: option }).click();
}

// Signup → step 2 → answer with a commercial role → step 3. An answered, non-excluded role is what
// routes Continue into step 3 (waitlist-flow.ts).
async function advanceToStep3(main: Locator) {
	await advanceToStep2(main);
	await chooseOption(main, /Your role/, 'Engineering or technical leader');
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(
		main.getByRole('heading', { level: 1, name: 'Help us understand the opportunity' })
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

	// Every select left blank → nothing to persist (all three fields are optional), and nothing to
	// classify either, so the flow routes PAST step 3 (fail-safe polarity: unanswered is not a
	// commercial prospect — waitlist-flow.ts) straight to the confirmation, with no DB round-trip.
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	await expect(page).toHaveURL(/\/waitlist$/);
});

// DAR-62's commercial path: an answered, non-excluded role routes step 2's Continue into step 3.
test('a commercial use case continues from step 2 into the step-3 questions', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep3(main);

	// All four questions, each carrying its own prompt.
	await expect(main.getByText('Current approach')).toBeVisible();
	await expect(main.getByText('How do you currently address this problem?')).toBeVisible();
	await expect(main.getByText('Economic impact')).toBeVisible();
	await expect(main.getByText('Realistic budget')).toBeVisible();
	await expect(main.getByText('Adoption requirement')).toBeVisible();

	// The continuation token was carried forward by the step-2 response — that echo is what lets step 3
	// (and DAR-63's step 4) authorize their writes, including after a no-JS re-render.
	await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);

	// The ≤3 cap is an enhancement: once three are ticked the rest disable, and unticking frees a slot.
	// (The server truncates regardless — see the step-3 validator.)
	const evidence = (name: string) => main.getByRole('checkbox', { name });
	await evidence('Successful evaluation or pilot').check();
	await evidence('Formal proof artifacts').check();
	await evidence('Independent performance benchmarks').check();
	await expect(evidence('Production references')).toBeDisabled();
	await evidence('Formal proof artifacts').uncheck();
	await expect(evidence('Production references')).toBeEnabled();

	// Continue with real answers terminates at the confirmation (the decoy id skips the write, so this
	// stays DB-free — the stored side is covered by waitlist-store.spec.ts against real libsql).
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	await expect(page).toHaveURL(/\/waitlist$/);
	expect(errors).toEqual([]);
});

test('"Skip for now" on step 3 reaches the confirmation', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep3(main);

	// Skip persists none of step 3's answers (even if boxes were ticked first) and terminates.
	await main.getByRole('checkbox', { name: 'Production references' }).check();
	await main.getByRole('button', { name: 'Skip for now' }).click();
	await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	await expect(page).toHaveURL(/\/waitlist$/);
});

// The other half of the gate: researchers, students and investors never see the money questions.
test('a non-commercial role routes past step 3 to the confirmation', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep2(main);
	await chooseOption(main, /Your role/, 'Researcher');
	await main.getByRole('button', { name: 'Continue' }).click();

	await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	await expect(
		main.getByRole('heading', { name: 'Help us understand the opportunity' })
	).toHaveCount(0);
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

	// The whole chain, unhydrated: each step is a full-page POST that re-renders the next one. This is
	// what the response's `token` echo is FOR — after a native step-2 POST the step-1 result is gone, so
	// without the echo step 3 would render with no authorization to carry. Runs on the honeypot's decoy
	// token like the hydrated specs, so no real row is involved. GlassSelect serves its native <select>
	// here (never hydrated), which is also the only place these SSR code paths get exercised.
	test('steps 1 → 2 → 3 chain through native POSTs, carrying the token forward', async ({
		page
	}) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');

		await main.getByLabel('Name', { exact: true }).fill('Bot McBotface');
		await main.getByLabel('Email', { exact: true }).fill('bot@bot');
		await main.locator('input[name="website"]').fill('bot', { force: true });
		await main.getByRole('button', { name: 'Join the waitlist' }).click();

		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();

		// A commercial role → step 2's Continue routes into step 3.
		await main.getByLabel(/Your role/).selectOption('engineering-leader');
		await main.getByRole('button', { name: 'Continue' }).click();

		await expect(
			main.getByRole('heading', { level: 1, name: 'Help us understand the opportunity' })
		).toBeVisible();
		await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);

		// Step 3 answers submit natively too (the checkbox group needs no JS at all).
		await main.getByLabel(/Realistic budget/).selectOption('25k-100k');
		await main.getByRole('checkbox', { name: 'Formal proof artifacts' }).check();
		await main.getByRole('button', { name: 'Continue' }).click();
		await expect(main.getByRole('heading', { name: "You're on the list" })).toBeVisible();
	});
});
