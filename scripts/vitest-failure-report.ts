// A vitest reporter that writes every RED unit run to disk, so the next unexplained failure names
// itself (DAR-90).
//
// The bug this closes is not in the app. During DAR-79 verification a second `pnpm test:unit --run`
// reported `Tests 1 failed | 590 passed (591)` — and the command had piped both runs through `grep`,
// so the failing test's NAME was never captured. A count, and nothing else. It has not recurred in
// 18+ green runs, which is exactly what makes it unfixable: there is no evidence left to reason
// from, and the one artifact that would have settled it was destroyed by the re-run that came next.
//
// DAR-90's remedy was an instruction to a human — "keep the full log before re-running". That is a
// discipline which has to be remembered at the precise moment nobody is thinking about it (something
// just went red; the reflex is to run it again), and it had already failed once: the ticket exists
// BECAUSE it failed. So it moves into the machine, the same way DAR-53's catalog convention became a
// spec and DAR-66's per-flow cap became a primary key. Piping through `grep` and immediately
// re-running can no longer destroy the evidence, because the evidence is not the terminal.
//
// Three properties are the difference between a useful artifact and a misleading one:
//
//   1. A red run with ZERO failed test cases is still recorded. A syntax error fails a module during
//      COLLECTION, so `allTests('failed')` is empty while the run is red — a reporter that only walks
//      failed cases writes "no failures" for it, which is worse than writing nothing at all.
//   2. Filenames are unique per run and never reused. A fixed path (which is all the built-in `json`
//      and `junit` reporters offer) would re-create the exact defect this exists to fix — the second
//      run overwrites the first one's evidence — just one directory further from the terminal.
//   3. Caps are explicit, never silent. A truncated report that looks complete is how you conclude
//      "only 200 things broke" when 591 did.
//
// It records the 10 slowest tests of the failing run on purpose. The standing theory for the
// original failure was "the machine was busy", and `loadavg` alone cannot settle that — but a
// baseline can: the slowest test in this suite is ~2.3s on an idle box, so a red run showing it at
// 4.9s proves load, and one showing 2.3s rules load out. That is the difference between a recurrence
// that closes DAR-90 and one that just re-opens it.
//
// Fail-soft throughout: a reporter that throws can turn a green run red, which would make this
// change strictly worse than the problem it addresses. Every entry point swallows and reports.

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import type { Reporter, SerializedError, TestModule, TestRunEndReason } from 'vitest/node';

/** Where reports land. Gitignored (which also excludes it from prettier + eslint), and uploaded by
 *  CI's unit job on failure. NOT `test-results/` — Playwright owns that and clears it per run. */
export const REPORT_DIR = 'test-failures';

/** Reports kept on disk, oldest pruned first. Only red runs write, so this is a long history. */
export const KEEP_REPORTS = 50;

/** Failures recorded per report. A run where everything fails needs a cause, not an enumeration. */
export const MAX_FAILURES = 200;

/** Characters kept per stack. Enough for the frames that name a file; not a megabyte of vitest. */
export const MAX_STACK_CHARS = 4000;

/** Slowest tests of the run recorded for context — the load discriminator described above. */
export const SLOWEST_SAMPLE = 10;

/** vitest's own timeout message, for every timeout flavour it emits (`Test`/`Hook timed out in …`). */
const TIMED_OUT = /\btimed out in \d+\s*ms/i;

// --- The shapes this reads ------------------------------------------------------------------
//
// Deliberately minimal structural interfaces rather than vitest's classes: the spec can then build
// plain literals with no `as unknown as TestCase` casts, while `FailureReportReporter.onTestRunEnd`
// — typed with the REAL `TestModule`/`SerializedError` — is what proves the shapes still match. A
// vitest API change fails `pnpm check` there instead of silently producing empty reports. Same
// reason `content-seo.ts` returns `Pick<SeoProps, …>` (DAR-71).

export interface ReportableError {
	readonly name?: string;
	readonly message?: string;
	readonly stack?: string;
}

export interface ReportableCase {
	readonly fullName: string;
	readonly project: { readonly name: string };
	readonly module: { readonly relativeModuleId: string };
	readonly location: { readonly line: number } | undefined;
	readonly options: { readonly timeout: number | undefined };
	result(): { readonly state: string; readonly errors: readonly ReportableError[] | undefined };
	diagnostic(): { readonly duration: number; readonly retryCount: number } | undefined;
}

export interface ReportableModule {
	readonly relativeModuleId: string;
	errors(): readonly ReportableError[];
	readonly children: { allTests(state?: string): Iterable<ReportableCase> };
}

