import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

// The published-surface IP boundary (DAR-43, docs/evidence.md): exact neural-architecture
// numbers and the theorem-catalog backlog must never appear in UI copy. The evidence e2e
// asserts the RENDERED absences on the evidence pages; this spec guards the SOURCE of every
// page's copy — the full message catalog, every key, both locale files — so a leak can't ship
// through a page or locale the e2e doesn't visit. A hit here means the copy re-inlined
// something the boundary forbids: reword it, don't loosen the pattern.
const FORBIDDEN: { name: string; pattern: RegExp; keys?: RegExp }[] = [
	{ name: 'the theorem-catalog total (338)', pattern: /\b338\b/ },
	{ name: 'the controller parameter count', pattern: /40,?824/ },
	{ name: 'hidden-dimension wording', pattern: /hidden[- ]?(dim|unit)/i },
	{ name: 'hidden-dim shorthand (h=N)', pattern: /\bh=\d+/ },
	// Scoped to the evidence surface: "parameter(s)" is a legitimate word elsewhere (query
	// params, form copy), but on evidence pages it only ever meant the architecture count.
	{
		name: 'parameter-count wording on evidence copy',
		pattern: /\bparameters?\b/i,
		keys: /^evidence_/
	}
];

describe.each([
	['en', en as Record<string, unknown>],
	['es', es as Record<string, unknown>]
])('messages/%s.json stays inside the evidence IP boundary', (_locale, catalog) => {
	it.each(FORBIDDEN)('contains no $name', ({ pattern, keys }) => {
		const hits = Object.entries(catalog)
			.filter(([key, value]) => typeof value === 'string' && (!keys || keys.test(key)))
			.filter(([, value]) => pattern.test(value as string))
			.map(([key]) => key);
		expect(hits).toEqual([]);
	});
});
