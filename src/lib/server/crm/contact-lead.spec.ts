import { describe, expect, it, vi } from 'vitest';
import { captureContactLead } from './contact-lead';
import { postContactSignal } from './queue';
import type { ContactSignal } from './contact-signal';

// The POSTURE half of DAR-136: a queue produce must never be able to fail a contact submission, and
// must be a silent skip where there is no binding. The wire SHAPE is pinned in `crm-egress.spec.ts`.
//
// Worth testing rather than reading, because every failure mode here is invisible at the call site —
// the function returns `void` and runs after the response. A produce that threw synchronously would
// take down a submission whose row is already committed, and nothing downstream would report it.

const lead = {
	submissionId: 'row-1',
	createdAt: new Date('2026-07-29T12:00:00.000Z'),
	name: 'Ada Lovelace',
	email: 'ada@example.com',
	company: null
};

/**
 * A stand-in for the parts of `App.Platform` this path touches. `waitUntil` collects rather than
 * awaits, so a test can assert the produce was HANDED OVER and then settle it — the distinction the
 * real runtime makes and the one that matters (a produce not registered on `ctx` can be killed when
 * the isolate goes away).
 */
function fakePlatform(queue?: { send: (body: unknown) => Promise<void> }) {
	const scheduled: Promise<unknown>[] = [];
	return {
		platform: {
			env: { CRM_INGEST: queue },
			ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) }
		} as unknown as App.Platform,
		scheduled
	};
}

describe('handing a contact lead to the CRM', () => {
	it('enqueues one signal and registers it on ctx.waitUntil', async () => {
		const send = vi.fn(async () => {});
		const { platform, scheduled } = fakePlatform({ send });

		captureContactLead(platform, lead);

		expect(scheduled).toHaveLength(1);
		await Promise.all(scheduled);
		expect(send).toHaveBeenCalledTimes(1);
		expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({
			source: 'website_form',
			sourceRef: 'row-1'
		});
	});

	// The preview Worker. Absence is DESIGNED — wrangler.jsonc declares the binding in production
	// only — so this is the common case there, not an error path.
	it('skips silently when the binding is absent', async () => {
		const { platform, scheduled } = fakePlatform(undefined);
		expect(() => captureContactLead(platform, lead)).not.toThrow();
		await Promise.all(scheduled);
		expect(await postContactSignal(platform, {} as ContactSignal)).toBe('skipped');
	});

	// THE ONE THAT MATTERS. A rejecting queue must not surface: the row is committed, and the CRM's
	// reconcile sweep re-reads `contact_submission`, so a dropped signal is recoverable while a failed
	// submission is not.
	it('never lets a rejecting queue reach the caller', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const send = vi.fn(async () => {
			throw new Error('queue unavailable');
		});
		const { platform, scheduled } = fakePlatform({ send });

		expect(() => captureContactLead(platform, lead)).not.toThrow();
		// `resolves` rather than a bare await: an unhandled rejection here is the defect, and awaiting
		// a rejected promise would fail the test by throwing instead of by asserting.
		await expect(Promise.all(scheduled)).resolves.toBeDefined();
		expect(error).toHaveBeenCalledWith(
			'crm ingest produce failed for submission row-1',
			expect.any(Error)
		);
		// The log line names the row, never the address — it goes to Workers Logs.
		expect(error.mock.calls[0][0]).not.toContain('ada@example.com');
		error.mockRestore();
	});

	// No `ctx` is `vite dev`. The produce still has to be harmless: the `.catch` is attached before
	// anything decides whether to schedule it, so a rejection cannot become an unhandled one.
	it('does not throw when there is no execution context to schedule on', async () => {
		const send = vi.fn(async () => {
			throw new Error('queue unavailable');
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const platform = { env: { CRM_INGEST: { send } } } as unknown as App.Platform;

		expect(() => captureContactLead(platform, lead)).not.toThrow();
		await vi.waitFor(() => expect(error).toHaveBeenCalled());
		error.mockRestore();
	});

	// `platform` itself is optional in SvelteKit's types, so the guard has to survive it being absent
	// rather than only the binding.
	it('tolerates no platform at all', () => {
		expect(() => captureContactLead(undefined, lead)).not.toThrow();
	});

	// A SYNCHRONOUS throw from building the signal must not escape either. Reaching it needs a bad
	// caller — `createdAt` typed as a `Date` and not being one — which is why the assertion is about
	// where the failure LANDS rather than about a shape anybody expects: the row is already committed,
	// so this must log like any other produce failure and leave the submission successful.
	it('swallows a failure to even build the signal', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const send = vi.fn(async () => {});
		const { platform, scheduled } = fakePlatform({ send });
		const bad = { ...lead, createdAt: 1785000000000 as unknown as Date };

		expect(() => captureContactLead(platform, bad)).not.toThrow();
		await expect(Promise.all(scheduled)).resolves.toBeDefined();
		expect(send).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(
			'crm ingest produce failed for submission row-1',
			expect.any(Error)
		);
		error.mockRestore();
	});
});
