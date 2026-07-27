import { expect, test, type Locator } from '@playwright/test';

// /waitlist (DAR-60 step 1 · DAR-61 step 2 · DAR-62 step 3 · DAR-63 step 4 · DAR-64 the
// confirmation and its server-chosen CTA) through the Cloudflare
// worker build. Hermetic against the placeholder DB (DATABASE_URL=…invalid in CI): step 1's honeypot
// short-circuit accepts-but-does-not-persist and hands back a decoy continuation token (pure crypto,
// no DB) — that's what lets these specs reach and drive the later steps without a real database. The
// decoy verifies to a `decoy_` id, which the step endpoints deliberately skip the enrich write for
// (it addresses no real row), so even the ANSWERED paths below stay DB-free. Belt and braces: the
// enrich is best-effort anyway (waitlist-steps.remote.ts logs a failure rather than breaking the
// flow). The step-4 branch is chosen from the answers alone (a signed claim, never a stored read),
// so both branches are reachable here too.
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

// DAR-66: the funnel handle the page's load minted, carried in a hidden field so the signup can be
// attributed to the same flow as the view. That this page renders at all is the other half of the
// assertion — the load records the view against the placeholder DB, so the write is failing on every
// request here, and analytics failing must never cost the visitor the form.
test('the step-1 form carries an anonymous funnel handle', async ({ page }) => {
	await page.goto('/waitlist');

	await expect(page.getByRole('main').locator('input[name="flowId"]')).toHaveValue(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	);
});

// A LINK TO /waitlist MUST NOT PREFETCH ON HOVER (DAR-66). The app shell sets
// `data-sveltekit-preload-data="hover"` on <body>, and preloading DATA means running the page's load
// — which is where `waitlist_viewed` is recorded. Left at the default, every mouse pass over the
// homepage CTA (or the footer link, which is on every page) would count a view for a page nobody
// opened, permanently understating the primary conversion metric. The links opt down to `tap`, so the
// fetch starts on pointerdown instead; a click reuses that single request, so a real visitor is still
// fetched once and counted once.
//
// Asserted at the network layer rather than by reading the attribute, because the attribute is only
// the mechanism — what matters is that no request reaches the load.
test('hovering a link to /waitlist does not prefetch it', async ({ page }) => {
	const dataRequests: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/waitlist/__data.json')) dataRequests.push(request.url());
	});

	await page.goto('/');
	const cta = page
		.getByRole('main')
		.getByRole('link', { name: /waitlist/i })
		.first();
	await cta.hover();
	// Kit's hover preload fires more or less immediately; give it well past that before concluding.
	await page.waitForTimeout(1000);
	expect(dataRequests).toEqual([]);

	// …and the opt-out is `tap`, not `off`: the click must still work and still fetch exactly once.
	await cta.click();
	await expect(page).toHaveURL(/\/waitlist$/);
	await expect(page.getByRole('main').locator('input[name="flowId"]')).toHaveValue(
		/^[0-9a-f]{8}-/i
	);
	expect(dataRequests).toHaveLength(1);
});