// --- The record -----------------------------------------------------------------------------

export interface RecordedError {
	name: string | null;
	message: string;
	stack: string | null;
}

export interface RecordedFailure {
	project: string;
	file: string;
	line: number | null;
	test: string;
	durationMs: number | null;
	/** The test's effective timeout. Paired with `durationMs`, this is what makes a timeout legible
	 *  without having to know which project's defaults applied. */
	timeoutMs: number | null;
	timedOut: boolean;
	retryCount: number | null;
	errors: RecordedError[];
}

export interface RecordedTiming {
	test: string;
	file: string;
	durationMs: number;
	timeoutMs: number | null;
}

export interface FailureReport {
	recordedAt: string;
	reason: string;
	node: string;
	ci: boolean;
	machine: { cpus: number; loadavg: number[]; freeMemMb: number; totalMemMb: number };
	counts: {
		failedTests: number;
		collectionErrors: number;
		unhandledErrors: number;
		/** Failures beyond MAX_FAILURES. Non-zero means this report is a sample — say so. */
		omittedFailures: number;
	};
	failures: RecordedFailure[];
	collectionErrors: { file: string; error: RecordedError }[];
	unhandledErrors: RecordedError[];
	slowestTests: RecordedTiming[];
}

/** Everything the report reads from outside the test run, injected so the spec is deterministic. */
export interface ReportContext {
	recordedAt: string;
	node: string;
	ci: boolean;
	machine: { cpus: number; loadavg: number[]; freeMemMb: number; totalMemMb: number };
}

export function defaultContext(): ReportContext {
	const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
	return {
		recordedAt: new Date().toISOString(),
		node: process.version,
		ci: Boolean(process.env.CI),
		machine: {
			cpus: cpus().length,
			loadavg: loadavg().map((n) => Number(n.toFixed(2))),
			freeMemMb: mb(freemem()),
			totalMemMb: mb(totalmem())
		}
	};
}

function recordError(error: ReportableError): RecordedError {
	const stack = error.stack ?? null;
	return {
		name: error.name ?? null,
		message: error.message ?? '',
		stack:
			stack && stack.length > MAX_STACK_CHARS
				? `${stack.slice(0, MAX_STACK_CHARS)}\n… stack truncated at ${MAX_STACK_CHARS} characters`
				: stack
	};
}

function recordFailure(testCase: ReportableCase): RecordedFailure {
	const result = testCase.result();
	const diagnostic = testCase.diagnostic();
	const errors = (result.errors ?? []).map(recordError);
	return {
		project: testCase.project.name,
		file: testCase.module.relativeModuleId,
		line: testCase.location?.line ?? null,
		test: testCase.fullName,
		durationMs: diagnostic ? Math.round(diagnostic.duration) : null,
		timeoutMs: testCase.options.timeout ?? null,
		timedOut: errors.some((error) => TIMED_OUT.test(error.message)),
		retryCount: diagnostic ? diagnostic.retryCount : null,
		errors
	};
}

/**
 * Build the record for a finished run, or `null` when there is nothing to record — which is what
 * makes a green run write no file at all.
 *
 * `reason` is vitest's own end reason and is RECORDED, never consulted: what decides is whether
 * anything actually went wrong. So an interrupted run (Ctrl-C) that had already failed a test still
 * gets a record, and an interrupted-but-clean one still writes nothing.
 */
export function buildFailureReport(
	modules: readonly ReportableModule[],
	unhandledErrors: readonly ReportableError[],
	reason: string,
	context: ReportContext = defaultContext()
): FailureReport | null {
	const failed: ReportableCase[] = [];
	const collectionErrors: { file: string; error: RecordedError }[] = [];

	for (const module of modules) {
		for (const error of module.errors()) {
			collectionErrors.push({ file: module.relativeModuleId, error: recordError(error) });
		}
		for (const testCase of module.children.allTests()) {
			if (testCase.result().state === 'failed') failed.push(testCase);
		}
	}

	const unhandled = unhandledErrors.map(recordError);
	if (failed.length === 0 && collectionErrors.length === 0 && unhandled.length === 0) return null;

	// Only now walk for timings. A GREEN run is the common case — every normal run, several times an
	// hour — and it must not pay to assemble a report that is about to be discarded.
	const timings: RecordedTiming[] = [];
	for (const module of modules) {
		for (const testCase of module.children.allTests()) {
			const duration = testCase.diagnostic()?.duration;
			if (typeof duration === 'number') {
				timings.push({
					test: testCase.fullName,
					file: testCase.module.relativeModuleId,
					durationMs: Math.round(duration),
					timeoutMs: testCase.options.timeout ?? null
				});
			}
		}
	}

	return {
		recordedAt: context.recordedAt,
		reason,
		node: context.node,
		ci: context.ci,
		machine: context.machine,
		counts: {
			failedTests: failed.length,
			collectionErrors: collectionErrors.length,
			unhandledErrors: unhandled.length,
			omittedFailures: Math.max(0, failed.length - MAX_FAILURES)
		},
		failures: failed.slice(0, MAX_FAILURES).map(recordFailure),
		collectionErrors,
		unhandledErrors: unhandled,
		slowestTests: timings.sort((a, b) => b.durationMs - a.durationMs).slice(0, SLOWEST_SAMPLE)
	};
}

