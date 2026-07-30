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

| Card                         | Source of record (in `../gide`)                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.767 µs CfC inference       | `docs/benchmarks/cfc-controller-performance.md` (mean of 10,000 calls / 1,000 warmup, Dec 2025) + `benchmarks/results/README.md` (attribution ledger: that run is UNATTRIBUTED; the ARM Neoverse-N2 log is the attributed cross-check at 0.75 µs)                                                                                                                                        |
| 13,000× real time            | Derived, never measured: 10 ms (100 Hz budget) ÷ 0.767 µs ≈ 13,000 (`docs/project-overview.md`)                                                                                                                                                                                                                                                                                          |
| 260 theorems machine-checked | `docs/theoretical-framework/THEOREM-CATALOG-0001.md` + `src/core/services/axiomatic/theorem_conformance.zig` (CI census gate keeps them consistent): 49 complete (dual-prover, zero local axioms) + 211 axiom-backed. **Measured against hub `main` on 2026-07-29**, cross-checked between the catalog's distribution table and the registry's `.met` count — see the vintage rule below |
| Formal safety guarantees     | The complete zero-axiom cluster: T026 (Nagumo forward invariance), T072 (CBF safe-control existence + minimally-invasive QP), T073 (robust Nagumo under learning), T090–T096 (latency margin, keep-out) in `proofs/Layer1/` — Lean 4 v4.30.0 + Isabelle2025-2/AFP 2026-06-01, SMT portfolio Z3 4.16.0 / CVC5 1.3.4 / Yices2 2.6.5 / dReal 4.21.06.2                                      |
| 5 domains shipped            | `src/domains/{cart_pole,quadrotor,fx,llm,self_dev}`; Self-Dev is explicitly pre-milestone ("approaching its first fully autonomous cycle") and the card says so                                                                                                                                                                                                                          |

## Rules when editing

