# Playwright verification harness

Every feature shipped to Moldable since the template gallery was verified by one of
these scripts — real Chromium against the real dev app (real OCCT/replicad kernel,
real workers), with ONLY the external paid/quota'd APIs route-stubbed. They are
regression suites: re-run the relevant ones after touching the areas they cover.

## Setup & run

```bash
# 1. dev server (relay included) — from moldable-lite/
npm run dev

# 2. from this directory
npm install                 # playwright (the npm package only)
node cost-e2e.mjs           # or any other *-e2e.mjs
```

Chromium: scripts launch `executablePath: "/opt/pw-browsers/chromium"` (the Claude
Code remote container's pre-installed browser). On another machine, either run
`npx playwright install chromium` and drop the `executablePath` option, or point it
at your local Chrome.

Screenshots (`shot-*.png`) land beside the scripts and are gitignored.

## Suite map (what to re-run when)

| Script | Covers |
| --- | --- |
| `engine-audit.mjs` | ALL templates × build/rotate/scale/chamfer/params × 4 export formats — the big CAD-kernel regression |
| `cost-e2e.mjs` | Mesh cost clarity: pre-flight price tags, spend ledger, Settings Cost & balance, live balance check (stubbed Meshy) |
| `hf-fallback-e2e.mjs` | Free-GPU rejection → automatic keyed-engine retry → honest double error (stubbed HF Space + relay) |
| `routing-e2e.mjs` | Mesh/CAD auto-routing + prompt polish (mock LLM brain on :8788) |
| `printprep-e2e.mjs`, `printpack2-e2e.mjs` | Overhang heatmap, auto-orientation, thin walls, elephant-foot chamfer, tolerance coupon, fastener presets |
| `library-thumbs-e2e.mjs`, `library-organize-e2e.mjs`, `library-bulk-e2e.mjs` | Studio thumbnails + background upgrade; search/sort/filter/folders; multi-select delete/move |
| `flashfix-e2e.mjs`, `theme-toggle-e2e.mjs` | Reload-loop guard (sync churn) and light/dark pre-paint parity |
| `pwa-e2e.mjs`, `settings-e2e.mjs`, `touch-e2e.mjs`, `ipad-audit.mjs` | Install/offline, Settings panes, mobile/touch behaviour |
| `sandbox*-e2e.mjs`, `fit-e2e.mjs`, `plates-e2e.mjs`, `hole-e2e.mjs`, `measure2-e2e.mjs`, `dims-e2e.mjs`, `precision-e2e.mjs`, `preview-e2e.mjs`, `mark-e2e.mjs`, `context-e2e.mjs`, `ux-e2e.mjs`, `house-e2e.mjs`, `local-e2e.mjs`, `export-e2e.mjs` | Earlier feature suites — separation/fit, build plates, hole tool, measuring, dims box, AI preview, mark & ask, chat context, house AI, on-device model, exports |
| `gen-thumbs.mjs`, `gen-icons.mjs`, `app-shots.mjs`, `shots2.mjs`, `canvas-shots.mjs` | Asset/screenshot generators (not tests) |
| `*-probe*.mjs`, `local-debug.mjs`, `probe.mjs`, `lib.mjs`, `templates.mjs`, `e2e.mjs` | One-off probes / shared helpers / the original smoke test |

## Test-writing gotchas learned the hard way

- `innerText` skips collapsed `<details>` — assert on `textContent`.
- The Library "Select" button collides with the viewer's Select tool by accessible
  name — target it via its `title`.
- One-shot chat announcements get overwritten by the engine's first progress event
  within milliseconds — either keep context in every progress line (app-side rule)
  or `waitForFunction` on the persistent line, not a flash.
- Modal overlays intercept clicks — close via the `.overlay .x` button first.
- Keep `addInitScript` bodies plain JS (no TS syntax) — they run raw in the page.
