// Generate the 1200x630 Open Graph / Twitter social card (issue #9).
//
// The card mirrors the live homepage — navbar wordmark + hero H1 + the GIDE
// kicker — over the same near-black void, so a link shared to investors on
// Slack/LinkedIn/email renders the actual brand, not a blank rectangle.
//
// Social scrapers (Slack, LinkedIn, Facebook, X) don't run JS and largely
// reject SVG cards, so we rasterize to PNG. Source of truth is THIS script:
// it composes a self-contained HTML doc (brand mark SVG + the three self-hosted
// variable fonts inlined as data URIs, so type is on-brand and offline) and
// screenshots it with headless Chromium (Playwright, already a dev dep) at
// exactly 1200x630. Output → src/lib/assets/og-image.png, which Seo.svelte
// fingerprint-imports (auto cache-bust: a regenerated card gets a new URL, so
// scrapers re-fetch instead of serving a stale cache).
//
// Regenerate:  node scripts/gen-og.mjs   (after a wordmark/tagline/brand change)
// Colours are the one-source brand triad (charge R/G/B) — do not re-type hexes
// elsewhere; they trace back to scripts/gen-theme.mjs.

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';

// Brand colour-charge triad — the single source is the theme (gen-theme.mjs).
const CHARGE = { r: '#fb5a6f', g: '#3ddc84', b: '#48c6ef' };

// --- self-hosted variable fonts, inlined so Chromium renders them offline -----
const FONTS = {
	grotesk: '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2',
	inter: '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
	mono: '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'
};
const dataUri = (rel) => {
	const b64 = readFileSync(path.join(root, 'node_modules', rel)).toString('base64');
	return `data:font/woff2;base64,${b64}`;
};