/** Delete all but the newest `keep` reports. Names are ISO-stamped, so lexical order is chronological. */
export function pruneReports(dir: string, keep: number): string[] {
	try {
		const reports = readdirSync(dir)
			.filter((name) => name.endsWith('.json'))
			.sort();
		const doomed = reports.slice(0, Math.max(0, reports.length - keep));
		for (const name of doomed) {
			try {
				unlinkSync(join(dir, name));
			} catch {
				// Someone else's cleanup won the race. Nothing to do.
			}
		}
		return doomed;
	} catch {
		return [];
	}
}

/**
 * Write the report under a name no other run can take, and return its path — or `null` if anything
 * about the filesystem said no. Recording a failure must never itself become one.
 */
export function writeFailureReport(
	report: FailureReport,
	options: { dir?: string; keep?: number; pid?: number } = {}
): string | null {
	const { dir = REPORT_DIR, keep = KEEP_REPORTS, pid = process.pid } = options;
	try {
		mkdirSync(dir, { recursive: true });
		// Colons are illegal in filenames on Windows and awkward in shell arguments everywhere; the
		// pid keeps two runs that start in the same millisecond apart.
		const path = join(dir, `${report.recordedAt.replace(/[:.]/g, '-')}-${pid}.json`);
		writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
		pruneReports(dir, keep);
		return path;
	} catch {
		return null;
	}
}

/**
 * The line a red run prints. Only what actually happened is named — a collection-only failure must
 * not announce "0 failed tests", which reads as though the reporter mis-saw the run it is reporting.
 */
export function describeReport(report: FailureReport, path: string): string {
	const { failedTests, collectionErrors, unhandledErrors } = report.counts;
	const parts: string[] = [];
	if (failedTests > 0) parts.push(`${failedTests} failed test${failedTests === 1 ? '' : 's'}`);
	if (collectionErrors > 0) {
		parts.push(`${collectionErrors} collection error${collectionErrors === 1 ? '' : 's'}`);
	}
	if (unhandledErrors > 0) {
		parts.push(`${unhandledErrors} unhandled error${unhandledErrors === 1 ? '' : 's'}`);
	}
	return (
		`\n▸ recorded ${parts.join(', ')} → ${path}\n` +
		'  Keep it: re-running the suite destroys the log, but not this (DAR-90).'
	);
}

export class FailureReportReporter implements Reporter {
	readonly #dir: string;

	constructor(options: { dir?: string } = {}) {
		this.#dir = options.dir ?? REPORT_DIR;
	}

	onTestRunEnd(
		testModules: ReadonlyArray<TestModule>,
		unhandledErrors: ReadonlyArray<SerializedError>,
		reason: TestRunEndReason
	): void {
		try {
			const report = buildFailureReport(testModules, unhandledErrors, reason);
			if (!report) return;
			const path = writeFailureReport(report, { dir: this.#dir });
			if (!path) {
				// The one failure mode this whole file exists to prevent is losing the record without
				// knowing it, so a failed write has to be louder than no write at all.
				console.error(
					`\n▸ this run FAILED and could not be recorded — ${this.#dir}/ was not writable.\n` +
						'  Keep the terminal output; re-running will not reproduce it (DAR-90).'
				);
				return;
			}
			console.error(describeReport(report, path));
		} catch (error) {
			// Never let bookkeeping fail a run — but never fail it silently either.
			console.error(`▸ could not record this run's failures: ${error}`);
		}
	}
}

// A CLI `--reporter=<name>` REPLACES the configured reporters rather than adding to them, which
// silently switches this off — and `--reporter=verbose` is exactly what you reach for while chasing
// a flake, the one moment the record matters most. The default export is the way back:
//   pnpm test:unit --run --reporter=verbose --reporter=./scripts/vitest-failure-report.ts
export default FailureReportReporter;
