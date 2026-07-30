// `pnpm check:cms` — run the two published-copy boundaries over CMS prose (DAR-171).
//
// WHY THIS IS A SCRIPT AND NOT A TEST, which is the whole design decision in DAR-171:
//
//   1. NO TEST CAN SEE THIS CONTENT. The unit specs scan the Paraglide catalogs; the e2e scans
//      rendered pages but runs without `SANITY_VIEWER_TOKEN` (DAR-96), so every CMS-driven page is
//      empty in CI and `seo.e2e.ts` passes unchanged against a site serving no documents at all.
//      A CI check here would either need a Sanity token in GitHub secrets — making a required merge
//      gate depend on a third party's uptime — or be vacuous. Both are worse than a hand-run check.
//
//   2. A HIT NEEDS A HUMAN, and the detector says so itself. evidence-boundary.ts's header: a hit
//      "can be a number that is not a theorem count at all", and the prescribed response is to check
//      the figure against the hub's source of record FIRST, then either reword the copy or narrow a
//      context term. That is a judgement about facts in another repository. Measured before choosing
//      this shape: "The 500 trials in our conformance registry each replay a proven invariant"
//      reports a leak and is perfectly publishable — the exact false positive the module documents.
//      An automatic gate would have to pick one of two wrong answers for it, and the interesting one
//      is that BOTH are bad in a way that compounds: withholding the post deletes correct content
//      from a live marketing page on a heuristic, and rendering it anyway makes the guard decorative.
//
//   3. SO WHY NOT LEAVE IT TO EDITORIAL DISCIPLINE, the ticket's own alternative? Because discipline
//      needs an instrument. Source comments are unscanned for the same reason (a pattern scan over
//      source false-positives immediately) and that is accepted because a reviewer reads every diff.
//      Nobody reviews a Studio publish. This is the missing instrument, not a replacement for the
//      judgement — the same posture as `smoke:invite` / `smoke:waitlist`, which exist precisely for
//      compositions the hermetic suites cannot reach (DAR-80, DAR-103).
//
// The honest residual, stated rather than papered over: nothing MAKES anyone run this. It is a tool
// for the moment before publishing a post that quotes a figure, and docs/evidence.md names it as the
// pre-publish step. What it does buy is that the check is one command instead of a memory of a rule.
//
// A GREEN RUN HERE IS NOT SELF-VALIDATING, so the wiring was mutation-proven against the live
// dataset rather than inferred from the clean result. Lowering the published maximum does NOT do it —
// this corpus has no bare integer within the window of any theorem wording, so thresholds of 40 and
// even 0 both stayed green, which is exactly the kind of "passes for the wrong reason" a low
// threshold looks like it rules out. What does fire, each measured and each naming its route:
//
//   · THEOREM_CONTEXT += `token`     → 2 hits on route 1 (integer above the published total)
//   · THEOREM_CONTEXT += `attention` → 2 hits on route 2 (the FlashAttention abstracts quote
//                                       utilization percentages)
//   · a safety pattern → /\bthe\b/   → 26 documents
//
// All with the right excerpt, the owning FIELD named, exit code 1 and the guidance text. Fetch →
// flatten → detect → report is live; the zero is a property of the content.
//
// Worth knowing how the earlier version of this note got it wrong: it claimed the `attention`
// mutation fired route 1, which came from reading the guidance text's own phrase "is not a theorem
// count" as a hit line. Grep for the route's actual message (`theorem count N above`), never for a
// word the failure output also contains.
//
// USAGE
//   pnpm check:cms                  # the dataset the site serves, published documents only
//   pnpm check:cms --dataset=dev    # before promoting: check the Studio's working dataset
//   pnpm check:cms --drafts         # include unpublished drafts
import { createClient } from '@sanity/client';
import { THEOREMS_CHECKED } from '../src/lib/evidence';
import { findCatalogTotalLeaksInRenderedText } from '../src/lib/evidence-boundary';
import { findSafetyLanguageViolations } from '../src/lib/safety-language';
import { documentFields } from '../src/lib/sanity/document-text';
import {
	DEFAULT_SANITY_API_VERSION,
	DEFAULT_SANITY_DATASET,
	DEFAULT_SANITY_PROJECT_ID
} from '../src/lib/sanity/defaults';

