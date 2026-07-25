// Single source for the marketed evidence figures (DAR-43). The homepage readouts, the
// /evidence claim-card values, and the parameterized evidence_* message prose all consume
// THESE values, so the claim surface and the evidence surface cannot drift apart — the drift
// risk the evidence page exists to eliminate. Provenance for every number + the update rules
// (a figure and its card's dated line change together) live in docs/evidence.md.
import { m } from '$lib/paraglide/messages.js';

/** Mean single-cell CfC forward pass of the reference kernel (NOT the deployed controller),
 * measured December 2025. Exact kernel dimensions are deliberately unstated — see the IP
 * boundary in docs/evidence.md. */
export const CFC_KERNEL_LATENCY = '0.767 µs';

/** Derived, never separately measured: the 10 ms (100 Hz) control budget ÷ the measured
 * kernel latency above. */
export const REALTIME_MULTIPLE = '13,000×';

// Machine-checked theorem counts as of GIDE release v2026.07.1 (July 2026): complete
// (dual-prover, zero local axioms) + axiom-backed. Deliberately NOT here: the catalog total /
// not-yet-mechanized remainder — the public surface states what IS proven, not the backlog.
export const THEOREMS_COMPLETE = 31;
export const THEOREMS_AXIOM_BACKED = 188;
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
