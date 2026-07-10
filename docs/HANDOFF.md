# Session handoff — state & roadmap

*Updated 2026-07-10 (PRs #43–#74 merged). New session? Read this first, then
`docs/NOTES_PREVIEW_ENGINE.md` and `moldable-lite/README.md` for architecture.*

## What the app can do now (beyond the README basics)

- **Dual-kernel live editing**: OCCT (replicad) is the source of truth; Manifold (WASM
  worker) powers live extrude previews, Merge, and surface-texture displacement.
- Direct edits: push-pull extrude / drag-to-fillet with live preview; over-limit sizes are
  probed and auto-clamped with an honest message.
- **Selection**: tap a part → bounding box + corner anchors (drag = uniform scale) + combined
  move/rotate gizmo (arbitrated: nearest handle wins, translate beats rotate on ties).
  Snapping menu (move mm / rotate °). Corner orientation gizmo (drag orbits, click snaps).
- **Multi-object scene**: drop STL/GLB/SVG onto the canvas → new objects (never replaces the
  model); Objects panel with group select (checkboxes), group transform, Merge selected/all.
- **AI**: OpenRouter Auto default (vision-aware; picks per request, replies show the model);
  Generative-tab Auto; fresh-chat routing (organic → mesh, dimensioned → CAD); AI-drawn SVG
  logos ("add an apple logo") land as movable attachments; markdown chat with live thinking
  + research source chips.
- **Materials & textures**: colour/finish picker; AI meshes keep their baked textures;
  physical surface textures (knurl/hex/noise) as real displaced geometry.
- **Build plates**: P1/P2/P3 badges per object, plate filter, one 3MF per plate with named
  separate objects (Bambu/Orca-friendly). Showcase mode (clean stage + turntable).
- STL imports as editable faceted CAD; STEP as exact CAD; iPad toolbar/pointer work is solid.

## Conventions

- Ship each feature as its own PR to `main` (squash-merge; Pages auto-deploys ~2 min).
- Verify with Playwright against the real kernels (chromium at /opt/pw-browsers; harness
  pattern: boot app → "Try the built-in example" → drive UI → assert). Delete harnesses.
- The worker/engine test pattern and winding rules live in NOTES_PREVIEW_ENGINE.md.

## Agreed priority order for what's next

1. **Template gallery** — photo cards of common parts (phone stand, cable clip, hook, box
   with lid…), one tap → parametric model, no API key. Biggest onboarding win.
2. **PWA/offline** — manifest + service worker; installable on iPad.
3. **Bundle/first-load** — lazy-boot OCCT after first paint; code-split LLM providers
   (main bundle ~1.26 MB + 10.8 MB WASM today).
4. **Print profiles** — per-project printer + filament presets feeding clearances.
5. **Share links** — public viewable model page (showcase-style turntable).
6. **Failure analytics** — opt-in local event log of failed ops/builds.

Also queued (user-requested): texture LIBRARY (more procedural patterns + grayscale
height-map upload), full lighting controls (draggable key light, environment presets),
snap-to-object magnetism, per-axis scale for mesh models, Bambu single-file multi-plate
project export (proprietary; per-plate 3MF shipped instead).