// The structural companion to the test above. That one proves the mechanism works on ONE link; this
// one enumerates every `/waitlist` anchor the site renders and insists each carries the opt-out — the
// regression it guards is a new link arriving without it.
//
// Not hypothetical: DAR-67 added three (`/signup`'s CTA, the `/login` prompt, and the navbar "Request
// access") as a side effect of closing public sign-up, a change with no obvious connection to
// analytics. Two of them — the navbar link and the login dialog's prompt — render on EVERY page, so
// one missing attribute would put a phantom view behind every mouse-drift across the header.
test('every link to /waitlist opts out of hover prefetch', async ({ page }) => {
	const assertAllTap = async (where: string) => {
		// Locale-prefixed hrefs (/es/waitlist) need the attribute just as much, so match on the suffix.
		const links = page.locator('a[href$="/waitlist"]');
		const count = await links.count();
		expect(count, `${where}: expected at least one /waitlist link`).toBeGreaterThan(0);
		for (let i = 0; i < count; i++) {
			await expect(
				links.nth(i),
				`${where}: link ${i} (${await links.nth(i).getAttribute('href')})`
			).toHaveAttribute('data-sveltekit-preload-data', 'tap');
		}
	};

	// The homepage covers the hero CTA + navbar + footer; /login and /signup add their own prompts.
	for (const path of ['/', '/login', '/signup']) {
		await page.goto(path);
		await assertAllTap(path);
	}

	// The login dialog is rendered in the layout and its prompt links to /waitlist, so it can appear
	// over any route. It only mounts while open — hence driving the navbar's JS-upgraded "Sign in".
	await page.goto('/');
	await page.getByRole('navigation').getByRole('link', { name: 'Sign in' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await assertAllTap('login dialog');
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
async function chooseOption(main: Locator, field: RegExp, option: RegExp | string) {
	await main.getByRole('combobox', { name: field }).click();
	await main.getByRole('option', { name: option }).click();
}

// The terminal confirmation (DAR-64). Its single CTA is chosen SERVER-side from the flow state, so
// asserting which one each path lands on is what pins the whole routing chain end to end — including
// the signed claim that carries the step-2 decisions through steps 3 and 4.
//
// Every variant is a real <a href>: that IS the no-JS contract (the pilot one is a /contact link that
// JS upgrades into the site-wide modal), so an href assertion holds with or without hydration.
async function expectConfirmation(main: Locator, cta: string, href: RegExp) {
	await expect(main.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
	await expect(main.getByRole('link', { name: cta })).toHaveAttribute('href', href);

	// Exactly ONE call to action — a second link would defeat the point of choosing one.
	await expect(main.getByRole('link')).toHaveCount(1);

	// Nothing the visitor answered is echoed back. The step-3 value/budget answers are internal-only
	// (DAR-58), so a currency figure or a "budget" label on this screen is a leak, not a cosmetic bug.
	await expect(main.getByText(/budget/i)).toHaveCount(0);
	await expect(main.getByText(/\$/)).toHaveCount(0);
	await expect(main.getByText(/economic impact/i)).toHaveCount(0);
	await expect(main.getByText(/deployment scale/i)).toHaveCount(0);
}

// Signup → step 2 → answer with a commercial role AND a near-term timeline → step 3. The role is what
// routes Continue into step 3; the timeline is what the (signed) step-4 branch will be chosen from
// once step 3 is done — see waitlist-flow.ts.
async function advanceToStep3(main: Locator) {
	await advanceToStep2(main);
	await chooseOption(main, /Your role/, 'Engineering or technical leader');
	await chooseOption(main, /Evaluation timeline/, 'Evaluating now');
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(
		main.getByRole('heading', { level: 1, name: 'Help us understand the opportunity' })
	).toBeVisible();
}

// …and on into branch A, the only path that reaches it via step 3.
async function advanceToStep4A(main: Locator) {
	await advanceToStep3(main);
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(
		main.getByRole('heading', { level: 1, name: 'Would you consider an evaluation?' })
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
	// the raw remote action, and no duplicate-attach / other runtime error. Skip means "stop asking
	// me things", so it terminates instead of forking to step 4.
	//
	// Skipping step 2 leaves us knowing nothing about them, so the CTA is the least-committal one
	// (DAR-64's "general signup"). Note the selects were never touched here — but a skip AFTER
	// answering would land in the same place, because a skip persists nothing either way.
	await main.getByRole('button', { name: 'Skip for now' }).click();
	await expectConfirmation(main, 'Return to DarcStar', /\/$/);
	await expect(page).toHaveURL(/\/waitlist$/);
	expect(errors).toEqual([]);
});

test('"Continue" with no answers selected forks to branch B and finishes', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep2(main);

	// Every select left blank → nothing to persist (all three fields are optional), and nothing to
	// classify either, so the flow routes PAST step 3 (fail-safe polarity: unanswered is not a
	// commercial prospect) and PAST branch A (same polarity: an unanswered timeline is not active
	// interest) into branch B, with no DB round-trip — waitlist-flow.ts.
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(
		main.getByRole('heading', { level: 1, name: 'What would you like to receive?' })
	).toBeVisible();
	await expect(
		main.getByRole('heading', { name: 'Help us understand the opportunity' })
	).toHaveCount(0);

	// Branch B asks nothing about money or pilots.
	await expect(main.getByText('Realistic budget')).toHaveCount(0);
	await expect(main.getByRole('checkbox', { name: /contact me directly/ })).toHaveCount(0);

	// Nothing was classifiable, so the confirmation offers the least-committal CTA — not the evidence
	// or publications link, and certainly not a conversation.
	await main.getByRole('button', { name: 'Continue' }).click();
	await expectConfirmation(main, 'Return to DarcStar', /\/$/);
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
	// (and step 4) authorize their writes, including after a no-JS re-render. Alongside it rides the
	// SIGNED step-4 branch: step 3 doesn't re-ask the timeline the fork reads, so step 2's decision is
	// carried here rather than re-derived (and a MAC, not trust, is what makes the hidden field safe).
	await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
	await expect(main.locator('input[name="flowClaim"]')).toHaveValue(/^f1\./);

	// The ≤3 cap is an enhancement: once three are ticked the rest disable, and unticking frees a slot.
	// (The server truncates regardless — see the step-3 validator.)
	const evidence = (name: string) => main.getByRole('checkbox', { name });
	await evidence('Successful evaluation or pilot').check();
	await evidence('Formal proof artifacts').check();
	await evidence('Independent performance benchmarks').check();
	await expect(evidence('Production references')).toBeDisabled();
	await evidence('Formal proof artifacts').uncheck();
	await expect(evidence('Production references')).toBeEnabled();

	// Continue with real answers moves on to the branch the timeline earned (the decoy id skips the
	// write, so this stays DB-free — the stored side is covered by waitlist-store.spec.ts against real
	// libsql).
	await main.getByRole('button', { name: 'Continue' }).click();
	await expect(
		main.getByRole('heading', { level: 1, name: 'Would you consider an evaluation?' })
	).toBeVisible();
	expect(errors).toEqual([]);
});

test('"Skip for now" on step 3 reaches the confirmation', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep3(main);

	// Skip persists none of step 3's answers (even if boxes were ticked first) and terminates — it
	// doesn't fall through to step 4 either.
	await main.getByRole('checkbox', { name: 'Production references' }).check();
	await main.getByRole('button', { name: 'Skip for now' }).click();

	// DAR-64's "technical evaluator": skipping the money questions doesn't unlearn the commercial role
	// given at step 2, so the evidence CTA still stands. That audience survived a step the form never
	// re-asks it in — it rode along inside the signed flow claim.
	await expectConfirmation(main, 'View the GIDE evidence overview', /\/evidence$/);
	await expect(page).toHaveURL(/\/waitlist$/);
});

// The other half of the step-3 gate: researchers, students and investors never see the money
// questions — they fork straight from step 2 into branch B.
test('a non-commercial role routes past step 3 into branch B', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep2(main);
	await chooseOption(main, /Your role/, 'Researcher');
	await chooseOption(main, /Evaluation timeline/, 'General interest only');
	await main.getByRole('button', { name: 'Continue' }).click();

	await expect(
		main.getByRole('heading', { level: 1, name: 'What would you like to receive?' })
	).toBeVisible();
	await expect(
		main.getByRole('heading', { name: 'Help us understand the opportunity' })
	).toHaveCount(0);

	// Reached from step 2, so the token comes from ITS echo rather than step 3's — same silent-failure
	// argument as the branch-A assertion.
	await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);

	await main.getByRole('checkbox', { name: 'Technical reports' }).check();
	await main.getByRole('checkbox', { name: 'Open-source releases' }).check();
	await main.getByRole('button', { name: 'Continue' }).click();

	// A researcher gets publications — branch B can't reach the pilot CTA at all, because it never
	// asks the question that earns it.
	await expectConfirmation(main, 'Explore technical publications', /\/research$/);
});

// DAR-63 branch A: the contact block is revealed only by a POSITIVE pilot answer, and the phone field
// only by choosing a call. With JS this is an {#if} — the fields aren't merely hidden, they're absent,
// so a stale phone number can't ride along after the answer changes.
test('step 4A reveals the contact block only while the pilot answer is positive', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep4A(main);

	// Both signed values survived TWO echoes to get here (step 2 → step 3 → step 4). Worth asserting
	// directly: the enrich is best-effort and silent, so a broken token chain would lose every step-4
	// answer without a visible symptom — and a broken CLAIM chain is invisible on THIS path in
	// particular, because a positive pilot answer earns the `pilot` CTA whether or not the audience
	// arrived. (The A-negative test below is where the audience itself is proven.)
	await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
	await expect(main.locator('input[name="flowClaim"]')).toHaveValue(/^f1\./);

	// Unanswered: only the one question.
	await expect(main.getByText('Evaluation interest')).toBeVisible();
	await expect(main.getByLabel(/Deployment scale/)).toHaveCount(0);
	await expect(main.getByRole('checkbox', { name: /contact me directly/ })).toHaveCount(0);

	await chooseOption(main, /Evaluation interest/, /within 3 months/);
	await expect(main.getByLabel(/Deployment scale/)).toBeVisible();
	await expect(main.getByRole('checkbox', { name: /contact me directly/ })).toBeVisible();
	await expect(main.getByRole('combobox', { name: /Preferred contact method/ })).toBeVisible();

	// The phone field is the nested reveal — a call, not email.
	await expect(main.getByLabel(/Phone/)).toHaveCount(0);
	await chooseOption(main, /Preferred contact method/, 'Phone or video call');
	await expect(main.getByLabel(/Phone/)).toBeVisible();
	await main.getByLabel(/Phone/).fill('+1 555 000 1234');

	// Answering the whole branch terminates the flow.
	await main.getByRole('checkbox', { name: /contact me directly/ }).check();
	await main.getByLabel(/Deployment scale/).fill('Two inspection cells, about 40 units.');
	await main.getByRole('button', { name: 'Continue' }).click();

	// A positive pilot answer is the only thing that earns the conversation CTA (DAR-64's "strong
	// pilot prospect"). It renders as a /contact link so it works without JS.
	await expectConfirmation(main, 'Request an evaluation conversation', /\/contact$/);
	// …and the free text they just typed is internal-only — it must not come back at them.
	await expect(main.getByText('Two inspection cells')).toHaveCount(0);

	// With JS the link opens the site-wide contact modal in place instead of navigating away, so the
	// lead doesn't lose the confirmation. (The dialog lives outside <main>, hence the page-level
	// locator.)
	await main.getByRole('link', { name: 'Request an evaluation conversation' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page).toHaveURL(/\/waitlist$/);
	expect(errors).toEqual([]);
});

// The A-negative path: "not currently" collapses the contact block, so nobody is asked for a phone
// number or permission they didn't earn. (The server independently records contact_permission as
// "never asked" for a non-positive answer — waitlist.spec.ts.)
test('step 4A hides the contact block again for a negative answer', async ({ page }) => {
	await page.goto('/waitlist');
	const main = page.getByRole('main');

	await advanceToStep4A(main);

	await chooseOption(main, /Evaluation interest/, /within 6 months/);
	await expect(main.getByRole('checkbox', { name: /contact me directly/ })).toBeVisible();

	await chooseOption(main, /Evaluation interest/, 'Not currently');
	await expect(main.getByRole('checkbox', { name: /contact me directly/ })).toHaveCount(0);
	await expect(main.getByLabel(/Deployment scale/)).toHaveCount(0);
	await expect(main.getByLabel(/Phone/)).toHaveCount(0);

	await main.getByRole('button', { name: 'Continue' }).click();

	// The A-negative CTA: they're still a commercial evaluator (that came from step 2), but declining
	// a pilot must not be answered with an invitation to talk about one.
	await expectConfirmation(main, 'View the GIDE evidence overview', /\/evidence$/);
});

// RELOAD RESUMES THE FLOW (DAR-75). Before this, every one of these reloads showed the blank step-1
// form again — the flow lived entirely in per-response remote-form results, which don't survive one.
// The state now rides a signed, httpOnly cookie the page's load turns back into the right step. These
// run on the honeypot's decoy token like everything else here, so they stay DB-free: the cookie is
// written on the decoy path too, deliberately, so the trap can't be spotted from a response header.
test.describe('resuming after a reload', () => {
	test('a reload after the step-1 signup comes back to step 2, not a blank form', async ({
		page
	}) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		await advanceToStep2(main);

		await page.reload();

		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();
		// And it is a WORKING step 2, not just the right heading: the load re-minted a continuation
		// token for the same row, so Continue still has something to authorize.
		await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
	});

	// The funnel handle survives too. Without this a mid-flow reload would strand the rest of the
	// visitor's events on a second flow id, so `qualification_completed` would belong to a flow that
	// never recorded a view — every ratio in the admin readout quietly wrong (DAR-66).
	test('a reload keeps the visitor on ONE funnel flow', async ({ page }) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		const flowId = await main.locator('input[name="flowId"]').inputValue();

		await advanceToStep2(main);
		await page.reload();

		await expect(main.locator('input[name="flowId"]')).toHaveValue(flowId);
	});

	// Deeper in: the branch and CTA audience step 2 decided are carried by the cookie as well as by
	// the signed flow claim, so a reload at step 3 still knows which step-4 branch it is heading for.
	test('a reload at step 3 comes back to step 3 with its flow claim intact', async ({ page }) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		await advanceToStep3(main);

		await page.reload();

		await expect(
			main.getByRole('heading', { level: 1, name: 'Help us understand the opportunity' })
		).toBeVisible();
		await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
		await expect(main.locator('input[name="flowClaim"]')).toHaveValue(/^f1\./);

		// …and it still routes: Continue from here reaches branch A, which only the carried claim can
		// have chosen (step 3 never re-asks the timeline it was derived from).
		await main.getByRole('button', { name: 'Continue' }).click();
		await expect(
			main.getByRole('heading', { level: 1, name: 'Would you consider an evaluation?' })
		).toBeVisible();
	});

	// The terminal case, and the one the ticket names first. The confirmation's CTA is a server
	// decision, so a resumed confirmation showing the SAME one is what proves the cookie carried the
	// resolved decision rather than the page re-guessing from nothing.
	test('a reload after the flow finishes comes back to the confirmation, same CTA', async ({
		page
	}) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		await advanceToStep4A(main);

		await chooseOption(main, /Evaluation interest/, /within 3 months/);
		await main.getByRole('button', { name: 'Continue' }).click();
		await expectConfirmation(main, 'Request an evaluation conversation', /\/contact$/);

		await page.reload();

		await expect(main.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
		await expect(
			main.getByRole('link', { name: 'Request an evaluation conversation' })
		).toHaveAttribute('href', /\/contact$/);

		// A finished flow's cookie holds a screen and a link and nothing else — the row id is dropped
		// at `done`, so there is no step form and nothing left to authorize.
		await expect(main.locator('input[name="token"]')).toHaveCount(0);
	});

	// THE ESCAPE HATCH. Resuming a finished flow would otherwise trap a visitor who came back to sign
	// up a second address on a confirmation with no form.
	test('"Start a new signup" clears the resume state and gives the form back', async ({ page }) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		await advanceToStep2(main);
		await page.reload();

		// The link appears only on a RESUMED render — never on the in-flight one, where it would be a
		// second call to action on a screen designed to have exactly one (DAR-64).
		const restart = main.getByRole('link', { name: 'Start a new signup' });

		// HOVERING IT MUST NOT FIRE IT. <body> sets `data-sveltekit-preload-data="hover"`, and
		// preloading data runs the load — which for `?restart` deletes the cookie. Without the opt-out
		// a mouse drifting across this link would silently throw away the visitor's place in the flow.
		// Asserted by behaviour, not by reading the attribute: what matters is that the state survives.
		await restart.hover();
		await page.waitForTimeout(1000); // Kit's hover preload fires well inside this
		await page.reload();
		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();

		await main.getByRole('link', { name: 'Start a new signup' }).click();

		await expect(
			main.getByRole('heading', { level: 1, name: 'Get early access to GIDE' })
		).toBeVisible();
		await expect(main.getByLabel('Email', { exact: true })).toHaveValue('');

		// The parameter must NOT survive into the URL. Left there, the next signup would be made from
		// `/waitlist?restart`, and the very next reload would clear the cookie step 1 had just set —
		// the original bug, reintroduced for exactly the people who used the escape hatch.
		await expect(page).toHaveURL(/\/waitlist$/);

		// Really cleared, not just this render: a plain reload of /waitlist stays on the form.
		await page.reload();
		await expect(
			main.getByRole('heading', { level: 1, name: 'Get early access to GIDE' })
		).toBeVisible();
	});

	// …and the whole point of clearing it: a second signup works, and is resumable in its own right.
	test('after a restart the flow can be run again from scratch', async ({ page }) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		await advanceToStep2(main);
		await page.reload();
		await main.getByRole('link', { name: 'Start a new signup' }).click();

		await advanceToStep2(main);
		await page.reload();
		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();
	});

	test('the in-flight flow offers no restart link', async ({ page }) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');
		await advanceToStep2(main);

		await expect(main.getByRole('link', { name: 'Start a new signup' })).toHaveCount(0);
	});

	// The cookie's own contract. It carries a re-mintable row handle, so script must not be able to
	// read it, and it must be signed rather than a legible blob a visitor could edit into another step.
	test('the resume cookie is httpOnly and opaque', async ({ page, context }) => {
		await page.goto('/waitlist');
		await advanceToStep2(page.getByRole('main'));

		const cookie = (await context.cookies()).find((c) => c.name === 'waitlist_resume');
		expect(cookie, 'step 1 must set the resume cookie').toBeDefined();
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.sameSite).toBe('Lax');
		// `r1.` — its own signing prefix, distinct from the continuation token's `v1.` and the flow
		// claim's `f1.`, so none of the three can be presented as another.
		expect(cookie?.value.startsWith('r1.')).toBe(true);
		await expect(page.evaluate(() => document.cookie)).resolves.not.toContain('waitlist_resume');
	});

	// A resumed render carries a freshly minted continuation token in a hidden field, and unlike every
	// in-flight step — each of which is the answer to a POST — it is a GET, i.e. cacheable. A shared
	// cache storing it would hand one visitor a write capability for another visitor's row.
	test('a resumed render forbids shared caching; a fresh one is untouched', async ({ page }) => {
		const fresh = await page.goto('/waitlist');
		expect(fresh?.headers()['cache-control'] ?? '').not.toContain('no-store');

		await advanceToStep2(page.getByRole('main'));
		const resumed = await page.reload();
		expect(resumed?.headers()['cache-control']).toContain('private');
		expect(resumed?.headers()['cache-control']).toContain('no-store');
	});
});

