# Evidence page — /evidence (DAR-43)

The public, IP-safe backing for every major homepage claim. One **lean** claim card per
claim — the exact claim + its date/version, a methodology summary, and **what the claim does
not cover** — linking to two depth pages: `/evidence/benchmarks` (run-level environment,
per-run figures, attribution, artifacts) and `/evidence/proofs` (what proven means, prover
versions, methodology, trust boundary). Plus the IP boundary (what stays private, and the NDA
route for qualified partners).

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
| 219 theorems machine-checked | `docs/theoretical-framework/THEOREM-CATALOG-0001.md` + `src/core/services/axiomatic/theorem_conformance.zig` (CI census gate keeps them consistent): 31 complete (dual-prover, zero local axioms) + 188 axiom-backed, as of release v2026.07.1                                                                                                      |
| Formal safety guarantees     | The complete zero-axiom cluster: T026 (Nagumo forward invariance), T072 (CBF safe-control existence + minimally-invasive QP), T073 (robust Nagumo under learning), T090–T096 (latency margin, keep-out) in `proofs/Layer1/` — Lean 4 v4.30.0 + Isabelle2025-2/AFP 2026-06-01, SMT portfolio Z3 4.16.0 / CVC5 1.3.4 / Yices2 2.6.5 / dReal 4.21.06.2 |
| 5 domains shipped            | `src/domains/{cart_pole,quadrotor,fx,llm,self_dev}`; Self-Dev is explicitly pre-milestone ("approaching its first fully autonomous cycle") and the card says so                                                                                                                                                                                     |

## Rules when editing

- **The figures live in ONE module: `src/lib/evidence.ts`.** The homepage readouts, the
  /evidence card values, and the number-bearing message prose (via Paraglide `{param}`s —
  `evidence_theorems_claim` etc.) all consume those constants, and `DOMAINS` is the shared
  domain spine (count, order, names) both surfaces iterate. Re-measure → change the constant
  (plus the card's `*_dated` line) and every surface follows; never re-inline a figure. The
  e2e pins the rendered `219` on both pages, so a partial edit fails loudly.
- **Numbers are dated claims.** A figure and its `*_dated` line change together, never
  alone. Re-measured → update both; don't quietly bump a figure.
- **The theorems figure is the machine-checked count** from the conformance registry
  (`.met = true` = complete + axiom-backed) — NOT the Layer-1 catalog size. The site shipped
  "150 theorems proven" for a while; that was the Layer-1 count, not a proven count, and
  DAR-43 corrected it to 219 (`THEOREMS_CHECKED`). Don't reintroduce it.
- **Never claim a proven latency bound.** GIDE's proof corpus proves no microsecond/latency
  bound anywhere; latency is measured, the 13,000× is derived. The internal whitepaper is
  explicit that "proven microsecond safety" phrasing would be falsified on review.
- **Claims are qualified everywhere, not just on /evidence (DAR-46).** The published
  formulation is _"formally verified against stated system and environment assumptions"_ —
  never "proven safe" / "provably safe" / "guaranteed safe". The 2026-07-23 review found the
  homepage and /about asserting safety as a settled conclusion ("Every safety guarantee is
  machine-checked", "when GIDE says a system is safe, there is a proof") while /evidence
  defined `proven` narrowly two clicks away. The split that survives: a **heading** may claim
  provability (the H1s "Autonomous control you can _prove_ is safe." and "_Provable_ safety for
  autonomous systems." are kept deliberately — provable is true), but the **body copy under it
  must name the assumptions and the boundary**. `src/lib/safety-language.spec.ts` guards the
  phrasing across both locale catalogs, with one allowlisted key —
  `evidence_safety_not_covered` quotes "proven microsecond safety" in order to disavow it, and
  a second assertion fails if that key stops quoting it (a stale allowlist is a silent hole).
- **Say what the domain count means wherever it appears.** The review read "five domains
  shipped" as possibly meaning pilots or customer deployments. Each surface now defines the term
  _it actually uses_: the homepage readout is labelled `domains running end-to-end` and
  `section_domains_scope` defines **that** phrase under the domain list; /evidence keeps the
  "Domains shipped" card and defines **shipped** in its claim sentence. Both spell out what the
  count is _not_ (a demo, a customer deployment) — so nothing elsewhere may imply customer
  delivery: `about_principle_oneengine_body` says the verified core **runs** from quadrotors to
  financial markets, deliberately not "ships". Neither surface restates the count in prose —
  both render `DOMAINS.length`, so a sixth domain can't leave a stale "Five" behind.
- **Scope 0.767 µs to the reference kernel.** The GIDE repo itself forbids citing it as "the
  controller latency" — the deployed controller is ≈52 µs p50 / ≈94 µs p99. Per-run
  provenance detail (ARM 0.75 attributed; committed x86 re-runs 0.81–0.91) lives ONLY in the
  `evidence_bench_*` messages on /evidence/benchmarks — keep the ARM/x86 attribution
  straight, they are different machines.
- The card headline values are **data, locale-invariant** (en-formatted), same convention as
  the homepage readouts; all prose is Paraglide messages.
- **Two detail sub-pages carry the depth; the cards stay lean and link to them**
  (`inlineLinkClass` "more" links): `/evidence/benchmarks` = run-level latency detail
  (per-run figures, environment, attribution incl. the logged gap, deployed-controller
  latency, artifacts); `/evidence/proofs` = what machine-checked means (complete vs
  axiom-backed definition, provers/checkers, methodology, trust boundary). Both are
  registered indexable routes (sitemap `STATIC_PATHS` ×2 + security-headers
  `AUDITED_PAGES`) — mirror that for any future sub-route.
- **Deliberately NOT published anywhere** (beyond the ticket's IP list): exact neural
  architecture numbers (hidden dims, parameter counts — an architecture fingerprint), and
  the theorem-catalog total / not-yet-mechanized remainder (the surface states what IS
  proven, not the backlog). Two guards enforce it on **copy**:
  `src/lib/evidence-boundary.spec.ts` scans the message catalog (every key, both locale
  files; the word-form check scoped to the `evidence_*`/`domain_*` keys the evidence pages
  render) **plus the `$lib/evidence` constants** that supply the card values, and the
  evidence e2e asserts the rendered absences. A hit means reword the copy — never loosen the
  pattern.
- The rule covers **source comments too** — this repo is public, and the DAR-43 review found
  an `h=16` in a doc-comment — but **no automated guard reads comments**: a pattern scan over
  source false-positives immediately ("parameter" is legitimate prose in these files), so
  comments are **code-review territory**. Read them when reviewing; don't trust CI for this.