// The same `.env` wrangler loads, so the script and the site agree on which dataset is which.
try {
	process.loadEnvFile('.env');
} catch {
	// No .env — fall back to the ambient environment.
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const projectId = process.env.VITE_SANITY_PROJECT_ID ?? DEFAULT_SANITY_PROJECT_ID;
const dataset = flag('dataset') ?? process.env.VITE_SANITY_DATASET ?? DEFAULT_SANITY_DATASET;
const apiVersion = process.env.VITE_SANITY_API_VERSION ?? DEFAULT_SANITY_API_VERSION;
const includeDrafts = args.includes('--drafts');
const token = process.env.SANITY_VIEWER_TOKEN;

/** A document as it comes back — untyped on purpose. The scan walks whatever shape arrives, which is
 * the point (a type would describe today's schema and the walk has to survive tomorrow's). */
type Doc = Record<string, unknown> & { _id: string; _type: string };

const label = (doc: Doc) => {
	const title = typeof doc.title === 'string' ? doc.title : undefined;
	const name = typeof doc.name === 'string' ? doc.name : undefined;
	return `${doc._type} · ${title ?? name ?? doc._id}`;
};

async function main() {
	if (!token) {
		// Not a soft warning: this project gates reads behind document-level access control, so a
		// token-less client sees only `siteSettings` and would report a clean scan of almost nothing.
		// Exactly the blind-scan-that-looks-like-a-pass this script exists to avoid.
		console.error(
			'SANITY_VIEWER_TOKEN is not set (check .env).\n' +
				'Without it the dataset returns only siteSettings, so a clean result would be meaningless.'
		);
		process.exit(2);
	}

	const client = createClient({
		projectId,
		dataset,
		apiVersion,
		useCdn: false,
		perspective: includeDrafts ? 'raw' : 'published',
		token
	});

	console.log(
		`Scanning ${projectId}/${dataset} (${includeDrafts ? 'drafts + published' : 'published'}) ` +
			`against a published theorem total of ${THEOREMS_CHECKED}.`
	);

	const docs = await client.fetch<Doc[]>('*[defined(_type)]');

	let scanned = 0;
	const flagged: string[] = [];

	for (const doc of docs) {
		// Per FIELD, not per document — `documentFields` explains why the detection window requires it.
		const fields = documentFields(doc);
		if (!fields.length) continue;
		scanned++;

		const docHits = fields.flatMap(([field, text]) =>
			[
				...findCatalogTotalLeaksInRenderedText(text, THEOREMS_CHECKED),
				...findSafetyLanguageViolations(text)
			].map((hit) => `${field}: ${hit}`)
		);

		if (!docHits.length) continue;
		flagged.push(label(doc));
		console.log(`\n✗ ${label(doc)}`);
		console.log(`  ${doc._id}`);
		for (const hit of docHits) console.log(`  - ${hit}`);
	}

	console.log(`\nScanned ${scanned} documents with prose (of ${docs.length} fetched).`);

	if (!flagged.length) {
		console.log('No boundary hits.');
		return;
	}

	// The guidance both detectors prescribe, at the moment it is needed. Deliberately not "fix the
	// rule" first: the figure has to be checked against the hub before anyone knows which half is
	// wrong, and a reflex loosening is how the guard this replaced became useless (DAR-152).
	console.error(
		`\n${flagged.length} document(s) flagged.\n\n` +
			"An IP hit is a heuristic: check the figure against the hub's source of record FIRST.\n" +
			'  · If it is the catalog total, or recovers it, reword the copy in the Studio.\n' +
			'  · If it demonstrably is not a theorem count, the copy is fine — narrow a context term\n' +
			'    in evidence-boundary.ts. Never widen the band and never delete a route.\n' +
			'A safety-language hit is exact: reword to the qualified formulation (docs/evidence.md).'
	);
	process.exit(1);
}

main().catch((err: unknown) => {
	console.error('check:cms failed', err);
	process.exit(2);
});
