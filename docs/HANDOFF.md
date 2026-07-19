# Session handoff — state & roadmap

*Updated 2026-07-10 (PRs #43–#75 merged + template gallery). New session? Read this
first, then `docs/NOTES_PREVIEW_ENGINE.md` and `moldable-lite/README.md` for architecture.*

## What the app can do now (beyond the README basics)

- **Template gallery**: photo cards of 10 common parts (phone stand, cable clip, wall
  hook, box with lid, desk hook, plant pot, coaster, bag clip, cable winder, spacer) —
  one tap builds a parametric replicad model, no AI call, no key. Reachable from the
  entry card, the empty chat (4-card strip), and a topbar button. `src/cad/templates.ts`
  holds the programs (kernel conventions documented at the top of that file); each tap
  lands in a fresh project. Card thumbnails are REAL app renders committed at
  `src/assets/templates/*.webp` — regenerate by driving the UI with Playwright and
  saving each new project's auto-captured `thumb` (load template → poll
  `listProjects()` for the thumb → decode the data URL).

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
- **Build plates**: Bambu-Studio-style. A plate bar over the viewer (tabs with object
  counts, focus one plate, add/remove — up to 36), per-object "P2 ▾" plate menus in the
  Objects panel, layout persisted with the project. Export ▾ offers ONE project 3MF in the
  Bambu/Orca dialect (`Metadata/model_settings.config` plates + assemble + parts physically
  placed one bed-stride apart — archive verified structurally, NOT yet opened in a real
  Bambu Studio install; awaiting user confirmation) or the always-safe one-3MF-per-plate.
  Showcase mode (clean stage + turntable).
- **Fit testing (dry-fit sandbox)**: "Separate N parts" ungroups a model's disconnected
  solids (largest-by-bbox stays the model, rest become movable objects). Deliberately
  NOT committed to history — attachments live outside versions, so a committed split
  made Undo resurrect moved parts as duplicates. Instead: Undo/"Regroup parts" restores
  the pre-split result exactly; Merge commits the assembled outcome. "Check fit"
  boolean-intersects a part against the model (Manifold `intersect` op) and reports
  overlap volume; "Make it fit" grows the part by a true vertex-normal surface offset
  (worker `grow` op — bbox scaling FAILS on non-convex steps) and carves it from the
  model with 0.2 mm clearance; "Drop to plate" settles a floating part. History
  nav/restore/new-commit all dissolve lingering sandbox parts.
- **Scene UX**: right-click context menu (model/part/empty — rename, duplicate, copy/paste,
  delete, fit tools, plate assignment, zoom); everything renames in place (objects +
  model via Objects panel double-click, plates via plate-tab double-click; plate names
  persist and export as `plater_name`); separated parts render as an indented group
  under the model; middle-/right-drag pans; in-canvas zoom cluster (+ / fit / −);
  display toggles (dimensions, wireframe, stats, units, showcase, reset) consolidated
  into one View ▾ menu — toolbar carries tools, not switches.
- **Mark & ask ("circle it and ask")**: the Mark tool draws freehand on the viewport; on
  release, the current camera view + the red stroke composite into ONE annotated
  screenshot that lands in the composer (image.markup=true, camera azimuth/elevation
  captured). send() then uses `markupAddendum` (NOT the photo/vision addendum): image +
  full current program + "the marker is a pointer, the program is the source of truth,
  change only what's circled" + a view-direction phrase. Viewer gained `captureView()`
  (current-camera RT render) and `viewInfo()`. PRECISION (after a real-use miss where
  the AI tweaked fillets instead of removing a circled bar): the stroke interior is
  grid-sampled and raycast (`probeRegion`) → the request carries the region's
  program-frame bbox/centroid/normal in mm, the chip shows "covers ≈ W × D × H mm",
  and the addendum spells out remove/flatten = DELETE the creating feature. Multi-face:
  shift-CLICK adds faces to the marquee selection (dedup by centre) and the faces
  panel has "Extrude all N" (batch PointOps, one rebuild).
- **House AI (optional, DORMANT)**: infrastructure for the site owner to sponsor
  visitors with a server-side key — a "Built-in — free, no key" brain that only appears
  after `llm/house.ts` health-checks the owner's relay. Worker endpoints live in
  `proxy/cloudflare-worker.js` (`/house/health`, `/house/v1/chat/completions`; secret
  `HOUSE_KEY`, model allowlist, per-IP daily cap, KV optional). ENABLE = deploy worker +
  `wrangler secret put HOUSE_KEY` + set `HOUSE_RELAY_URL` in `src/llm/house.ts` + push
  (see proxy/DEPLOY.md "Sponsor your visitors"). Currently OFF — the user (Jerry) wants
  it available but not enabled; don't flip it without their say-so. Testing override:
  `localStorage.moldable_house_url`.
- **AI change preview (ask/auto)**: DEFAULT "ask" — every AI result (chat edit, full
  gen, generative mesh) is built then HELD: proposal shown on canvas with a real
  Manifold diff (green = added, red = removed, `computeChangeDiff`), Apply/Discard bar
  (top-centre), "always apply automatically" escape hatch + Settings → AI toggle
  (`moldable_ai_apply`). Only Apply commits (`deliverResult` gates the 3 AI apply
  sites; `applyResultNoCommit` drops a stale pending; new send discards quietly).
  Direct manipulations (sliders/push-pull/transform/imports) never gate.
- STL imports as editable faceted CAD; STEP as exact CAD; iPad toolbar/pointer work is solid.

## Conventions

- Ship each feature as its own PR to `main` (squash-merge; Pages auto-deploys ~2 min).
- Verify with Playwright against the real kernels (chromium at /opt/pw-browsers; harness
  pattern: boot app → "Try the built-in example" → drive UI → assert). Delete harnesses.
- The worker/engine test pattern and winding rules live in NOTES_PREVIEW_ENGINE.md.

## Agreed priority order for what's next

1. ~~**Template gallery**~~ — shipped (see above).
2. **PWA/offline** — manifest + service worker; installable on iPad.
3. **Bundle/first-load** — lazy-boot OCCT after first paint; code-split LLM providers
   (main bundle ~1.37 MB + 10.8 MB WASM today).
4. **Print profiles** — per-project printer + filament presets feeding clearances.
5. **Share links** — public viewable model page (showcase-style turntable).
6. **Failure analytics** — opt-in local event log of failed ops/builds.

Also queued (user-requested): texture LIBRARY (more procedural patterns + grayscale
height-map upload), full lighting controls (draggable key light, environment presets),
snap-to-object magnetism, per-axis scale for mesh models.