- **The figures live in ONE module: `src/lib/evidence.ts`.** The homepage readouts, the
  /evidence card values, and the number-bearing message prose (via Paraglide `{param}`s —
  `evidence_theorems_claim` etc.) all consume those constants, and `DOMAINS` is the shared
  domain spine (count, order, names) both surfaces iterate. Re-measure → change the constant
  (plus the card's `*_dated` line) and every surface follows; never re-inline a figure. The e2e
  pins the rendered figures on both pages — reading them FROM the constants, so a re-measure
  updates the assertions with the copy and a partial edit still fails loudly.
- **Numbers are dated claims.** A figure and its `*_dated` line change together, never
  alone. Re-measured → update both; don't quietly bump a figure.
- **The theorem figures are dated to a MEASUREMENT, not a release (DAR-152)** — `Measured 29 July
2026 · GIDE conformance registry`, and that phrasing is the fix rather than a shortcut. They
  used to read "As of GIDE release v2026.07.1", a tag that **never held them**: it carried
  22/131/153, about six weeks behind, while 31/188/219 had been transcribed from hub `main` mid-way
  through DAR-43. So the number was real and the provenance line was not — on the one page whose
  stated purpose is dated claims. Re-dating to the tag was rejected (it would have downgraded the
  homepage headline from 31 to 22, and the tag is stale anyway); keeping the figures and fixing
  only the date was rejected as needlessly weak. **There is exactly one release tag**, so no tag
  carries a current count and a measurement date is the strongest claim available. Two
  consequences: re-measure **both** halves from the hub in one pass (the catalog's distribution
  table AND the registry's `.met` count — they are kept consistent by a CI census gate, so a
  disagreement means read the gate, not pick one), and expect this to go stale, because `complete`
  is the fastest-moving figure in the corpus (measured moving 46 → 49 in thirteen hours) and it is
  the **homepage headline** since DAR-117. DAR-160 scopes the release-cadence mechanism that would
  end the re-measure treadmill; it is blocked on the hub cutting releases regularly.
- **The theorems figure is the machine-checked count** from the conformance registry
  (`.met = true` = complete + axiom-backed) — NOT the Layer-1 catalog size. The site shipped
  "150 theorems proven" for a while; that was the Layer-1 count, not a proven count, and
  DAR-43 corrected it to the conformance count (`THEOREMS_CHECKED`). Don't reintroduce it.
- **The homepage leads with `THEOREMS_COMPLETE`, /evidence with `THEOREMS_CHECKED`** (DAR-117),
  and that split is deliberate, not drift. The homepage readout is the largest type on the site
  and had the raw total in it, unqualified — most of the checked corpus rests on local axioms
  awaiting discharge, so a formal-methods reviewer reads a bare total as inflated. The readout now
  shows the complete count with the total as its denominator (`readout_theorems_label` takes
  `{checked}` as a param — a figure passed into prose, never re-typed into it), and `/evidence`
  keeps the full catalog: card value = `THEOREMS_CHECKED`, breakdown in the claim sentence. **"Complete" is a
  term of art, so the homepage defines it where it uses it** — `section_proven_body`, DAR-46's
  rule. `src/lib/evidence-disclosure.spec.ts` is the third copy guard (IP boundary → truth
  boundary → **disclosure** boundary: a figure we do publish must not be shown stripped of its
  qualification), and the evidence e2e is the only thing that can see WHICH constant the readout
  renders — swapping it back type-checks and keeps every unit spec green.
- **Assumptions and local axioms are different things, and `/evidence/proofs` says so** (DAR-117).
  The card and the methodology page both used the word "declared" for each, one paragraph apart,
  and a reviewer conflating them reads every framework hypothesis as proof debt. Three cases, in
  `evidence_proofs_axioms_*`: **hypotheses** the theorems are stated under (Lipschitz, compact
  sets, bounded disturbance, hardware isolation — declared inputs that hold for the complete
  theorems too, since complete means "introduces no axiom of its own", not "needs no
  assumptions"); **local axioms**, named stand-ins for a result the proof does not derive —
  general mathematics the prover libraries do not yet formalize, or a result established elsewhere
  in the corpus that this proof does not yet build on — which are the debt, and are exactly what
  keeps a theorem out of the complete count; and **carried physical premises**, where
  the implication is machine-checked but the theorem is not counted as proven at all. They are
  **not a split of one number**: the axioms separate the two published counts, the assumptions sit
  under all of them. Deliberately **no counts** in that section — how many carry what is the
  backlog. The named assumptions are pinned against `evidence_theorems_not_covered` so the card
  and the detail page can't list different premises. Careful with quantifiers here: how the local
  axioms divide between those two kinds is not something this repo can source, so the copy says
  both exist and ranks neither — an unmeasured "mostly" is the same defect as an unmeasured
  figure, on the page that exists to not have them.
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
  **"Nothing elsewhere" reaches outside this repo**: the GitHub org profile was written the day
  before this rule landed and kept the retired verb until DAR-128 (at the end of this list).
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
- **The catalog total is guarded by DERIVATION, never by a literal (DAR-152).** The rule was
  `/\b338\b/`, labelled "the theorem-catalog total (338)" — which wrote the secret into a
  **public repo in order to guard it**, and pinned it to a vintage, so the corpus outgrew the
  figure and today's total would have passed. Both faults have one cause: the guard was written
  in terms of the number it hides. `src/lib/evidence-boundary.ts` derives it from the number we
  **publish** instead — every publishable theorem count is at most `THEOREMS_CHECKED` and the
  catalog size is by construction above it, so the band names nothing and a re-measure carries
  it along. Three routes, all in that one module so the unit spec (catalogs + constants) and the
  e2e (rendered text) close together: a **bare integer above the published count near
  theorem wording** — both halves load-bearing and both measured, since dropping the **band**
  leaves "Lean 4" reporting itself in 7 keys, while dropping the **proximity** test leaves the
  benchmark iteration counts reporting themselves (8 hits over 5 keys, led by
  `evidence_cfc_method`'s "1,000 warmup iterations"); a
  **numeric corpus percentage**, because a count beside "75.4% of the corpus" (the hub brief's
  own phrasing) recovers the total to within a row; and **backlog wording**, which is the
  complement — the remainder sits BELOW the band, so no value rule can reach it and computing
  one would mean importing the secret. That third half is honestly partial: it catches the plain
  spellings, not a paraphrase. Two exclusions are load-bearing and were found by measurement,
  not by reasoning — **calendar years** (both dated lines put one beside "corpus"/"theorems")
  and **numbers glued to a word, hyphen or dot** (`SHA-256`, `0.767`, `p50`, `Isabelle2025-2`).
  "not yet mechanized" was a candidate and is **rejected**: `evidence_proofs_axioms_local_body`
  legitimately says the prover libraries "do not yet formalize" a result — a fact about Mathlib,
  not about our backlog. Over a rendered page the unit is **a line and its successor**, both
  bounds measured: a whole-page scan reads the homepage's `13,000×` readout as neighbouring the
  theorems one, while one line at a time misses the shape the cards actually use — a bare value
  above its label, which is how a total would be published (`346` over "Theorems in the catalog"
  passed the whole evidence suite). A pair reunites value with label; four lines would re-create
  the readout collision, since `13,000×` renders three lines from the theorems readout.
  **On a hit, this rule takes different action from the ones above it**, and the difference is
  that those match an exact value so a hit is always a leak ("reword, never loosen"), while this
  one is a heuristic — "500 trials against the theorem conformance registry" and "384 CI runners"
  both fire, and neither is a total (measured). Check the figure against the hub's source of
  record first: if it is the catalog total or derives it, reword; if it demonstrably is not, the
  copy is fine and the fix belongs in the rule — narrow a context term, don't widen the band or
  drop a route, which are the two edits that restore the defect this replaced. `CONTEXT_WINDOW`
  is likewise a **choice inside a tested range**, bracketed to (44, 117) by two spec cases
  because 20, 200 and 400 all passed every other assertion.
- The rule covers **source comments too** — this repo is public, and the DAR-43 review found
  an `h=16` in a doc-comment — but **no automated guard reads comments**: a pattern scan over
  source false-positives immediately ("parameter" is legitimate prose in these files), so
  comments are **code-review territory**. Read them when reviewing; don't trust CI for this.
- **CMS prose is the third publishing surface, and it is checked by HAND — `pnpm check:cms`
  (DAR-171).** The two guards above cover the message catalogs (unit) and the rendered pages
  (e2e); a Sanity-authored post is neither, and **no test can reach it** — CI has no
  `SANITY_VIEWER_TOKEN` (DAR-96), so every CMS-driven page is empty there and the e2e passes
  unchanged against a site serving no documents at all. `scripts/check-cms-boundary.ts` runs
  **both** boundaries (IP + safety language) over every document's prose, and the two reasons it
  is a script rather than a check are worth keeping. First, a CI version would need a Sanity token
  in GitHub secrets — making a required merge gate depend on a third party's uptime — or be
  vacuous. Second and more important, **a hit here needs a human**: the IP rule is a heuristic
  whose prescribed response is to check the figure against the hub's source of record and then
  either reword the copy or narrow a context term, which is a judgement about facts in another
  repository. Measured before choosing the shape — `The 500 trials in our conformance registry
each replay a proven invariant` reports a leak and is perfectly publishable, the exact false
  positive the detector documents. An automatic render-time gate would have to pick one of two
  wrong answers for it, and both compound: withholding the post deletes correct content from a
  live page on a heuristic, and rendering it anyway makes the guard decorative. So: **run it
  before publishing a post that quotes a figure** (`--dataset=dev` before promoting, `--drafts`
  to include unpublished work). The residual is stated rather than papered over — nothing MAKES
  anyone run it; what it buys is one command instead of a memory of a rule.
- **The part of that scan which fails SILENTLY is the walk, so that is the part with tests.**
  `$lib/sanity/document-text.ts` flattens a document to prose, and a detector handed an empty
  string reports clean — DAR-152's "a scan whose assertions are all 'nothing matched' passes just
  as happily against a detector that answers nothing". So its spec asserts **positively** that
  prose came through, and three properties are load-bearing: the walk is **fail-closed** (any
  object or array type it has never heard of is descended into, so a block type added to the
  Studio tomorrow arrives inside the scan — an allow-list of known prose fields would go quiet on
  exactly the additions worth catching); the skip rule is a **deny-list** for that same reason,
  holding only `_`-prefixed system keys and Portable Text's presentation metadata, with
  `markDefs` deliberately **kept** because a link `href` is published text and a path ending in
  the catalog size is a plausible carrier; and a block's `children` are joined with **''** rather
  than a newline, since spans are the fragments of one paragraph — split them and a claim whose
  number sits in the first span and whose subject sits in the third falls outside the line-pair
  window, a miss created purely by the editor's formatting. **And the scan runs per FIELD, not per
  document** (`documentFields`), which is about the detection window rather than tidier output: the
  line-pair window reunites a value with a label on the next line, so flattening a whole document
  puts unrelated top-level fields on adjacent lines **in whatever order the API serialized them** —
  a cross-field pair is a coincidence of that order, which cuts both ways (a spurious pair, and an
  order-dependent _miss_ when a third field lands between a number and the word that gives it
  meaning). Per field, every pair the window can form is one an author actually wrote, and a hit
  names where it is. The trade is deliberate and tested in both directions: a leak genuinely split
  across two fields is not seen, which is fine because a leak lives in a sentence and `body` keeps
  the window intact within itself. Measured against the live dataset:
  108,632 characters of prose reached across 174 documents, **0 hits** — and the clean result was
  verified non-blind (7 documents carry theorem-context wording and 14 carry a bare integer above
  40, they simply never coincide inside the window), because "no hits" and "the scan reaches
  nothing" print identically. **Lowering the published maximum does not prove the wiring** — this
  corpus trips nothing at a threshold of 40 or even 0, so that mutation looks decisive and is
  vacuous. What does fire, each naming its route: `THEOREM_CONTEXT += token` → 2 hits on route 1
  (integer above the published total); `+= attention` → 2 on route 2 (the FlashAttention abstracts
  quote utilization percentages); a safety pattern pointed at `/\bthe\b/` → 26 documents. One trap
  worth keeping, because the first version of this note fell into it: the guidance the script prints
  on a hit contains the phrase "is not a theorem count", so grepping its output for "theorem count"
  matches the **advice** and reads as a route-1 hit that never happened. Grep for the route's own
  message shape (`theorem count N above`), never for a word the failure text also contains.
- **The one false positive you will actually hit is `REALTIME_MULTIPLE` beside proof language, and
  the answer is to reword (DAR-171).** A verification post naturally discusses both the proofs and
  the performance claim, so "…is measured and the **13,000×** headroom is derived from it — neither
  is a theorem" puts `13000` inside the window of both "corpus" and "theorem". Measured — it fired
  on the first milestone post drafted after the scan existed, which is the useful part: this is the
  moment the reflex fix (widen the band) looks reasonable, and taking it is what turned the previous
  version of this guard into a no-op. Both tempting fixes are worse than the reword. Narrowing
  "corpus" or "theorem" guts the detector generally to fix one sentence. Excusing "any integer equal
  to a figure we publish" sounds principled and **opens the door this module exists to close**: a
  catalog total added to `$lib/evidence.ts` would be excused by that list _and_ sail through the
  constants scan, since a bare `346` in isolation carries no theorem context of its own. Dropping
  the numerals costs nothing — the performance figures have their own claim card, and prose about
  proofs does not need them.
- **The vocabulary binds surfaces OUTSIDE this repo, and the GitHub org profile is one (DAR-128).**
  `DarcStar-Technologies/.github` → `profile/README.md` is what a technical evaluator often reads
  before the site, and its bullet list is a **copy of /about's principles section** — the three
  titles are verbatim `about_principle_*_title` values. That is what makes drift there both likely
  and hand-checkable: every bullet body has a named twin in the catalog. **It did not drift so much
  as get left behind by a rename**, which is the more useful framing and needed the dates to see:
  the profile was committed 2026-07-24 and DAR-46 retired the verb on the site 2026-07-25, one day
  later, so this was never a copy diverging over time — it was written against the previous
  vocabulary and nothing carried it forward. Expect that shape whenever claim copy is retired here.
  All three bodies were stale, and
  **only one was the line the ticket named** — "the same verified core **ships** across robotics,
  markets, …", the verb `about_principle_oneengine_body` exists to avoid. Checking the whole surface
  against its twins found two more: "Safety **guarantees** are machine-checked" (every on-site
  surface says _properties_, and the bullet named no boundary at all) and "fast enough to **hold
  formal guarantees** inside a live control loop", which implies the timing carries a formal
  guarantee — the thing this document forbids outright, and the worst of the three. Two bullets are
  now byte-identical to their twins; the one-engine bullet carries `section_domains_scope`'s
  exclusion (_not a demo, and not a customer deployment_) instead of the site's domain-list tail,
  because that README stands alone with no scope definition anywhere else on it. **Read the profile
  against `about_principle_*_body` whenever the site's claim copy changes** — it is the second
  publishing surface the guards cannot reach, after CMS prose (DAR-171).
- **That drift class is provably NOT machine-detectable, which is why this one is editorial rather
  than a second `check:cms` (DAR-128).** Measured with a seeded positive control: both detectors
  report **0 hits on the broken README and 0 on the fixed one** — they cannot tell the two apart. The
  reason is _not_ that the file lives in another repo; a script could fetch it, and `check:cms`
  already reaches a third-party API. It is that the drift is neither a banned phrase nor a forbidden
  value but a **true claim with its qualification stripped** — the disclosure axis (DAR-117) — and a
  pattern cannot see an absence. "ships" was the single lexical tell, and even that word is
  legitimate on /evidence, where `evidence_domains_claim` defines it. So a scanner pointed at that
  file would have reported clean on the exact text DAR-128 was filed to fix: coverage theatre, and
  DAR-152's failure mode precisely. What it got instead is a header comment in the file itself, which
  puts the rule where the editing happens and costs nothing (an HTML comment is invisible in the
  rendered profile). The general form is worth keeping: **before scanning a new surface, check that
  the detector can see the defect that surface actually produces** — a scan earns its place only
  where a hit is possible.
- **Keep the org profile FIGURELESS.** It carries no count ("many domains", never "five") and no
  theorem numbers, and that is what stops it going stale: there is no `$lib/evidence.ts` to
  single-source from in that repo and no test run against it, so a figure there would be a permanent
  re-measure obligation with nothing to remind anyone of it. State the shape of the claim and link to
  /evidence for the numbers — which is what the profile's closing paragraph already does.
