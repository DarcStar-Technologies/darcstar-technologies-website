# Evidence page — /evidence (DAR-43)

The public, IP-safe backing for every major homepage claim. One claim card per claim, each
carrying: the exact claim + its date/version, environment, methodology, assumptions, prover
versions, **what the claim does not cover**, and the artifact/verification path — plus the IP
boundary (what stays private, and the NDA route for qualified partners).

Content-only page on the `/privacy` mold: no loader, all copy in Paraglide messages
(`evidence_*` keys), shared `PageHero` + `LegalSection`, claim cards rendered from a data
array in `src/routes/evidence/+page.svelte`.

## Where the facts come from (provenance)

Every figure was transcribed from the GIDE hub's own source-of-record documents (July 2026
audit — this repo holds only the public prose, never the artifacts):

| Card                         | Source of record (in `../gide`)                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.767 µs CfC inference       | `docs/benchmarks/cfc-controller-performance.md` (mean of 10,000 calls / 1,000 warmup, Dec 2025) + `benchmarks/results/README.md` (attribution ledger: that run is UNATTRIBUTED; the ARM Neoverse-N2 log is the attributed cross-check at 0.75 µs)                                                                                                   |
| 13,000× real time            | Derived, never measured: 10 ms (100 Hz budget) ÷ 0.767 µs ≈ 13,000 (`docs/project-overview.md`)                                                                                                                                                                                                                                                     |
| 219 theorems machine-checked | `docs/theoretical-framework/THEOREM-CATALOG-0001.md` + `src/core/services/axiomatic/theorem_conformance.zig` (CI census gate keeps them consistent): 31 complete (dual-prover, zero local axioms) + 188 axiom-backed, of 338 catalogued, as of release v2026.07.1                                                                                   |
| Formal safety guarantees     | The complete zero-axiom cluster: T026 (Nagumo forward invariance), T072 (CBF safe-control existence + minimally-invasive QP), T073 (robust Nagumo under learning), T090–T096 (latency margin, keep-out) in `proofs/Layer1/` — Lean 4 v4.30.0 + Isabelle2025-2/AFP 2026-06-01, SMT portfolio Z3 4.16.0 / CVC5 1.3.4 / Yices2 2.6.5 / dReal 4.21.06.2 |
| 5 domains shipped            | `src/domains/{cart_pole,quadrotor,fx,llm,self_dev}`; Self-Dev is explicitly pre-milestone ("approaching its first fully autonomous cycle") and the card says so                                                                                                                                                                                     |

## Rules when editing

- **Numbers are dated claims.** A card's value and its `*_dated` line change together, never
  alone. Re-measured → update both; don't quietly bump a figure.
- **The homepage readouts must agree with the cards** (`src/routes/+page.svelte` stats row
  links to /evidence). The theorems figure on both surfaces is the **machine-checked count**
  from the conformance registry (`.met = true` = complete + axiom-backed) — NOT the Layer-1
  catalog size. The site shipped "150 theorems proven" for a while; that was the Layer-1
  count, not a proven count, and DAR-43 corrected it to 219. Don't reintroduce it.
- **Never claim a proven latency bound.** GIDE's proof corpus proves no microsecond/latency
  bound anywhere; latency is measured, the 13,000× is derived. The internal whitepaper is
  explicit that "proven microsecond safety" phrasing would be falsified on review.
- **Scope 0.767 µs to the reference kernel.** The GIDE repo itself forbids citing it as "the
  controller latency" — the deployed quadrotor cascade is ≈52 µs p50 / ≈94 µs p99.
- The card headline values are **data in the component** (en-formatted, locale-invariant),
  same convention as the homepage readouts; all prose is Paraglide messages.
- New indexable route obligations were done for /evidence (sitemap `STATIC_PATHS` ×2 +
  security-headers `AUDITED_PAGES`) — mirror that if this page ever gains sub-routes.
