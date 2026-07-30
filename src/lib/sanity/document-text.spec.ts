import { describe, expect, it } from 'vitest';
import { documentFields, documentText } from './document-text';
import { findCatalogTotalLeaksInRenderedText } from '$lib/evidence-boundary';

// DAR-171. This is the half of `pnpm check:cms` that can be tested at all: the script itself needs a
// Sanity read token, which CI does not have (DAR-96), so nothing downstream of here is exercised in
// CI. What that leaves is the walk — and the walk is the part whose failure is SILENT, because a
// detector handed an empty string reports clean. So the assertions below are deliberately POSITIVE
// ("this prose came through") rather than "nothing matched"; a spec of the latter shape would pass
// against a function that returns ''.

/** A Portable Text span. */
const span = (text: string) => ({ _type: 'span', _key: 'k', text, marks: [] });

/** A paragraph, optionally split into several spans the way bold or a link splits one. */
const para = (...texts: string[]) => ({
	_type: 'block',
	_key: 'b',
	style: 'normal',
	markDefs: [],
	children: texts.map(span)
});

describe('documentText', () => {
	it('returns a plain string unchanged', () => {
		expect(documentText('the corpus grew')).toBe('the corpus grew');
	});

	it('reaches every prose field of a post-shaped document', () => {
		const text = documentText({
			_type: 'post',
			_id: 'post.milestone',
			title: 'A verification milestone',
			excerpt: 'What we mechanized in July.',
			slug: { current: 'a-verification-milestone' },
			body: [para('The corpus grew again.'), para('Here is what changed.')],
			seo: { description: 'A milestone announcement.' }
		});
		for (const expected of [
			'A verification milestone',
			'What we mechanized in July.',
			'The corpus grew again.',
			'Here is what changed.',
			'A milestone announcement.'
		])
			expect(text).toContain(expected);
	});

	// THE LOAD-BEARING EXCEPTION. Spans are the fragments of one sentence, so they must rejoin into
	// one line — see the composition test at the bottom for why a newline here would lose a leak.
	it('joins the spans of one paragraph into a single line', () => {
		const text = documentText(para('The corpus holds ', '260', ' theorems.'));
		expect(text).toBe('The corpus holds 260 theorems.');
		expect(text).not.toContain('\n');
	});

	it('puts separate paragraphs on separate lines', () => {
		expect(documentText([para('First.'), para('Second.')]).split('\n')).toEqual([
			'First.',
			'Second.'
		]);
	});

	// Sanity reserves the `_` prefix, so nothing an editor typed can hide behind one — and letting
	// `_type` through would salt every scan with the words "post", "block" and "span".
	it('contributes nothing from system keys', () => {
		expect(documentText({ _type: 'block', _key: 'abc', _rev: 'xyz' })).toBe('');
	});

	// Presentation metadata is skipped so the excerpts a human reads stay readable — "normal" on its
	// own line above every paragraph is noise, not prose.
	it('contributes nothing from Portable Text presentation metadata', () => {
		const text = documentText({
			_type: 'block',
			style: 'h2',
			listItem: 'bullet',
			level: 2,
			children: [{ _type: 'span', text: 'Only this.', marks: ['strong', 'k7'] }]
		});
		expect(text).toBe('Only this.');
	});

	// markDefs is deliberately NOT skipped: a link href is published text, and a path ending in the
	// catalog size is a plausible way for the figure to ship.
	it('walks link definitions, where an href can carry a figure', () => {
		const text = documentText({
			_type: 'block',
			markDefs: [{ _type: 'link', _key: 'k7', href: 'https://example.invalid/theorems/346' }],
			children: [{ _type: 'span', text: 'see the registry', marks: ['k7'] }]
		});
		expect(text).toContain('https://example.invalid/theorems/346');
	});

	// FAIL-CLOSED, and this is the assertion that says so. A type this file has never heard of — the
	// next mathBlock, the next callout — must arrive inside the scan without anyone adding it here.
	// An allowlist of known prose fields would return '' for it and report clean.
	it('walks object and array types it does not recognize', () => {
		const text = documentText({
			_type: 'post',
			body: [
				{
					_type: 'someBlockTypeInventedLater',
					caption: 'A caption nobody allowlisted.',
					nested: { deeper: [{ evenDeeper: 'buried prose' }] }
				}
			]
		});
		expect(text).toContain('A caption nobody allowlisted.');
		expect(text).toContain('buried prose');
	});

	it('stringifies numbers, since a numeric field publishes just as well as a numeric word', () => {
		expect(documentText({ _type: 'x', count: 346 })).toContain('346');
	});

	it.each([
		['null', null],
		['undefined', undefined],
		['a boolean', true]
	])('contributes nothing for %s', (_label, value) => {
		expect(documentText(value)).toBe('');
	});

	it('drops empty strings rather than emitting blank lines', () => {
		expect(documentText({ _type: 'x', a: 'kept', b: '', c: 'also kept' })).toBe('kept\nalso kept');
	});
});

