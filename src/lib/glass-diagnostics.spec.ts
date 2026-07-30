// Spec for DAR-170's temporary diagnostic harness. DELETE WITH THE TICKET.
//
// One property is worth a test even for scaffolding: the harness must be INERT for normal traffic.
// It is wired into the root layout, so a parsing bug doesn't produce a broken diagnostic — it
// unfrosts every page or deletes the sheen for every visitor. The rest of the assertions exist so
// the arms can be trusted while a device session is being burned on them.
import { describe, expect, it } from 'vitest';
import { GLASS_DIAGNOSTIC_FLAGS, glassDiagnostics } from './glass-diagnostics';

const parse = (query: string) => glassDiagnostics(new URLSearchParams(query));

describe('glassDiagnostics', () => {
	it('is inert with no parameter — and emits no attribute at all', () => {
		const diag = parse('');
		expect(diag).toEqual({ noSheen: false, noBlur: false, attr: undefined });
	});

	it('is inert for an empty or unrecognized value', () => {
		// `attr: undefined` is the load-bearing half: an attribute present but empty would still
		// match `[data-glass-diag]` if a future selector were written that way.
		for (const query of ['glassdiag=', 'glassdiag=nope', 'glassdiag=,,', 'glassdiag=%20']) {
			expect(parse(query), query).toEqual({ noSheen: false, noBlur: false, attr: undefined });
		}
	});

	it('enables one arm at a time', () => {
		expect(parse('glassdiag=nosheen')).toEqual({ noSheen: true, noBlur: false, attr: 'nosheen' });
		expect(parse('glassdiag=noblur')).toEqual({ noSheen: false, noBlur: true, attr: 'noblur' });
	});

	it('enables both, comma- or space-separated, in any case or order', () => {
		const both = { noSheen: true, noBlur: true, attr: 'nosheen noblur' };
		expect(parse('glassdiag=nosheen,noblur')).toEqual(both);
		expect(parse('glassdiag=noblur,nosheen')).toEqual(both);
		expect(parse('glassdiag=nosheen noblur')).toEqual(both);
		expect(parse('glassdiag=NoSheen,NOBLUR')).toEqual(both);
	});

	it('drops unrecognized tokens rather than the whole value', () => {
		expect(parse('glassdiag=nosheen,bogus')).toEqual({
			noSheen: true,
			noBlur: false,
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
});