// Without JavaScript every step must still submit: each remote form degrades to a native per-step
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
	// what the response's `token` echo (and step 2's signed flow claim) are FOR — after a native POST
	// the previous step's result is gone, so without them step 4 would render with no authorization to
	// carry and no idea which branch it is. Runs on the honeypot's decoy token like the hydrated specs,
	// so no real row is involved. GlassSelect serves its native <select> here (never hydrated), which
	// is also the only place these SSR code paths get exercised.
	test('steps 1 → 2 → 3 → 4A chain through native POSTs, carrying the token forward', async ({
		page
	}) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');

		// The funnel handle this render was recorded under. Every step must echo THIS value: without
		// JS each submit re-renders the page, whose load mints a fresh id, so an unechoed handle would
		// silently split one visitor across four flows and make every funnel ratio meaningless.
		const flowId = await main.locator('input[name="flowId"]').inputValue();
		expect(flowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

		await main.getByLabel('Name', { exact: true }).fill('Bot McBotface');
		await main.getByLabel('Email', { exact: true }).fill('bot@bot');
		await main.locator('input[name="website"]').fill('bot', { force: true });
		await main.getByRole('button', { name: 'Join the waitlist' }).click();

		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();

		// A commercial role → step 2's Continue routes into step 3; the near-term timeline is what the
		// step-4 branch gets decided from.
		await main.getByLabel(/Your role/).selectOption('engineering-leader');
		await main.getByLabel(/Evaluation timeline/).selectOption('evaluating-now');
		await main.getByRole('button', { name: 'Continue' }).click();

		await expect(
			main.getByRole('heading', { level: 1, name: 'Help us understand the opportunity' })
		).toBeVisible();
		await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
		await expect(main.locator('input[name="flowClaim"]')).toHaveValue(/^f1\./);
		await expect(main.locator('input[name="flowId"]')).toHaveValue(flowId);

		// Step 3 answers submit natively too (the checkbox group needs no JS at all).
		await main.getByLabel(/Realistic budget/).selectOption('25k-100k');
		await main.getByRole('checkbox', { name: 'Formal proof artifacts' }).check();
		await main.getByRole('button', { name: 'Continue' }).click();

		// Branch A, unhydrated: the conditional reveals are progressive enhancement ONLY, so every
		// field is rendered and submittable here — hiding is what JS adds, never gating.
		await expect(
			main.getByRole('heading', { level: 1, name: 'Would you consider an evaluation?' })
		).toBeVisible();
		// Both signed values made it through THREE native POSTs. Asserting the claim explicitly matters
		// most here: this chain ends on a positive pilot answer, which earns the `pilot` CTA on its own,
		// so a claim that silently stopped being carried would leave no trace in the final assertion.
		await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
		await expect(main.locator('input[name="flowClaim"]')).toHaveValue(/^f1\./);
		// Same handle after THREE native POSTs — one visitor, one funnel flow.
		await expect(main.locator('input[name="flowId"]')).toHaveValue(flowId);
		await expect(main.getByLabel(/Deployment scale/)).toBeVisible();
		await expect(main.getByRole('checkbox', { name: /contact me directly/ })).toBeVisible();
		await expect(main.getByLabel(/Phone/)).toBeVisible();

		await main.getByLabel(/Evaluation interest/).selectOption('possibly-contact-me');
		await main.getByRole('checkbox', { name: /contact me directly/ }).check();
		await main.getByLabel(/Preferred contact method/).selectOption('phone-video');
		await main.getByRole('button', { name: 'Continue' }).click();

		// The confirmation personalizes without JS too: its CTA is a server decision carried in the
		// response, and the pilot variant degrades to exactly what it is — a link to /contact. The
		// audience behind it survived two native POSTs inside the signed flow claim.
		await expectConfirmation(main, 'Request an evaluation conversation', /\/contact$/);
	});

	// Resuming (DAR-75) matters MORE here than on the hydrated path: without JS every step is a
	// full-page POST, so the browser's own reload button re-offers the last submission and any stray
	// navigation loses the flow outright. The cookie is the same one either way — nothing about it
	// depends on hydration, which is why it's written by the server rather than by an enhance callback.
	test('a reload mid-flow comes back to the step it left off at', async ({ page }) => {
		await page.goto('/waitlist');
		const main = page.getByRole('main');

		await main.getByLabel('Name', { exact: true }).fill('Bot McBotface');
		await main.getByLabel('Email', { exact: true }).fill('bot@bot');
		await main.locator('input[name="website"]').fill('bot', { force: true });
		await main.getByRole('button', { name: 'Join the waitlist' }).click();
		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();

		// A clean GET, not a re-POST of the form the browser is sitting on — this is the arrival the
		// bug was about.
		await page.goto('/waitlist');

		await expect(
			main.getByRole('heading', { level: 1, name: "Tell us what you're working on" })
		).toBeVisible();
		await expect(main.locator('input[name="token"]')).toHaveValue(/^v1\./);
		// The restart link is a plain <a> — the escape hatch has to work with JS off too.
		await expect(main.getByRole('link', { name: 'Start a new signup' })).toHaveAttribute(
			'href',
			/\?restart$/
		);
	});
});
