// Render the Moldable app icons (PNG) from the brand box glyph via chromium.
// Maskable-safe: the glyph sits inside the central 80% so launchers can crop.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/home/user/3DRenderapp/moldable-lite/public/icons";
mkdirSync(OUT, { recursive: true });

// Teal rounded tile + white cube glyph (matches the favicon / topbar logo).
const svg = (size, radiusFrac) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17c3b0"/>
      <stop offset="1" stop-color="#0e9488"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="100" height="100" rx="${100 * radiusFrac}" fill="url(#bg)"/>
  <g transform="translate(50 51) scale(2.55)" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 -10 9 -5 9 5 0 10 -9 5 -9 -5Z"/>
    <path d="M-9 -5 0 0 9 -5"/>
    <path d="M0 0V10"/>
  </g>
</svg>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const shoot = async (name, size, radiusFrac) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}</style>${svg(size, radiusFrac)}`);
  await page.locator("svg").screenshot({ path: `${OUT}/${name}`, omitBackground: true });
  console.log("wrote", name);
};
await shoot("icon-192.png", 192, 0.22);
await shoot("icon-512.png", 512, 0.22);
await shoot("icon-maskable-512.png", 512, 0); // full-bleed square — the OS masks it
await shoot("apple-touch-icon.png", 180, 0); // iOS applies its own corner radius
await browser.close();
