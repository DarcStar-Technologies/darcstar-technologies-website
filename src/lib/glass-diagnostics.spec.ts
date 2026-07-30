// Spec for DAR-170's temporary diagnostic harness. DELETE WITH THE TICKET.
//
// One property is worth a test even for scaffolding: the harness must be INERT for normal traffic.
// It is wired into the root layout, so a parsing bug doesn't produce a broken diagnostic — it
// unfrosts every page or deletes the sheen for every visitor. The rest of the assertions exist so
// the arms can be trusted while a device session is being burned on them.
import { describe, expect, it } from 'vitest';
import { GLASS_DIAGNOSTIC_FLAGS, STATIC_CLIP_PATH, glassDiagnostics } from './glass-diagnostics';

const parse = (query: string) => glassDiagnostics(new URLSearchParams(query));

describe('glassDiagnostics', () => {
	const inert = { noSheen: false, noBlur: false, noClip: false, attr: undefined };

	it('is inert with no parameter — and emits no attribute at all', () => {
		expect(parse('')).toEqual(inert);
	});

	it('is inert for an empty or unrecognized value', () => {
		// `attr: undefined` is the load-bearing half: an attribute present but empty would still
		// match `[data-glass-diag]` if a future selector were written that way.
		for (const query of ['glassdiag=', 'glassdiag=nope', 'glassdiag=,,', 'glassdiag=%20']) {
			expect(parse(query), query).toEqual(inert);
		}
	});

	it('enables one arm at a time', () => {
		expect(parse('glassdiag=nosheen')).toEqual({ ...inert, noSheen: true, attr: 'nosheen' });
		expect(parse('glassdiag=noblur')).toEqual({ ...inert, noBlur: true, attr: 'noblur' });
		expect(parse('glassdiag=noclip')).toEqual({ ...inert, noClip: true, attr: 'noclip' });
	});

	it('composes arms, comma- or space-separated, in any case or order', () => {
		const both = { ...inert, noSheen: true, noBlur: true, attr: 'nosheen noblur' };
		expect(parse('glassdiag=nosheen,noblur')).toEqual(both);
		expect(parse('glassdiag=noblur,nosheen')).toEqual(both);
		expect(parse('glassdiag=nosheen noblur')).toEqual(both);
		expect(parse('glassdiag=NoSheen,NOBLUR')).toEqual(both);
	});

	it('drops unrecognized tokens rather than the whole value', () => {
		expect(parse('glassdiag=nosheen,bogus')).toEqual({
			...inert,
			noSheen: true,
			attr: 'nosheen'
		});
	});

	it('never echoes caller-supplied text into the attribute', () => {
		// The value reaches a DOM attribute. Svelte escapes it, but the guarantee here is stronger:
		// only our own literals are ever emitted, so there is nothing to escape.
		const diag = parse('glassdiag=' + encodeURIComponent('nosheen" onload="x'));
		expect(diag.attr).toBe(undefined);
		expect(diag.noSheen).toBe(false);
	});

	it('emits only tokens the CSS and layout actually recognize', () => {
		const diag = parse(`glassdiag=${GLASS_DIAGNOSTIC_FLAGS.join(',')}`);
		expect(diag.attr?.split(' ')).toEqual([...GLASS_DIAGNOSTIC_FLAGS]);
	});

	it('pins the frozen clip to a path(), not none or inset', () => {
		// The `noclip` arm's whole claim is that it changes ONE variable — the clip stops being
		// rewritten — so the property, its value type and therefore its compositing category must
		// stay what production uses. `none` would remove the clip entirely and confound the result.
		expect(STATIC_CLIP_PATH).toMatch(/^path\('M/);
	});
});