describe('documentFields', () => {
	it('returns one entry per top-level field that has prose', () => {
		expect(
			documentFields({
				_type: 'post',
				_id: 'post.x',
				title: 'A title',
				body: [para('A paragraph.')]
			})
		).toEqual([
			['title', 'A title'],
			['body', 'A paragraph.']
		]);
	});

	it('drops fields with no prose rather than returning empty text', () => {
		expect(documentFields({ _type: 'x', empty: '', blank: null, kept: 'here' })).toEqual([
			['kept', 'here']
		]);
	});

	// So a caller can read "no entries" as "no prose in this document" without re-checking.
	it('returns nothing for a document with no prose at all', () => {
		expect(documentFields({ _type: 'x', _id: 'y', flag: true })).toEqual([]);
	});

	it.each([
		['null', null],
		['a string', 'not a document'],
		['an array', [{ title: 'x' }]]
	])('returns nothing for %s', (_label, value) => {
		expect(documentFields(value)).toEqual([]);
	});

	// THE PROPERTY THIS FUNCTION EXISTS FOR. Two fields must never share a detection window: the API
	// serializes a document's fields in an order nobody authored, so a value in one field landing next
	// to a context word in another is a coincidence of that order — a spurious pair, and an
	// order-dependent miss when some third field sits between them. Splitting per field means every
	// pair the window can form is one an author actually wrote.
	it('never lets two fields form one detection window', () => {
		// Deliberately split so NEITHER field carries both halves: the number lives in `title` with no
		// context word beside it, the context word lives in `excerpt` with no number.
		const doc = { _type: 'post', title: 'We reached 346', excerpt: 'theorems this quarter.' };
		// Whole-document flattening pairs those two lines and reports a leak neither field contains.
		expect(findCatalogTotalLeaksInRenderedText(documentText(doc), 260)).not.toEqual([]);
		// Per field, neither half is a leak on its own.
		for (const [, text] of documentFields(doc))
			expect(findCatalogTotalLeaksInRenderedText(text, 260)).toEqual([]);
	});

	// The flip side, stated so the trade is deliberate: a leak really split across two fields is not
	// seen. Accepted — a leak lives in a sentence, and `body` keeps the window intact within itself.
	//
	// Spans deliberately SPLIT here, so this also proves the paragraph join survives the path the
	// script actually takes. documentText applies the '' join when it meets a block node; reaching a
	// block's children by another route would join them with '\n' instead, and the composition test
	// further down only proves that for documentText called directly. This is the caller's path.
	it('still finds a leak contained in one field, across split spans', () => {
		const doc = { _type: 'post', body: [para('We catalogued ', '346', ' theorems this quarter.')] };
		const hits = documentFields(doc).flatMap(([, text]) =>
			findCatalogTotalLeaksInRenderedText(text, 260)
		);
		expect(hits.join(' ')).toContain('346');
	});

	// The asymmetry with documentText, pinned so it stays deliberate. `style`/`level` are Portable Text
	// NODE metadata; at document top level they are ordinary authored fields, so scanning them is the
	// fail-closed direction. Making this "consistent" with documentText would narrow the scan.
	it('scans top-level fields whose names collide with presentation metadata', () => {
		expect(
			documentFields({ _type: 'guide', level: 'For advanced practitioners', style: 'Terse' })
		).toEqual([
			['level', 'For advanced practitioners'],
			['style', 'Terse']
		]);
	});
});

// The reason the span join is a rule and not a tidy-up. An editor who bolds the number splits the
// sentence into three spans; flattened correctly the leak is one line and the detector sees it, and
// this is the test that fails if `children` ever start being joined with '\n' — the number would
// land on line 1, the word "catalogued" on line 3, and the pair window covers only 1+2.
describe('documentText feeding the evidence-boundary detector', () => {
	it('still finds a leak that an editor split across spans', () => {
		const body = [
			para('The corpus now holds 260 machine-checked theorems, '),
			para('out of ', '346', ' catalogued.')
		];
		const hits = findCatalogTotalLeaksInRenderedText(documentText(body), 260);
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.join(' ')).toContain('346');
	});

	it('reports nothing for a milestone paragraph that publishes only figures we do publish', () => {
		const body = [para('In July we mechanized the 49th complete theorem; the corpus holds 260.')];
		expect(findCatalogTotalLeaksInRenderedText(documentText(body), 260)).toEqual([]);
	});
});
