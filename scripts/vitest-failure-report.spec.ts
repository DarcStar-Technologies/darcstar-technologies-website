import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
	buildFailureReport,
	describeReport,
	MAX_FAILURES,
	MAX_STACK_CHARS,
	pruneReports,
	SLOWEST_SAMPLE,
	writeFailureReport,
	type ReportableCase,
	type ReportableError,
	type ReportableModule,
	type ReportContext
} from './vitest-failure-report';

// The reporter that records red unit runs (DAR-90). These fakes are plain literals on purpose: the
// interfaces are structural, and the REAL conformance to vitest's classes is proven by
// FailureReportReporter.onTestRunEnd being typed with them — so nothing here needs a cast, and a
// vitest API change surfaces in `pnpm check` rather than as a silently empty report.

const CONTEXT: ReportContext = {
	recordedAt: '2026-07-27T04:00:00.000Z',
	node: 'v24.0.0',
	ci: false,
	machine: { cpus: 8, loadavg: [1, 2, 3], freeMemMb: 1000, totalMemMb: 2000 }
};

function testCase(
	options: {
		name?: string;
		project?: string;
		file?: string;
		line?: number;
		timeout?: number;
		duration?: number;
		retryCount?: number;
		state?: string;
		errors?: ReportableError[];
	} = {}
): ReportableCase {
	const {
		name = 'a failing test',
		project = 'server',
		file = 'src/thing.spec.ts',
		line = 12,
		timeout = 5000,
		duration = 42,
		retryCount = 0,
		state = 'failed',
		errors = [{ name: 'AssertionError', message: 'expected 2 to be 3', stack: 'at foo()' }]
	} = options;
	return {
		fullName: name,
		project: { name: project },
		module: { relativeModuleId: file },
		location: { line },
		options: { timeout },
		result: () => ({ state, errors: state === 'failed' ? errors : undefined }),
		diagnostic: () => ({ duration, retryCount })
	};
}

function testModule(
	relativeModuleId: string,
	cases: ReportableCase[],
	errors: ReportableError[] = []
): ReportableModule {
	return {
		relativeModuleId,
		errors: () => errors,
		// Honours the state filter like the real TestCollection does, so a future switch to
		// `allTests('failed')` is exercised here rather than masked by a fake that ignores its argument.
		children: {
			allTests: (state?: string) =>
				state === undefined ? cases : cases.filter((c) => c.result().state === state)
		}
	};
}

// Every temp dir is registered so the suite doesn't leave a handful behind in /tmp on each of the
// many runs a day this repo does.
const scratchDirs: string[] = [];

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'dar90-'));
	scratchDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('buildFailureReport', () => {
	// The property that keeps this reporter invisible in normal use: a green run leaves no file, so
	// anything in test-failures/ is by construction evidence of a red one.
	test('a green run records nothing at all', () => {
		const modules = [testModule('src/a.spec.ts', [testCase({ state: 'passed' })])];

		expect(buildFailureReport(modules, [], 'passed', CONTEXT)).toBeNull();
	});

	test('a failed test is recorded with the fields needed to find it again', () => {
		const modules = [
			testModule('src/a.spec.ts', [
				testCase({ name: 'suite > breaks', file: 'src/a.spec.ts', line: 30, duration: 42 })
			])
		];

		const report = buildFailureReport(modules, [], 'failed', CONTEXT);

		expect(report?.failures).toEqual([
			{
				project: 'server',
				file: 'src/a.spec.ts',
				line: 30,
				test: 'suite > breaks',
				durationMs: 42,
				timeoutMs: 5000,
				timedOut: false,
				retryCount: 0,
				errors: [{ name: 'AssertionError', message: 'expected 2 to be 3', stack: 'at foo()' }]
			}
		]);
		expect(report?.counts).toEqual({
			failedTests: 1,
			collectionErrors: 0,
			unhandledErrors: 0,
			omittedFailures: 0
		});
	});

	// `timedOut` reads vitest's own message rather than comparing duration to timeout — the whole
	// point is to tell "the machine was too slow" apart from "the assertion was wrong", and a
	// duration-vs-timeout threshold would be a guess at exactly the moment precision matters.
	test('a timeout is flagged as one; an assertion failure is not', () => {
		const timedOut = [
			testModule('src/a.spec.ts', [
				testCase({ errors: [{ message: 'Test timed out in 5000ms.' }] })
			])
		];
		const asserted = [
			testModule('src/a.spec.ts', [testCase({ errors: [{ message: 'expected 2 to be 3' }] })])
		];

		expect(buildFailureReport(timedOut, [], 'failed', CONTEXT)?.failures[0].timedOut).toBe(true);
		expect(buildFailureReport(asserted, [], 'failed', CONTEXT)?.failures[0].timedOut).toBe(false);
	});

	// A module that throws while being imported fails during COLLECTION: the run is red and
	// `allTests('failed')` is empty. A reporter that only walks failed cases writes "no failures"
	// for it — an artifact that actively misleads. Verified live against a throwing module too.
	test('a collection error is recorded even though no test case failed', () => {
		const modules = [
			testModule('src/broken.spec.ts', [], [{ name: 'Error', message: 'boom at import' }])
		];

		const report = buildFailureReport(modules, [], 'failed', CONTEXT);

		expect(report?.counts.failedTests).toBe(0);
		expect(report?.collectionErrors).toEqual([
			{
				file: 'src/broken.spec.ts',
				error: { name: 'Error', message: 'boom at import', stack: null }
			}
		]);
	});

	test('an unhandled error alone is enough to record a run', () => {
		const report = buildFailureReport([], [{ message: 'unhandled rejection' }], 'failed', CONTEXT);

		expect(report?.counts.unhandledErrors).toBe(1);
		expect(report?.unhandledErrors[0].message).toBe('unhandled rejection');
	});

	// Caps must never read as "that was everything" — the count of what was dropped ships with the
	// sample that replaced it.
	test('more failures than the cap are truncated, and the report says by how many', () => {
		const cases = Array.from({ length: MAX_FAILURES + 7 }, (_, i) => testCase({ name: `t${i}` }));
		const report = buildFailureReport([testModule('src/a.spec.ts', cases)], [], 'failed', CONTEXT);

		expect(report?.failures).toHaveLength(MAX_FAILURES);
		expect(report?.counts).toMatchObject({ failedTests: MAX_FAILURES + 7, omittedFailures: 7 });
	});

	test('a long stack is truncated, and says so in the stack itself', () => {
		const modules = [
			testModule('src/a.spec.ts', [
				testCase({ errors: [{ message: 'x', stack: 'y'.repeat(9_000) }] })
			])
		];

		const stack = buildFailureReport(modules, [], 'failed', CONTEXT)?.failures[0].errors[0].stack;

		expect(stack).toContain('stack truncated');
		expect(stack!.length).toBeLessThan(MAX_STACK_CHARS + 100);
	});

	// The load discriminator: a recurrence is only diagnosable against a baseline of how long these
	// tests take when nothing is wrong, so the slowest tests of the run ride along — passing ones
	// included, which is the point.
	test('the slowest tests of the run are recorded, longest first, passing ones included', () => {
		const modules = [
			testModule('src/a.spec.ts', [
				testCase({ name: 'quick', state: 'passed', duration: 5 }),
				testCase({ name: 'slow', state: 'passed', duration: 4_900 }),
				testCase({ name: 'broken', state: 'failed', duration: 100 })
			])
		];

		const slowest = buildFailureReport(modules, [], 'failed', CONTEXT)?.slowestTests;

		expect(slowest?.map((t) => t.test)).toEqual(['slow', 'broken', 'quick']);
		expect(slowest?.[0]).toMatchObject({ durationMs: 4_900, timeoutMs: 5000 });
	});

	test('the slowest-test sample is capped', () => {
		const cases = Array.from({ length: SLOWEST_SAMPLE + 5 }, (_, i) =>
			testCase({ name: `t${i}`, duration: i })
		);

		const report = buildFailureReport([testModule('src/a.spec.ts', cases)], [], 'failed', CONTEXT);

		expect(report?.slowestTests).toHaveLength(SLOWEST_SAMPLE);
	});
});