// --- the brand mark: static pose of the animated favicon (black hole + three
// tilted colour-charge orbital rings, each with a bright leading particle-arc).
// Geometry is lifted verbatim from src/lib/assets/favicon.svg; the animation is
// dropped and the three particle-arcs are frozen ~120deg apart for a balanced
// still. viewBox matches the favicon so the coordinates carry over unchanged.
const mark = `
<svg viewBox="-3 -1 112 112" width="132" height="132" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="sph"><stop offset="0.55" stop-color="#04050a"/><stop offset="0.92" stop-color="#0d1017"/><stop offset="1" stop-color="#232a35"/></radialGradient>
    <clipPath id="front"><rect x="-20" y="56" width="140" height="68" transform="rotate(-15 38 56)"/></clipPath>
    <clipPath id="top"><rect x="-20" y="-16" width="140" height="72" transform="rotate(-15 38 56)"/></clipPath>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <circle cx="38" cy="56" r="24" fill="url(#sph)"/>
  <circle cx="38" cy="56" r="25.5" fill="none" stroke="#ffffff" stroke-width="0.8" opacity="0.55" clip-path="url(#front)"/>
  <g transform="rotate(-15 50 52)" filter="url(#glow)">
    <ellipse cx="56" cy="52" rx="51" ry="14.4" transform="rotate(-7 56 54)" fill="none" stroke="${CHARGE.r}" stroke-width="4.5" stroke-linecap="round"/>
    <ellipse cx="56" cy="52" rx="51" ry="14.4" transform="rotate(-7 56 54)" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="77 145" opacity="0.4" stroke-dashoffset="-72.5"/>
    <ellipse cx="56" cy="52" rx="51" ry="14.4" transform="rotate(-7 56 54)" fill="none" stroke="#ffb3bd" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="27 195" stroke-dashoffset="0"/>
    <ellipse cx="56" cy="54" rx="51" ry="14.4" fill="none" stroke="${CHARGE.g}" stroke-width="4.5" stroke-linecap="round"/>
    <ellipse cx="56" cy="54" rx="51" ry="14.4" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="77 145" opacity="0.4" stroke-dashoffset="-72.5"/>
    <ellipse cx="56" cy="54" rx="51" ry="14.4" fill="none" stroke="#a5f2c6" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="27 195" stroke-dashoffset="-74"/>
    <ellipse cx="56" cy="56" rx="51" ry="14.4" transform="rotate(7 56 54)" fill="none" stroke="${CHARGE.b}" stroke-width="4.5" stroke-linecap="round"/>
    <ellipse cx="56" cy="56" rx="51" ry="14.4" transform="rotate(7 56 54)" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="77 145" opacity="0.4" stroke-dashoffset="-72.5"/>
    <ellipse cx="56" cy="56" rx="51" ry="14.4" transform="rotate(7 56 54)" fill="none" stroke="#aee6fb" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="27 195" stroke-dashoffset="-148"/>
  </g>
  <circle cx="38" cy="56" r="24" fill="url(#sph)" clip-path="url(#top)"/>
  <circle cx="38" cy="56" r="25.5" fill="none" stroke="#ffffff" stroke-width="0.8" opacity="0.55" clip-path="url(#top)"/>
  <g><circle cx="38" cy="56" r="27.5" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.22"/><path d="M10.5 56 A27.5 27.5 0 0 1 65.5 56" transform="rotate(-15 38 56)" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" opacity="0.7"/></g>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'Space Grotesk';font-weight:100 700;src:url('${dataUri(FONTS.grotesk)}') format('woff2');}
  @font-face{font-family:'Inter';font-weight:100 900;src:url('${dataUri(FONTS.inter)}') format('woff2');}
  @font-face{font-family:'JetBrains Mono';font-weight:100 800;src:url('${dataUri(FONTS.mono)}') format('woff2');}
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1200px;height:630px;}
  .card{
    position:relative;width:1200px;height:630px;overflow:hidden;
    background:#04050a;color:#fff;font-family:'Inter',sans-serif;
    display:flex;flex-direction:column;justify-content:center;
    padding:0 92px;
  }
  /* Cosmic void: faint charge-glow blobs low + a vignette, echoing CosmicBackdrop. */
  .card::before{content:'';position:absolute;inset:0;
    background:
      radial-gradient(60% 55% at 82% 18%, ${CHARGE.b}22, transparent 70%),
      radial-gradient(55% 50% at 12% 92%, ${CHARGE.r}1f, transparent 70%),
      radial-gradient(50% 45% at 55% 108%, ${CHARGE.g}1a, transparent 70%),
      radial-gradient(120% 120% at 50% 40%, transparent 55%, #000000cc);
  }
  .card > *{position:relative;z-index:1;}
  .wordmark{display:flex;align-items:center;gap:22px;margin-bottom:44px;}
  .wordmark svg{filter:drop-shadow(0 6px 24px #0009);}
  .wordmark .name{font-family:'Space Grotesk';font-weight:700;font-size:58px;letter-spacing:-0.015em;line-height:1;}
  h1{font-family:'Space Grotesk';font-weight:500;font-size:70px;line-height:1.06;
     letter-spacing:-0.022em;max-width:1010px;text-wrap:balance;}
  .flow{
    background-image:linear-gradient(95deg,${CHARGE.r},${CHARGE.b} 52%,${CHARGE.g});
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  .kicker{margin-top:40px;font-family:'JetBrains Mono';font-weight:500;
    font-size:23px;letter-spacing:0.26em;text-transform:uppercase;color:#ffffff99;}
</style></head><body>
  <div class="card">
    <div class="wordmark">${mark}<div class="name">DarcStar <span class="flow">Technologies</span></div></div>
    <h1>Autonomous control you can <span class="flow">prove</span> is safe.</h1>
    <div class="kicker">GIDE · Guaranteed Intelligent Dynamics Engine</div>
  </div>
</body></html>`;

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 1200, height: 630 },
	deviceScaleFactor: 1
});
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const out = path.join(root, 'src/lib/assets/og-image.png');
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 }, type: 'png' });
await browser.close();

console.log(
	`og-image.png written (${(statSync(out).size / 1024).toFixed(0)} KB) → src/lib/assets/og-image.png`
);
