import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleSends } from './email';

// DAR-181. `settleSends` is the fan-out policy both notify modules share, and until now it was tested
// only THROUGH them — each caller's spec makes fetch reject and checks the sibling still went out.
// That covers the async path twice and the interesting one not at all: the reason this takes thunks
// rather than built emails is that a *builder* can throw, and a builder throws SYNCHRONOUSLY.
//
// Testing it directly is also what surfaced a real hole. `() => Promise<void>` is satisfied by a
// plain function returning a promise, so `senders.map(([, send]) => send())` let a synchronous throw
// escape before `allSettled` — rejecting out of `settleSends` and dropping the sibling send, the exact
// failure the signature exists to prevent. Both hand-written copies this replaced had it too.
const ok = () => Promise.resolve();

describe('settleSends', () => {
	// restoreAllMocks, NOT unstubAllGlobals: nothing here stubs a global, and the console spy has to
	// come back even when an assertion throws before the end of a test — a manual mockRestore() is
	// skipped on failure, which leaves console.error mocked for every test after it and turns one
	// red assertion into a file full of confusing ones.
	afterEach(() => vi.restoreAllMocks());

	it('runs every send and resolves when they all succeed', async () => {
		const calls: string[] = [];
		await expect(
			settleSends('probe', [
				['lead', async () => void calls.push('lead')],
				['ack', async () => void calls.push('ack')]
			])
		).resolves.toBeUndefined();
		expect(calls).toEqual(['lead', 'ack']);
	});

	// The invariant in one line: one send failing must not cost the other.
	it('still runs the other send when one rejects, and logs the failure by role', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		let leadRan = false;

		await expect(
			settleSends('waitlist', [
				['ack', async () => Promise.reject(new Error('bounced'))],
				['lead', async () => void (leadRan = true)]
			])
		).resolves.toBeUndefined();

		expect(leadRan).toBe(true);
		expect(errSpy).toHaveBeenCalledTimes(1);
		// The label and the role, and nothing else — a recipient address here would be PII in a log.
		expect(errSpy.mock.calls[0][0]).toBe('waitlist ack email failed');
	});

	// THE CASE THE THUNK SIGNATURE IS FOR, and the one no caller-level test can reach: a builder that
	// throws where it is called, not on a later tick. Deliberately a NON-async thunk, because that is
	// what the type permits and what makes the throw synchronous — an `async` thunk would turn it into
	// a rejection and quietly test the case above instead.
	it('contains a SYNCHRONOUS throw from a thunk, without dropping the sibling send', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		let leadRan = false;
		const throwsWhereItIsCalled = (): Promise<void> => {
			throw new Error('builder blew up');
		};

		await expect(
			settleSends('contact', [
				['ack', throwsWhereItIsCalled],
				['lead', async () => void (leadRan = true)]
			])
		).resolves.toBeUndefined();

		expect(leadRan, 'the lead must survive a builder throw in the ack').toBe(true);
		expect(errSpy).toHaveBeenCalledTimes(1);
		expect(errSpy.mock.calls[0][0]).toBe('contact ack email failed');
	});

	// Order in, order out: the log names the role that actually failed. `allSettled` preserves input
	// order, and the logging loop indexes back into `senders` on that assumption — so a failure in the
	// FIRST slot must not be reported against the second's role.
	it('attributes a failure to the right role regardless of position', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await settleSends('contact', [
			['lead', async () => Promise.reject(new Error('x'))],
			['ack', ok]
		]);
		expect(errSpy).toHaveBeenCalledTimes(1);
		expect(errSpy.mock.calls[0][0]).toBe('contact lead email failed');
	});

	it('logs one line per failure when everything fails', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			settleSends('contact', [
				['lead', async () => Promise.reject(new Error('a'))],
				['ack', async () => Promise.reject(new Error('b'))]
			])
		).resolves.toBeUndefined();
		expect(errSpy.mock.calls.map((call) => call[0])).toEqual([
			'contact lead email failed',
			'contact ack email failed'
		]);
	});
});