describe('describeReport', () => {
	// A collection-only failure announcing "0 failed tests" reads as though the reporter mis-saw the
	// run it is reporting — the one impression an evidence artifact cannot afford to give.
	test('names only what actually happened', () => {
		const report = buildFailureReport(
			[testModule('src/broken.spec.ts', [], [{ message: 'boom at import' }])],
			[],
			'failed',
			CONTEXT
		)!;

		const line = describeReport(report, 'test-failures/x.json');

		expect(line).toContain('1 collection error');
		expect(line).not.toContain('0 failed tests');
	});

	test('pluralises against the counts it reports', () => {
		const one = buildFailureReport(
			[testModule('src/a.spec.ts', [testCase()])],
			[],
			'failed',
			CONTEXT
		)!;
		const two = buildFailureReport(
			[testModule('src/a.spec.ts', [testCase({ name: 'a' }), testCase({ name: 'b' })])],
			[],
			'failed',
			CONTEXT
		)!;

		expect(describeReport(one, 'p')).toContain('1 failed test →');
		expect(describeReport(two, 'p')).toContain('2 failed tests');
	});
});

describe('writeFailureReport', () => {
	test('writes the report under a name that carries no colons and is unique per run', () => {
		const dir = tempDir();
		const report = buildFailureReport(
			[testModule('src/a.spec.ts', [testCase()])],
			[],
			'failed',
			CONTEXT
		)!;

		const first = writeFailureReport(report, { dir, pid: 111 });
		const second = writeFailureReport(report, { dir, pid: 222 });

		expect(first).not.toBe(second);
		expect(basename(first!)).not.toContain(':');
		expect(JSON.parse(readFileSync(first!, 'utf8')).failures[0].test).toBe('a failing test');
		expect(readdirSync(dir)).toHaveLength(2);
	});

	// Recording a failure must never become one. A reporter that throws can turn a green run red,
	// which would make this change strictly worse than the problem it addresses.
	test('returns null instead of throwing when the directory cannot be created', () => {
		const blocked = join(tempDir(), 'a-file');
		writeFileSync(blocked, 'not a directory');
		const report = buildFailureReport(
			[testModule('src/a.spec.ts', [testCase()])],
			[],
			'failed',
			CONTEXT
		)!;

		expect(writeFailureReport(report, { dir: join(blocked, 'nested') })).toBeNull();
	});
});

describe('pruneReports', () => {
	// ISO-stamped names, so lexical order is chronological and the newest survive.
	test('keeps the newest reports and deletes the rest', () => {
		const dir = tempDir();
		const names = [
			'2026-07-01T00-00-00-000Z-1.json',
			'2026-07-02T00-00-00-000Z-1.json',
			'2026-07-03T00-00-00-000Z-1.json'
		];
		for (const name of names) writeFileSync(join(dir, name), '{}');

		const deleted = pruneReports(dir, 2);

		expect(deleted).toEqual([names[0]]);
		expect(readdirSync(dir).sort()).toEqual([names[1], names[2]]);
	});

	test('a missing directory prunes nothing rather than throwing', () => {
		expect(pruneReports(join(tempDir(), 'never-created'), 5)).toEqual([]);
	});
});
