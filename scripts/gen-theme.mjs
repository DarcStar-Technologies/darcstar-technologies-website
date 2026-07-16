import { writeFileSync } from 'node:fs';

// ---- hex -> OKLCH -------------------------------------------------------
const toLin = (v) => {
	v /= 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
function hexToOklch(hex) {
	const r = toLin(parseInt(hex.slice(1, 3), 16));
	const g = toLin(parseInt(hex.slice(3, 5), 16));
	const b = toLin(parseInt(hex.slice(5, 7), 16));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	let H = (Math.atan2(bb, a) * 180) / Math.PI;
	if (H < 0) H += 360;
	return { L, C: Math.hypot(a, bb), H };
}

const mix = (a, b, t) => a + (b - a) * t;
const r3 = (n) => +n.toFixed(3);
const r2 = (n) => +n.toFixed(2);
const ok = (L, C, H) => `oklch(${r3(L)} ${r3(C)} ${r2(H)})`;

const LEVELS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
// anchored at 500 = base; lighten toward L=0.97, darken toward L=0.20; chroma peaks at 500
const STOPS = {
	50: [0.9, 0.12],
	100: [0.75, 0.3],
	200: [0.58, 0.52],
	300: [0.4, 0.73],
	400: [0.19, 0.9],
	500: [0, 1],
	600: [0.13, 0.96],
	700: [0.32, 0.86],
	800: [0.52, 0.72],
	900: [0.72, 0.56],
	950: [0.88, 0.42]
};

function ramp(hex) {
	const { L: Lb, C: Cb, H } = hexToOklch(hex);
	const out = {};
	for (const lvl of LEVELS) {
		const [t, cs] = STOPS[lvl];
		const target = lvl < 500 ? 0.97 : 0.2;
		out[lvl] = { L: lvl === 500 ? Lb : mix(Lb, target, t), C: Cb * cs, H };
	}
	return out;
}

// cool near-black "void" surface ramp (faint blue tint, chroma ~0)
const SURFACE = {
	50: [0.98, 0.003],
	100: [0.93, 0.004],
	200: [0.85, 0.005],
	300: [0.74, 0.006],
	400: [0.62, 0.007],
	500: [0.5, 0.008],
	600: [0.42, 0.009],
	700: [0.33, 0.01],
	800: [0.24, 0.01],
	900: [0.16, 0.011],
	950: [0.1, 0.01]
};
function surfaceRamp() {
	const out = {};
	for (const lvl of LEVELS) out[lvl] = { L: SURFACE[lvl][0], C: SURFACE[lvl][1], H: 255 };
	return out;
}

function block(name, r) {
	let s = '';
	for (const lvl of LEVELS) s += `\t--color-${name}-${lvl}: ${ok(r[lvl].L, r[lvl].C, r[lvl].H)};\n`;
	s += `\t--color-${name}-contrast-dark: var(--color-${name}-950);\n`;
	s += `\t--color-${name}-contrast-light: var(--color-${name}-50);\n`;
	for (const lvl of LEVELS) {
		const kind = r[lvl].L >= 0.62 ? 'dark' : 'light';
		s += `\t--color-${name}-contrast-${lvl}: var(--color-${name}-contrast-${kind});\n`;
	}
	return s;
}

// success / warning / error kept from cerberus (semantic, sensible defaults)
const SEMANTIC = `\t--color-success-50: oklch(0.94 0.09 178.68);
\t--color-success-100: oklch(0.92 0.1 178.62);
\t--color-success-200: oklch(0.89 0.11 177.17);
\t--color-success-300: oklch(0.87 0.12 176.91);
\t--color-success-400: oklch(0.85 0.13 175.46);
\t--color-success-500: oklch(0.83 0.13 174.96);
\t--color-success-600: oklch(0.73 0.12 175.71);
\t--color-success-700: oklch(0.62 0.1 176);
\t--color-success-800: oklch(0.51 0.08 178.29);
\t--color-success-900: oklch(0.4 0.06 179.75);
\t--color-success-950: oklch(0.27 0.04 185.3);
\t--color-success-contrast-dark: var(--color-success-950);
\t--color-success-contrast-light: var(--color-success-50);
\t--color-success-contrast-50: var(--color-success-contrast-dark);
\t--color-success-contrast-100: var(--color-success-contrast-dark);
\t--color-success-contrast-200: var(--color-success-contrast-dark);
\t--color-success-contrast-300: var(--color-success-contrast-dark);
\t--color-success-contrast-400: var(--color-success-contrast-dark);
\t--color-success-contrast-500: var(--color-success-contrast-dark);
\t--color-success-contrast-600: var(--color-success-contrast-dark);
\t--color-success-contrast-700: var(--color-success-contrast-light);
\t--color-success-contrast-800: var(--color-success-contrast-light);
\t--color-success-contrast-900: var(--color-success-contrast-light);
\t--color-success-contrast-950: var(--color-success-contrast-light);
\t--color-warning-50: oklch(0.96 0.05 84.57);
\t--color-warning-100: oklch(0.93 0.06 82.17);
\t--color-warning-200: oklch(0.9 0.08 80.34);
\t--color-warning-300: oklch(0.88 0.1 80.02);
\t--color-warning-400: oklch(0.85 0.12 78.36);
\t--color-warning-500: oklch(0.82 0.14 76.72);
\t--color-warning-600: oklch(0.76 0.13 72.26);
\t--color-warning-700: oklch(0.7 0.13 68.1);
\t--color-warning-800: oklch(0.64 0.13 63.18);
\t--color-warning-900: oklch(0.58 0.13 57.97);
\t--color-warning-950: oklch(0.52 0.13 51.44);
\t--color-warning-contrast-dark: var(--color-warning-950);
\t--color-warning-contrast-light: var(--color-warning-50);
\t--color-warning-contrast-50: var(--color-warning-contrast-dark);
\t--color-warning-contrast-100: var(--color-warning-contrast-dark);
\t--color-warning-contrast-200: var(--color-warning-contrast-dark);
\t--color-warning-contrast-300: var(--color-warning-contrast-dark);
\t--color-warning-contrast-400: var(--color-warning-contrast-dark);
\t--color-warning-contrast-500: var(--color-warning-contrast-dark);
\t--color-warning-contrast-600: var(--color-warning-contrast-light);
\t--color-warning-contrast-700: var(--color-warning-contrast-light);
\t--color-warning-contrast-800: var(--color-warning-contrast-light);
\t--color-warning-contrast-900: var(--color-warning-contrast-light);
\t--color-warning-contrast-950: var(--color-warning-contrast-light);
\t--color-error-50: oklch(0.9 0.04 14);
\t--color-error-100: oklch(0.83 0.07 19.8);
\t--color-error-200: oklch(0.77 0.11 21.97);
\t--color-error-300: oklch(0.72 0.15 24.89);
\t--color-error-400: oklch(0.67 0.19 26.71);
\t--color-error-500: oklch(0.64 0.22 28.71);
\t--color-error-600: oklch(0.59 0.21 28.53);
\t--color-error-700: oklch(0.55 0.2 28.58);
\t--color-error-800: oklch(0.51 0.19 28.72);
\t--color-error-900: oklch(0.46 0.18 28.88);
\t--color-error-950: oklch(0.42 0.17 29.23);
\t--color-error-contrast-dark: var(--color-error-950);
\t--color-error-contrast-light: var(--color-error-50);
\t--color-error-contrast-50: var(--color-error-contrast-dark);
\t--color-error-contrast-100: var(--color-error-contrast-dark);
\t--color-error-contrast-200: var(--color-error-contrast-dark);
\t--color-error-contrast-300: var(--color-error-contrast-dark);
\t--color-error-contrast-400: var(--color-error-contrast-light);
\t--color-error-contrast-500: var(--color-error-contrast-light);
\t--color-error-contrast-600: var(--color-error-contrast-light);
\t--color-error-contrast-700: var(--color-error-contrast-light);
\t--color-error-contrast-800: var(--color-error-contrast-light);
\t--color-error-contrast-900: var(--color-error-contrast-light);
\t--color-error-contrast-950: var(--color-error-contrast-light);
`;

// Brand typography (issue #17): body = Inter, headings = Space Grotesk, both
// self-hosted via Fontsource (@import'd in src/routes/layout.css). These two
// Skeleton tokens are the source for body/heading; the MONO face (JetBrains Mono,
// used by the `font-mono` kickers/readouts) is Tailwind's --font-mono, in layout.css.
const GLOBAL = `\t--spacing: 0.25rem;
\t--text-scaling: 1.067;
\t--base-font-color: var(--color-surface-950);
\t--base-font-color-dark: var(--color-surface-50);
\t--base-font-family: 'Inter Variable', system-ui, sans-serif;
\t--base-font-size: inherit;
\t--base-line-height: inherit;
\t--base-font-weight: normal;
\t--base-font-style: normal;
\t--base-letter-spacing: 0em;
\t--heading-font-color: inherit;
\t--heading-font-color-dark: inherit;
\t--heading-font-family: 'Space Grotesk Variable', system-ui, sans-serif;
\t--heading-font-weight: bold;
\t--heading-font-style: normal;
\t--heading-letter-spacing: inherit;
\t--anchor-font-color: var(--color-primary-500);
\t--anchor-font-color-dark: var(--color-primary-400);
\t--anchor-font-family: inherit;
\t--anchor-font-size: inherit;
\t--anchor-line-height: inherit;
\t--anchor-font-weight: inherit;
\t--anchor-font-style: inherit;
\t--anchor-letter-spacing: inherit;
\t--anchor-text-decoration: none;
\t--anchor-text-decoration-hover: underline;
\t--anchor-text-decoration-active: none;
\t--anchor-text-decoration-focus: none;
\t--body-background-color: var(--color-surface-50);
\t--body-background-color-dark: var(--color-surface-950);
\t--radius-base: 0.25rem;
\t--radius-container: 0.5rem;
\t--default-border-width: 1px;
\t--default-divide-width: 1px;
\t--default-ring-width: 1px;
`;

const css =
	`/* DarcStar Technologies — custom Skeleton v4 theme.\n` +
	`   Brand accents map to the RGB "color-charge" triad; surface is a cool\n` +
	`   near-black void. Generated — run \`node scripts/gen-theme.mjs\` after editing. */\n` +
	`[data-theme='darcstar'] {\n` +
	GLOBAL +
	block('primary', ramp('#48c6ef')) + // cyan-blue  (charge-b)
	block('secondary', ramp('#3ddc84')) + // green     (charge-g)
	block('tertiary', ramp('#fb5a6f')) + // rose       (charge-r)
	SEMANTIC +
	block('surface', surfaceRamp()) +
	`}\n`;

const out = new URL('../src/themes/darcstar.css', import.meta.url);
writeFileSync(out, css);
console.log('wrote', out, `(${css.split('\n').length} lines)`);
console.log('primary-500 =', ok(...Object.values(ramp('#48c6ef')[500])));
console.log('secondary-500 =', ok(...Object.values(ramp('#3ddc84')[500])));
console.log('tertiary-500 =', ok(...Object.values(ramp('#fb5a6f')[500])));
