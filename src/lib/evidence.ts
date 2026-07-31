// Single source for the marketed evidence figures (DAR-43). The homepage readouts, the
// /evidence claim-card values, and the parameterized evidence_* message prose all consume
// THESE values, so the claim surface and the evidence surface cannot drift apart — the drift
// risk the evidence page exists to eliminate. Provenance for every number + the update rules
// (a figure and its card's dated line change together) live in docs/evidence.md.
import { m } from '$lib/paraglide/messages.js';

/** The control-loop period GIDE targets — 100 Hz, so 10 ms — in microseconds. Every real-time
 * margin the site publishes is this ÷ a measured latency; not one of them is measured separately.
 *
 * Deliberately NOT exported. evidence-boundary.spec.ts holds this module to exporting no number
 * above the theorem count we publish, which is what stops a catalog total arriving here as a bare
 * constant (DAR-152), and nothing outside needs the budget — the margins below are what renders.
 * The specs restate it instead of importing it, on purpose: a test that took the numerator from
 * this module would be checking the arithmetic against itself. */
const CONTROL_BUDGET_US = 10_000;

/** en-formatted, like every other figure on these surfaces — card values are locale-invariant data
 * (docs/evidence.md). Hand-rolled rather than `toLocaleString`, which would put the largest figure
 * on the homepage at the mercy of the runtime's ICU build. */
const withThousandsSeparators = (value: number) =>
	String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * A published real-time margin: the control budget ÷ a measured latency, rounded DOWN.
 *
 * Both halves are deliberate (DAR-209). **Down, never up** — the margin is the one figure on these
 * pages we benefit from overstating, so the rounding is fixed in the direction that costs us:
 * 10 ms ÷ 52 µs is 192.3, which publishes as 190×, where a one-significant-figure round would say
 * 200×. **Two significant figures**, because the deployed-controller latency is noisy by its own
 * source's account (see `evidence_bench_controller_environment`) and a third digit would claim a
 * precision the measurement does not have.
 *
 * Written for the margins this site publishes, all of which are three or four digits.
 */
export function realtimeMargin(latencyUs: number): string {
	const ratio = CONTROL_BUDGET_US / latencyUs;
	const step = 10 ** (Math.floor(Math.log10(ratio)) - 1);
	return `${withThousandsSeparators(Math.floor(ratio / step) * step)}×`;
}

/** Mean single-cell CfC forward pass of the reference kernel (NOT the deployed controller),
 * measured December 2025. Exact kernel dimensions are deliberately unstated — see the IP
 * boundary in docs/evidence.md. */
const CFC_KERNEL_LATENCY_US = 0.767;
export const CFC_KERNEL_LATENCY = `${CFC_KERNEL_LATENCY_US} µs`;

/** Derived, never separately measured: the control budget ÷ the measured kernel latency above.
 * Byte-identical to the `'13,000×'` string this replaced — it is computed now so that no margin
 * on the site is hand-typed beside two that are not (DAR-209). */
export const REALTIME_MULTIPLE = realtimeMargin(CFC_KERNEL_LATENCY_US);

/** The DEPLOYED end-to-end controller, per outer control cycle — the figure to cite for
 * whole-controller latency, an order of magnitude above the reference kernel. Both percentiles
 * come from one attributed capture (GIDE `benchmarks/results/quadrotor-cascade--run1.txt`,
 * July 2026) and are rounded to whole microseconds: p50 51.548, p99 98.654.
 *
 * The p99 was published as ≈94 µs until DAR-209. That number is in the capture's own headline
 * COMMENT, which its data table contradicts — so the site was stating a tail no artifact contains,
 * and understating it, which flatters the margin derived from it. Read the table, not the prose
 * summarising it.
 *
 * Both are the slowest figures on record: the source's stated run-to-run swing is ~44–52 µs at p50
 * and ~77–95 µs at p99, and this capture's own p99 sits above even that. Slowest is the
 * conservative direction for a claim about clearing a real-time budget. */
const CONTROLLER_LATENCY_P50_US = 52;
const CONTROLLER_LATENCY_P99_US = 99;
export const CONTROLLER_LATENCY_P50 = `≈${CONTROLLER_LATENCY_P50_US} µs`;
export const CONTROLLER_LATENCY_P99 = `≈${CONTROLLER_LATENCY_P99_US} µs`;

/** Derived exactly like REALTIME_MULTIPLE, but one per percentile — because a single margin over a
 * p50/p99 pair does not say which latency it came from, and a reviewer recomputing it gets a
 * different answer depending on which they pick (DAR-209). Under a real-time budget the TAIL is
 * what decides whether the loop holds, so p99 is the load-bearing one; p50 is published beside it,
 * never instead of it. */
export const CONTROLLER_MARGIN_P50 = realtimeMargin(CONTROLLER_LATENCY_P50_US);
export const CONTROLLER_MARGIN_P99 = realtimeMargin(CONTROLLER_LATENCY_P99_US);

// Machine-checked theorem counts, measured 2026-07-29 against the GIDE hub's theorem catalog and
// conformance registry: complete (dual-prover, zero local axioms) + axiom-backed. Deliberately
// NOT here: the catalog total / not-yet-mechanized remainder — the public surface states what IS
// proven, not the backlog (evidence-boundary.ts derives that guard FROM the checked total below,
// so re-measuring moves the boundary automatically; nothing else to update).
//
// Dated to a MEASUREMENT, not a release (DAR-152). These figures were previously labelled "as of
// release v2026.07.1", which that tag never held — it carried 22/131/153, roughly six weeks of
// work behind. Only one release tag exists, so there is no tag carrying a current count; a
// measurement date is the claim we can actually make. Re-measure → change these two numbers and
// evidence_theorems_dated together, never one alone.
export const THEOREMS_COMPLETE = 49;
export const THEOREMS_AXIOM_BACKED = 211;
export const THEOREMS_CHECKED = THEOREMS_COMPLETE + THEOREMS_AXIOM_BACKED;

/** The shipped-domain spine, ordered. Message references stay UNCALLED here so render sites
 * resolve them under the active locale. The homepage domain rows, its "domains running
 * end-to-end" readout, and the /evidence domains card all iterate THIS list — count, order,
 * and names can't fork between the surfaces (neither surface restates the count in prose
 * either, since DAR-46). `home` is the homepage row description; `evidence` is the claim
 * card's maturity-honest body. Each surface defines the term IT uses for the count —
 * section_domains_scope defines "running end-to-end" on the homepage, evidence_domains_claim
 * defines "shipped" on /evidence — and both rule out a demo or a customer deployment. */
export const DOMAINS = [
	{
		name: m.domain_cartpole_name,
		home: m.domain_cartpole_desc,
		evidence: m.evidence_domain_cartpole_body
	},
	{
		name: m.domain_quadrotor_name,
		home: m.domain_quadrotor_desc,
		evidence: m.evidence_domain_quadrotor_body
	},
	{
		name: m.domain_markets_name,
		home: m.domain_markets_desc,
		evidence: m.evidence_domain_markets_body
	},
	{ name: m.domain_llm_name, home: m.domain_llm_desc, evidence: m.evidence_domain_llm_body },
	{
		name: m.domain_selfdev_name,
		home: m.domain_selfdev_desc,
		evidence: m.evidence_domain_selfdev_body
	}
];
