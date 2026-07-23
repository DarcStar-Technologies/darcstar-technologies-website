import { describe, expect, it } from 'vitest';
import { preloadFilter } from './preload';

// Pins the preload boundary (DAR-50): exactly the three latin NORMAL variable faces join the
// critical-path Link header; every other subset and style stays lazy behind unicode-range,
// and css/js keep SvelteKit's default preloading. The filter is coupled to Fontsource's
// filename convention — a package bump that renames subsets, or an italic import, should
// fail here instead of silently changing the preload set.
describe('preloadFilter', () => {
	const font = (name: string) => ({
		type: 'font' as const,
		path: `/_app/immutable/assets/${name}`
	});

	it('preloads the three latin normal variable faces (hashed build names)', () => {
		expect(preloadFilter(font('inter-latin-wght-normal.Dx4kXJAl.woff2'))).toBe(true);
		expect(preloadFilter(font('space-grotesk-latin-wght-normal.BhU9QXUp.woff2'))).toBe(true);
		expect(preloadFilter(font('jetbrains-mono-latin-wght-normal.B9CIFXIH.woff2'))).toBe(true);
	});

	it('leaves every other subset lazy behind its unicode-range', () => {
		expect(preloadFilter(font('inter-latin-ext-wght-normal.DO1Apj_S.woff2'))).toBe(false);
		expect(preloadFilter(font('inter-cyrillic-wght-normal.DqGufNeO.woff2'))).toBe(false);
		expect(preloadFilter(font('jetbrains-mono-greek-wght-normal.Bw9x6K1M.woff2'))).toBe(false);
		expect(preloadFilter(font('space-grotesk-vietnamese-wght-normal.D0rl6rjA.woff2'))).toBe(false);
	});

	it('excludes italic variable faces a future import would add', () => {
		// These files ship in the installed Fontsource packages today; only the import is missing.
		expect(preloadFilter(font('inter-latin-wght-italic.C1a2B3c4.woff2'))).toBe(false);
		expect(preloadFilter(font('jetbrains-mono-latin-wght-italic.D5e6F7g8.woff2'))).toBe(false);
	});

	it('mirrors SvelteKit default preloading for non-font assets', () => {
		expect(preloadFilter({ type: 'css', path: '/_app/immutable/assets/0.gqH5WjTX.css' })).toBe(
			true
		);
		expect(preloadFilter({ type: 'js', path: '/_app/immutable/chunks/BYdkPver.js' })).toBe(true);
		expect(preloadFilter({ type: 'asset', path: '/_app/immutable/assets/hero.png' })).toBe(false);
	});
});
