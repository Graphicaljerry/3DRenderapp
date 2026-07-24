# Session handoff — state & roadmap

*Updated 2026-07-23 (PRs #43–#123 merged; latest code: snap-in-flyout / "Set
size…". Design file rebuilt + consolidated in Figma — see "Figma design file"
below). New
session? Read this first, then `docs/NOTES_PREVIEW_ENGINE.md` and
`moldable-lite/README.md` for architecture.*

## Figma design file (Moldable — Design & Assets)

File key `1P7VBfxbJ62kjYXvd94tYF` (Jerry's link: figma.com/design/1P7VBfxbJ62kjYXvd94tYF).
Rebuilt 2026-07-23 to mirror the deployed v208 UI — **everything is editable
layers except the 3D canvas**, which is a real in-app render (phone-stand
template, dark theme) captured by `harness/canvas-clean.mjs` and set as an
image fill via the Figma MCP `upload_assets` → `imageHash` on the canvas frame.

- Pages: **Assets** (empty), **Screens** (everything). On Screens:
  - `73:2` **Workspace — dark · v208** at (3071,1069) — the hero. Canvas `76:2`
    carries the render fill; rail/stats/snaps/zoom/statusbar float above as
    editable layers. Story is coherent end-to-end: Phone stand, 77.8 × 70 ×
    77.9 mm, 52 tris / 76.2 cm³, Precise (CAD) active (mesh texture chip kept
    as hidden layer `74:17`).
  - `93:64` **Workspace — Settings open · v208** — the one popup-over-app
    artboard (dim + card, Appearance pane). Jerry's rule, stated 2026-07-23:
    **"Don't make too many artboards of the same thing"** — so the other three
    popup states were consolidated onto `102:2` **Menus & panels — v208** at
    (6530,1069): View menu (full row list), Objects panel + export menu open
    (CAD badge, plates row), Transform flyout (Move/Rotate/Scale + Set size… +
    Snap). The three full-workspace clones they came from were deleted.
  - Inside Jerry's "Styling & Components" section: `90:2` **Moldable — UI kit**
    — all 39 `icons.tsx` icons as true vectors (24px grid, 1.8 stroke, exact
    paths), cloned specimens of every control, provenance badges, dark palette
    swatches.
  - The 2026-07-19 artboards are renamed with a "(v1)" suffix — superseded, kept.
  - **Light-mode v208 set (added 2026-07-24, Jerry's request)**: every dark v208
    artboard now has a light twin, built by cloning the dark node and running a
    dark→light hex-remap pass (the styles.css `:root` vs `[data-theme=dark]` map)
    over all descendant fills/strokes, then swapping the 3D-canvas image for a
    light-theme render (`harness/canvas-clean.mjs THEME=light`). Light nodes:
    `108:2` Workspace — light · v208, `109:2` Workspace — Settings open · light,
    `110:2` Menus & panels — light, `112:2` UI kit — light (icons/controls/badges
    recolored; the palette row was dropped — the dedicated Colors — Light board
    covers it accurately, and the build plate stays dark slate in BOTH themes so a
    recolored plate swatch would have been wrong). Re-run trick if more dark nodes
    appear: scan for opaque solid fills with luminance < 0.28 that aren't the
    theme's own ink (#18201E/#333D39) or the intentional dark plate (#363C42),
    then remap the stragglers (dark-teal pills → #E7F5F2, dark neutrals → #EFF1F4).
- Jerry asked (2026-07-23) for Figma MCP calls to auto-accept: `.claude/settings.json`
  now allowlists `mcp__Figma`. It loads at session start, so new sessions run
  prompt-free; a settings file created mid-session may not hot-load.
- Gotchas that cost time: `upload_assets` with `nodeId` may commit the image
  but not apply the fill — re-apply via `use_figma` with the returned
  `imageHash`; `figma.createAutoLayout`/`createFrame` default to a WHITE fill
  (always set `fills = []`); the workspace frames' small icons are Inter glyph
  texts — a swap map in this session's scripts replaces ▻ ✥ ⟋ ⟠ ▦ 📎 🎤 with
  the real vectors; `query()` selectors reject `/` in attribute values (use
  `findAll`); text-match anchors must be exact ("◇ View", not "View" — that
  matches the "3D View" tab first).

- **Native macOS app scaffold (#131)**: `moldable-lite/src-tauri/` wraps the
  existing web `dist/` in **Tauri v2** → a tiny (~20-35 MB) Apple-Silicon `.dmg`.
  Chosen over Electron because the app is WKWebView-safe (no SharedArrayBuffer/
  threads; single-threaded WASM; same-origin ES module workers; one Supabase
  origin). `vite.config.ts` edits are **env-gated on `TAURI_ENV_PLATFORM`** — the
  web build is byte-identical (PWA on, absolute base); the Tauri build drops the
  service worker + uses relative `./` base (verified: web has sw.js, tauri build
  has none). CI: `.github/workflows/build-mac.yml` builds the `.dmg` on a `macos-14`
  runner via `tauri-apps/tauri-action` on `v*` tags (unsigned beta; APPLE_* secrets
  commented for later signing). The `.dmg` can ONLY be built on macOS — not on this
  Linux box. Only the *optional* on-device WebLLM degrades (WebGPU, macOS 26+).
  Fast-follow: `.3mf`/`.stl`/`.step` file associations via a small Rust addition +
  tauri-plugin-fs/dialog. See `src-tauri/README.md`.
- **Engine switch is now three-way (#130)**: the composer toggle is **Auto ·
  Precise (CAD) · Generative (AI mesh)**, `App.ModePref = "auto" | Mode`. `mode`
  stays the RESOLVED engine (viewer/badge); `modePref` (persisted
  `moldable_mode_pref`, **default "auto"**) is the user's choice. Auto is the
  visible form of the routing that already existed — the send() classifier
  (`classifyIntent` + ORGANIC_RE/CADISH_RE heuristics) is now gated on
  `modePref === "auto"` (was the private `modeTouched` ref, removed). Picking
  Precise/Generative pins the engine; the brain picker + web toggle show for
  auto|precise, the engine picker for generative. Routing note reworded to "Auto
  chose …". Test: `harness/automode-e2e.mjs`.

## Resuming in a new session — read me first

- **Workflow (standing instruction from Jerry): everything ships to main.** Develop
  on your session's designated `claude/...` branch, commit, push, open a PR with
  the GitHub MCP tools, **squash-merge it immediately yourself**, then
  `git fetch origin main && git merge origin/main` and push the branch again. Don't
  wait for review, don't force-push (it's denied).
- **Verify before shipping**: the Playwright suites live in `harness/` (see its
  README for setup, the suite map, and hard-won test gotchas). Start the dev server
  from `moldable-lite/` (`npm run dev` — it includes the /prox relay), run the
  suites touching your area, plus `npx tsc --noEmit` and `npm run build`.
- **Standing product rules**: the house AI (sponsored-key relay) stays DORMANT
  unless Jerry explicitly asks to enable it. Bambu multi-plate project 3MF AND the
  new per-part colour→filament export (#126) are awaiting confirmation in a real
  slicer — encoded to the documented Bambu/Orca dialect and unit-tested
  (`harness/color3mf-e2e.mjs`), but not yet opened in Bambu Studio itself. Don't
  declare the colour handoff "done" until Jerry confirms the AMS slots come through.
- **Sandbox limits (Claude Code remote)**: shell/browser egress to huggingface.co,
  *.hf.space and api.meshy.ai is blocked — stub external APIs with Playwright
  route interception (see `harness/hf-fallback-e2e.mjs`, `harness/cost-e2e.mjs`);
  server-side WebSearch works for research.
- **Queued / open items**:
  - **Jerry asked (2026-07-22) — (a) SHIPPED as the texture toggle (#113); (b)
    still open**: (a) untextured / grayscale mesh generation option; (b) cheap
    multi-engine preview → pick → final. Also still open from that batch:
    per-object AI attribution for attachments + storing the writing LLM per CAD
    version (Objects badge currently says "CAD"), and Bambu-style per-region
    fill-color painting (big feature).
    FINDINGS (verified 2026-07): texture is the EXPENSIVE add-on everywhere —
    fal Hunyuan3D v2 white mesh $0.16 vs textured 3× ($0.48, `textured_mesh` bool);
    Tripo `texture:false, pbr:false` → untextured base model, credits drop below the
    ~20-credit v3 base (texture quality is a paid add-on); Meshy in THIS app already
    sends `should_texture:false` (geometry-only preview mode) — that's why Meshy runs
    come out gray. HF free Space: shape-only stages burn fewer free GPU minutes.
    PLAN: one persisted "Texture: on/off (print-first)" toggle in Generative mode,
    default OFF for text prompts / ON for photo recreations; wire per provider
    (tripo: texture+pbr bools; fal v2: textured_mesh; fal v3.x: verify param name
    live before shipping — sandbox can't reach fal); update gen/registry usd fields
    to show both prices. Preview strategy: do NOT fan out 4 full paid generations —
    use (1) the FREE HF engine as the concept preview, (2) native two-stage flows
    (Meshy preview→refine continues the SAME task; Tripo draft→refine) so "preview
    then commit" wastes nothing, (3) an explicit opt-in "Compare engines" that runs
    untextured/preview stages only (~$0.16–0.35 total) and refines the winner.
    Per-part fill colour: SHIPPED (#126). Objects-panel swatch on the model + each
    attachment (Bambu-Basic palette + custom picker + clear), rendered live in the
    viewer, persisted per project (`Project.partColors`), and exported so the slicer
    picks it up — distinct colours become filament slots: project 3MF writes per-object
    `extruder` + `Metadata/project_settings.config` `filament_colour`; core per-plate
    3MF writes `<basematerials>` displaycolor + object `pid/pindex`. Unpainted parts
    share a neutral default filament (slot 1).
    Per-FACE MMU paint (Bambu Colour-Painting): SHIPPED MVP (#128). Paint tool in the
    canvas rail (`IconPaint`) with a filament palette + smart-fill angle slider + "Erase
    all". Click a face → crease-aware flood-fill (`paintFillRegion`, reuses the
    face-select `smoothRegion`/`faceRegion`) → those triangles fill the active filament;
    rendered live via a de-indexed RGBA vertex-colour overlay on the model (`s.paintMesh`
    / `s.triColor` in Viewer.tsx). Persisted as `Project.facePaint = {count, b64}` (base64
    of a per-triangle palette-index Uint8Array; `count` guards a reshaped mesh → paint
    dropped, not mispainted). Export (`platesToProject3MF`) writes bare `paint_color` on
    each `<triangle>` — the VERIFIED Bambu/Orca hex-segmentation codec `encodePaintColorWhole`
    (slot1="4", slot2="8", slotK≥3=hex(K−3)+"C"; string is REVERSED vs emission — root
    nibble last; keyed POSITIONALLY to triangle document order, which matches three.js
    `faceIndex` and the exporter's loop). Painted colours fold into the SAME filament
    palette as whole-part colours (`buildFilaments`), so `filament_colour` covers every
    painted slot (dodges Bambu's silent `max_ebt` clamp). Tests: `harness/facepaint-3mf-e2e.mjs`
    (codec vectors + round-trip decode + export unzip/positional-keying + UI paint→persist→erase).
    ⚠️ NOT yet confirmed in real Bambu Studio — codec is source-verified but the full
    import chain (paint_color + filament_colour + object extruder) needs a smoke test there.
    Brush + per-region eraser: SHIPPED (#129). The Paint flyout now has a Fill|Brush
    tool toggle: Fill = click bucket (smart-fill angle), Brush = press-drag freehand
    (radius-bounded `brushRegion` BFS over adjacency, brush size = % of the model's
    largest dim; drag owns the pointer like the tape-measure drag). An eraser swatch
    (slot 0) removes paint with either tool. Works on CAD AND meshes (the earlier
    screenshot was a CAD phone stand — Fill uses the B-rep faceId there for clean whole-
    face fills; meshes use the dihedral flood-fill). Tests extended in facepaint-3mf-e2e.
    STILL OPEN (future phases): same-colour bucket + eyedropper, paint on ATTACHMENTS
    (MVP paints the model mesh only), gap-fill, section view, and CAD-edit-resilient
    spatial paint replay (MVP paint is guaranteed correct on stable meshes — STL/GLB/gen;
    a CAD fillet/chamfer reshuffles triangles and the `count` guard drops the paint on the
    next export).
  - Wire the newer free HF Spaces (tencent/Hunyuan3D-2.1, microsoft/TRELLIS.2,
    stabilityai/stable-point-aware-3d) into `gen/providers/hf.ts` — researched and
    promising, but their Gradio endpoint signatures couldn't be verified from the
    sandbox (egress blocked). Verify signatures first, then add to the def map.
  - Offered to Jerry, unanswered: HDRI environment map for studio thumbnails;
    drag-a-card-onto-a-folder-chip in the Library.
- **Key architecture lessons** are inlined in the feature notes below — the ones
  that bite: any synced `moldable_*` localStorage key that rewrites itself causes a
  cloud-pull reload loop (put caches in `LOCAL_ONLY_KEYS`, `lib/backup.ts`);
  anything the index.html pre-paint script sets inline must also be set by the
  theme effect; offscreen render targets are linear (LUT on readback); OCCT edge
  selection on meshed shapes needs curve sampling, not bboxes.

## What the app can do now (beyond the README basics)

- **In-canvas tool rail (2026-07-22, Jerry-approved design)**: the head row now
  carries TABS ONLY — pointer tools moved into a vertical Photoshop-style rail
  docked at the canvas's LEFT edge (`.canvas-rail`: Select [CAD only], Transform,
  Measure, Mark, separator, Material/Surface/Snap menus; icon-only, titles carry
  words; active-tool flyouts open to the RIGHT via `.rail-tool`/`.rail-fly` —
  Transform's flyout holds Move/Rotate/Scale + Resize). Undo/redo + View ▾ +
  Objects + Help live in `.canvas-tr` (top-right in-canvas); `.mesh-stats` moved
  down to top:56px. All aria-labels/titles preserved, so harness selectors kept
  working. The narrow-width toolbar wrapping problem is structurally gone.
  PLATE v2: dark slate in BOTH themes (first light cut was near-background and
  read as "no change") and ONE-SIDED (PlaneGeometry FrontSide) — orbiting under
  the bed still shows the model's underside; a solid slab broke printprep B1's
  from-below heatmap check until this. TEST GOTCHA: dims-e2e counts accent pixels
  over the canvas REGION — the rail's active-state accents (Snap is on by
  default) sit inside it now; its colorCount skips the left 80px / top 60px.

- **Build plate + colored parts (2026-07-22)**: (1) View ▾ **Build plate** (default
  ON, `moldable_plate`) — a solid Bambu-style slab sized to `printer.bed` under the
  model (`buildPlate()` in Viewer; slab top at z=-0.06 so bottoms/grid never
  z-fight; rebuilt on bed/theme change; hidden in showcase; captures use a
  throwaway scene so thumbs are unaffected). (2) **Separate parts now tint each
  part a distinct pastel** (PART_TINTS in separateParts — Meshy-splitter look; the
  Objects-panel dot matches; display-only, Merge/Regroup untouched). (3) Clay view
  is double-sided (#115) — panel-line slits stopped reading as black scratches.
  QUEUED with Jerry (he asked, needs design confirmation): in-canvas vertical tool
  rail (Photoshop-style) replacing the wrapping head toolbar at narrow widths;
  semantic part-splitting à la Meshy (needs their API or segmentation research —
  we have disconnected-shell Separate + planar Split-to-fit today).

- **Clay grayscale view (2026-07-22, follow-up to the color pack)**: the first
  Grayscale cut looked like a "pencil sketch" (real report) — AI mesh soups are
  non-indexed with FLAT per-triangle normals, and the baked texture had been
  hiding the faceting + shell-seam noise. Now View ▾ Grayscale renders a studio
  CLAY look: Viewer gets a `clay` prop → (1) `toCreasedNormals(geo, 40°)` builds a
  smooth-normal DISPLAY copy for non-indexed, non-vertex-color geometry (cached in
  a module WeakMap keyed by the source geometry; positions identical so raycast
  picking/measure/dims land true; exports untouched); (2) clay material override
  (#b9bec3, roughness .62, metalness .03, map off); (3) softer key light (dir 0.9,
  hemi 1.3) so facet/z-fight contrast drops. Verified by a sphere-GLB pixel probe
  + texture-e2e (Grayscale rows) + preview-e2e (push-pull unaffected — the clay
  geometry-swap effect only reacts to [clay, geometry], never mid-drag).

- **Print-first color pack (2026-07-22, Jerry batch #2)**: (1) **Texture toggle** —
  mesh generation is geometry-only by DEFAULT (gray, print-first); composer chip
  ("⬜ Color: off — print-first" / "🎨 Color: on") + a Settings → 3D engine
  checkbox (`moldable_gen_texture`). Wired per provider: meshy `should_texture`,
  tripo `texture`+`pbr`, fal Hunyuan v3.x `generate_type` Geometry/Normal and v2
  `textured_mesh` (Rodin + the free HF spaces always texture — the Settings hint
  says so). Texture is the expensive stage (fal v2 charges 3×), so default-off
  also halves paid costs. (2) **View ▾ Grayscale** — display-only texture hide
  (App passes texture=null to the viewer; persisted `moldable_gray`); exports and
  the stored glb keep color. (3) **Objects-panel provenance badge** (`.lp-badge`)
  — the model row shows WHICH engine made it, color-coded per provider (fal
  violet, tripo blue, meshy green, hf amber, replicate pink); deterministic
  sources read plainly ("imported file", "SVG"…); CAD models show "CAD" —
  per-version LLM attribution isn't stored yet (future: aiModel on Version).
  (4) **Toolbar slims for meshes** — the Select tool (CAD feature edits) hides
  when activeKind !== "replicad"; Transform/Resize/Measure/Mark/View stay.
  (5) **Light mode softened** (too-bright report): `--surf` #e9edec, `--bg`
  #f8faf9, borders re-tuned, viewer stage #eceff0 — index.html's pre-paint now
  sets the LIGHT backdrop too and the theme effect mirrors it (the pre-paint
  rule). Verified by `harness/texture-e2e.mjs` (17 checks: default+toggled
  request bodies through the real UI for Tripo and at module level for fal
  v3.1/v2 + Meshy, badge, Select gating, Grayscale persistence) + theme-toggle
  re-run. TEST GOTCHAS: the View ▾ button needs `button[title^="View options"]`
  targeting; a generated mesh is a HELD preview until Apply — `result` (and the
  badge) only exist after commit.

- **Print-fit pack (2026-07-22, direct Jerry request)**: (1) REAL BUG FIXED — the
  transform gizmo on a MESH model silently reverted (`authorObjectOp` only handled
  CAD; the gizmo pivot arms for any mesh and its commit was swallowed). Mesh models
  now BAKE gizmo move/rotate/scale via `print/resize.ts` (`bakeMeshTransform`) and
  record the cumulative matrix as **`meshXform`** (EngineResult + Version/Project +
  all versions.ts copy sites) — the ORIGINAL glb and its baked texture stay
  untouched; `showFromGlb` replays the matrix on reopen and thumb rebuilds replay
  it too. (2) **Generated meshes auto-fit the plate** (runGen: `fitToBedFactor`,
  margin 0.95 — engines return unit-less "car-sized cars"; real case: a 1161 mm
  Gallardo on a 320 mm bed) with the scale noted in the chat summary; file IMPORTS
  keep true size deliberately. (3) **Fit to plate — scale down** button in
  Printability's too-big block (next to Split) and in the Resize panel. (4) **Typed
  resize**: Transform toolbar → Resize popover (W/D/H mm linked + uniform % +
  per-axis for meshes; CAD stays uniform via the parametric scale op), and the
  Selection inspector's W/D/H typing now works for meshes too (canScale gate
  relaxed — `scaleToDim` routes through the same authorObjectOp). (5)
  `applyOrientation`'s mesh branch switched to meshXform — the old glb→STL swap
  LOST baked textures on auto-orient. (6) SECOND REAL BUG: STL-as-CAD imports were
  re-read as STEP on undo/reopen ("This shape has not type, it is null") —
  **`importKind`** is now persisted on versions and passed by `rebuildHead`; and
  STEP/STL drops boot the kernel on demand (ensureEngine) instead of bouncing
  "try again in a few seconds". Verified by `harness/resize-e2e.mjs` (13 checks:
  exact matrix round-trips, GLB mesh flow incl. reload persistence, STL-as-CAD
  flow incl. the undo fix) + printprep re-run.

- **First-load & bundle split (2026-07-22)**: the entry bundle is ~3 kB + React
  (~47 kB gz before first paint, was 459 kB gz) — `main.tsx` lazy-imports the whole
  App (the `import()` fires at module eval so the chunk streams while a themed
  `.boot-splash` paints; Suspense at root). **OCCT warm-up is deferred** to
  load-event + `requestIdleCallback` (boot effect in App.tsx); every need-it-now
  path (send / STEP-STL import / template / example / rebuildHead) goes through
  `ensureEngine()` — which also fixed a real race: rebuildHead used to silently
  SKIP the build when a resume/open beat the boot (empty viewer). Code-split on
  demand: meshoptimizer (simplify), three-mesh-bvh (thin walls), three-bvh-csg
  (split / svg / fallback engine), exportClient (fflate + OBJ/3MF writers —
  `geometryToSTL` stayed eager in new `print/stl.ts`; `HEAVY_TRIANGLES` moved to
  `print/heavy.ts` so UI reads don't pull meshoptimizer), gen providers (lazy
  thunks in registry — defs stay eager for Settings), `gen/loadMesh` (GLTFLoader),
  GenerativeEngine (`getGenEngine()`), ExtrudeModal (React.lazy). Vite
  `manualChunks`: three / react / supabase / webllm — stable vendor hashes mean a
  deploy re-ships ~416 kB of app code, not 1.48 MB. **PWA precache 19.4 → 13.5 MB**:
  the ~6 MB webllm chunk is `globIgnore`d and runtime-cached (CacheFirst) on first
  real use, so on-device AI still works offline after first use (pwa-e2e re-passed).
  `@gradio/client` dep removed (hf.ts talks raw Gradio HTTP). GOTCHAS: TemplateStrip
  renders on the FIRST screen, so TemplatesModal + cad/templates must stay eager;
  headless software-GL Chromium emits no FCP entries — boot-e2e anchors "painted
  before wasm" on a #root MutationObserver. Verified by `harness/boot-e2e.mjs`
  (splash while app chunk slowed, wasm request after load+idle, example-before-boot
  preemption) plus engine-audit / printprep / export / plates / fit / theme-toggle /
  pwa suites.

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
- **Dark composer in light mode FIXED**: the index.html pre-paint script pins
  `style.colorScheme` INLINE; the theme effect only set dataset.theme, so after a
  dark→light toggle native form controls (composer textarea) kept UA-dark styling.
  Theme effect now mirrors the inline styles (colorScheme + backgroundColor); CSS
  gained `:root { color-scheme: light }` / dark override; composer textarea got an
  explicit `background: var(--bg); color: var(--ink)` base. RULE: anything the
  pre-paint script sets inline MUST be updated by the theme effect too. Verified by
  `harness/theme-toggle-e2e.mjs` (dark boot → light toggle → white composer → back).
- **Mesh cost clarity**: every gen model in `gen/registry.ts` carries `usd` (+
  optional `credits`) — `costUsd()` / `costLabel()` render "free (daily GPU
  minutes)" / "≈ $0.04" / "~25 credits · ≈ $0.50". The price appears BEFORE a
  run everywhere: the Generative mode hint, the in-chat engine picker subs, the
  Auto pick note, the "Preparing…" placeholder, every progress line, and the
  keyed-fallback announcement; the success summary is stamped with it too.
  `gen/ledger.ts` records paid successes to `moldable_spend_v1` (LOCAL_ONLY —
  per-device estimates, list prices, capped 500 entries) and `spendSummary()`
  feeds Settings → 3D engine → **Cost & balance**: selected-model price,
  month-to-date spend per provider, a live **Check my balance** button for the
  two engines with balance APIs (`gen/balance.ts`: Meshy
  `GET /openapi/v1/balance`, Tripo `GET /v2/openapi/user/balance`, both via the
  same /prox relay the generators use; other engines get a dashboard pointer),
  and a full price-guide list. Verified by `harness/cost-e2e.mjs` (stubbed Meshy
  task + minimal one-triangle GLB + stubbed balance endpoint; 8 checks).
- **HF quota auto-fallback**: when the FREE Hugging Face GPU rejects a mesh job
  (quota drained / Space overloaded — matched on the humanized error text) and the
  user has a KEYED provider, the app retries ONCE automatically on the best keyed
  engine (pickAutoGenEngine, hf excluded), announces it, and keeps the fallback
  context in every progress line (the engine's first onProgress lands in ms and
  would erase a one-shot announcement — real bug found by the e2e). If the fallback
  also fails, BOTH errors surface ("Free GPU: … / Fallback (X): …"). Never fires on
  retry-with-model overrides or non-HF failures. Verified by
  `harness/hf-fallback-e2e.mjs` (Playwright route-stubs the Space's gradio_api to
  emit ZeroGPU's empty SSE error + a delayed relay 401).
- **Library bulk select**: "Select" toggle in the toolbar → tap cards to select
  (check badge, accent border, per-card actions hidden, tap does NOT open), bulk bar
  with count / Select all shown / Clear / Move to… (same folder semantics incl.
  "＋ New folder…" prompt) / Delete selected (confirm). Bulk actions exit select
  mode and refresh. Verified by `harness/library-bulk-e2e.mjs` (10 checks). NOTE for
  tests: the modal's Select button collides with the viewer's Select tool by
  accessible name — target it via its title.
- **Library organization**: toolbar (search over name+version summaries+mesh prompt;
  sort newest/oldest/name/most-versions; engine filter CAD vs mesh; live "N of M
  models" count) + FLAT folders — `Project.folder?: string`, per-card select
  (existing folders / "＋ New folder…" via prompt() / "No folder"), chips row with
  counts (All / 📁 each / Unfiled), chip click filters (toggle). Folder moves bump
  updatedAt so they sync. CSS: .lib-toolbar/.lib-search/.lib-chip/.lib-move (width
  overrides beat the modal's full-width input styling). Verified by
  `harness/library-organize-e2e.mjs` (11 checks incl. prompt-dialog folder create).
- **Library thumbnails self-upgrade**: saved previews carry `thumbV` (THUMB_V=2 in
  App.tsx — bump when the studio look changes). Opening the Library rebuilds up to 8
  stale projects OFF-SCREEN (CAD via worker `engine.build` from HEAD code/params/ops;
  meshes via their stored glb) and re-shoots them with `viewer.captureGeometryShot`
  (temp mesh, default material, same studio pipeline); every touched project is
  stamped even on failure so nothing retries forever; `libTick` prop repaints the
  open modal. Chat-shell projects (0 versions) legitimately keep the cube placeholder.
  Verified by `harness/library-thumbs-e2e.mjs`.
- **iPad white-flash reload loop FIXED (2026-07-21)**: signed-in devices reloaded every
  ~4 s flashing light mode. Chain: the OpenRouter Auto warm-on-boot fetch rewrote the
  TIMESTAMPED `moldable_openrouter_models_v2` cache each boot → gatherSettings syncs
  every `moldable_*` key → cloudSyncPull always saw cloud≠local → "settings changed" →
  `window.location.reload()` → repeat. Four-part fix: (1) fetchOpenRouterModels
  short-circuits on a still-fresh localStorage copy (no churn); (2) LOCAL_ONLY_KEYS
  grew cache/device keys (openrouter_models_v2, gemini_model, local_ready, house_url);
  (3) the pull-then-reload is capped at ONCE per browser session (sessionStorage
  `moldable_pull_reloaded`) so this loop CLASS is impossible; (4) index.html gained an
  inline pre-paint script applying data-theme + a dark backdrop before React mounts —
  the white flash on legit reloads is gone too. LESSON: any synced `moldable_*` key
  that self-rewrites (timestamps, caches) MUST go in LOCAL_ONLY_KEYS. Verified by
  `harness/flashfix-e2e.mjs`. Cloud blobs still holding the key self-heal (pull skips,
  push drops it).
- **Studio thumbnails** (`captureThumbnail` in Viewer.tsx): library/template previews are
  now product shots — throwaway scene with a paper-sweep gradient backdrop (CanvasTexture),
  3-point lighting (hemi 0.85 + key 1.8 + cool fill + rim), a radial-gradient contact-shadow
  decal at the part's min-z, 40° cam with breathing room, 512×384 webp q0.85. CRITICAL FIX
  found here: offscreen render targets store LINEAR values (the sRGB output transform only
  applies to the real canvas), so raw readback looked muddy-dark — a linear→sRGB LUT now
  runs in the readback flip loop. `captureModelShot` (CAD→mesh refine input) shares the
  pipeline. All 11 template webps regenerated via `harness/gen-thumbs.mjs` (takes an
  optional template-id arg). User materials/colors survive; only finish is softened.
- **Feature pack (2026-07-21 second wave)**: (1) OpenRouter Auto FIXED — the catalogue
  was only fetched when Settings opened, so every Auto pick silently fell back to
  gemini-2.5-flash; now `ensureOrCatalog()` awaits `fetchOpenRouterModels()` at pick
  time + a warm-on-boot effect + honest "(couldn't load the live model list)" label +
  AUTO sentinel resolved in research keys and defensively in generateLlm. (2) Narrated
  thinking: send() keeps a `steps[]` trail (`pushStep`/`onThink`/`thinkTrail`) shown
  live in the thinking panel and persisted on the finished message (incl. errors) —
  studying reference image / web research / writing with <model> / kernel build /
  repair attempts / local fallback. (3) Sketch → model: classifyIntent accepts an
  image (ApiMsg image part) so fresh-chat routing judges the OBJECT a photo/sketch
  shows; VISION_ADDENDUM gained sketch rules (lines=edges, read handwritten dims,
  straighten freehand). (4) Fit calibration: `fitClearance()/fitCalibration()/
  saveFitCalibration()` in prompts.ts (localStorage moldable_fit_cal) shift
  snug/loose/press together; Settings → Printer → "Fit calibration" field; new
  **Tolerance test coupon** template (6 stepped holes, notch-coded, + flanged peg).
  (5) Fastener presets: `src/cad/fasteners.ts` (M2–M5 heat-set/clearance/pilot) as a
  dropdown in the hole panel with insert-boss guidance. (6) Textures: wave/voronoi/
  diamond/fuzzy added to preview.worker patternAt (worley noise; fuzzy subdivides
  finer). Verified by `harness/printpack2-e2e.mjs` (12 checks incl. seeded-catalogue
  Auto pick + image-carrying classify) and `harness/engine-audit.mjs` — the full
  engine matrix: 11 templates × build/rotate/scale/chamferBottom/params/4 exports/
  re-export/rebuild, 10× repeat stability, humanized kernel errors — ALL CLEAN.
- **Printability pack** (Print tab "Print prep" + View menu): (1) overhang heatmap —
  `src/print/overhang.ts` flags faces with n.z < −sin(threshold) (bed-contact excluded),
  amber→red by severity, drawn by a Viewer `analysisOverlay` prop (soup + vertex colors,
  child of the model mesh, polygon-offset, raycast-disabled); (2) auto-orientation —
  `src/print/orient.ts`, Tweaker-style: candidates = 6 axes + top area-weighted normal
  clusters, score = overhang − 0.25·contact, `improved` gated (>25 mm² and >20 %/400 mm²
  gain); Apply = RotateOp via authorObjectOp for CAD, baked matrix + re-bed for meshes
  (provider "orient"); (3) thin walls — `src/print/thinwalls.ts`, area-weighted seeded
  sampling + inward ray via three-mesh-bvh (new dep), thickness < 0.8 mm flagged, red
  overlay; (4) elephant-foot chamfer — WorkerOp `chamferBottom` chamfers the bed-contact
  loop; edges selected by SAMPLING THE CURVE (start/mid/end z vs true minZ) — bbox and
  EdgeFinder.inPlane both fail on meshed shapes (OCCT pads bboxes by mesh deflection
  ~0.05 mm). Analyses clear on geometry change; thin-wall highlight wins over heatmap.
  Verified by `harness/printprep-e2e.mjs` (synthetic table/plate/thin-wall unit checks
  via Vite TS imports + full UI flow incl. 28k-pixel heatmap proof from below).
- **One brain, both engines** (`src/llm/router.ts`): the configured text brain (OpenRouter/
  Gemini/Claude/Groq/Ollama/house/local-if-loaded) now powers the mesh side too —
  (1) fresh-chat intent classifier: when the organic/CAD regexes are both silent, a tiny
  "CAD or MESH" call routes the request (8 s cap, best-effort, regex behaviour unchanged
  offline); (2) mesh prompt polish: short digit-free text→3D asks get expanded into a
  detailed sculptural description (explainOnce "meshpolish" narrates the first one);
  (3) CAD→mesh refine: a sculptural ask on an existing CAD model (SCULPT_EDIT_RE +
  REFINE_REF_RE, CADISH_RE veto) — or any generative text ask that references the current
  model — snapshots it via `viewer.captureModelShot()` (768² clean PNG, no grid/dims) and
  feeds the image→3D engine; explainOnce "cad2mesh" states the mesh-vs-STEP trade and that
  History keeps the CAD version. OpenRouter itself hosts NO 3D models (confirmed 2026-07) —
  it contributes routing/polish/dimension-research, while meshes stay on HF/fal/Tripo/Meshy/
  Replicate. Verified by `harness/routing-e2e.mjs` (mock OpenAI-compat brain on :8788).
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
- **Hole tool**: Select a flat face → "Hole…" — a new `HoleOp` in the ops chain (worker
  cuts a cylinder along −normal from the picked point; depth 0 = through). Panel gives
  ⌀/depth, typed in-plane offsets with a MAGNET increment (0.5/1/2.5/5/free), and
  hole-to-hole alignment: pick a reference (closed-edge rim or curved wall → centroid =
  axis; rim also yields its ⌀ from edge length/π), then editable ΔX/ΔY with "=" align
  buttons and an editable centre-to-centre spacing. Red drill ghost + dashed guide line
  in the viewer. Ops-chain = it survives slider rebuilds; drafts dissolve on any rebuild.
  PLACEMENT BY POINTER: while the panel is open the ghost follows the cursor across the
  face plane (imperative `layoutHoleGhost` — zero React re-renders on hover; hits are
  accepted only when co-facing within dot > 0.98 AND co-planar within 0.8 mm, so the
  ghost can't jump to a side wall) with the same magnet snap as the typed inputs plus a
  pull onto the reference's axes; a CLICK commits the position (taps are intercepted
  ahead of every pick, so a stray click can't deselect the draft), and SOLID teal guide
  lines light up per axis whenever the hole is aligned with the reference (the dashed
  at→ref line always shows). Reference picking still uses feature picks — `holePlace`
  is null while `draft.picking`.
- **Dims box follows selection**: the gray bounding box + size lines are NOT permanent
  any more. Default mode "On select": clean canvas until you click the object (box +
  dims + teal selection chrome appear together), click empty space → clean again. View ▾
  Dimensions is a 3-way radio (On select / Always / Off), persisted in
  `localStorage.moldable_dims`. Implementation: App folds mode + selection into the
  existing boolean `showDims` prop; Viewer no longer hides dims for the whole gizmo
  session — only during an ACTUAL drag (onDragChange; a model drag stays hidden until
  the op-commit rebuild recreates them, a no-op release or attachment drag restores).
- **Part context everywhere**: every AI request's system prompt carries `Current canvas:
  the user is working on the part "<name>", currently W × D × H mm — <first chat blurb>`
  (built in send() as `partContext`), and the SAME context feeds `researchDimensions`
  (new third param) so a Web-ON lookup about "add a 7mm screw hole" no longer
  interrogates the user about what the part is. The research prompt also hard-rules
  "NEVER reply with questions — reply NONE" (a real-use miss: gemini-flash answered a
  hole request with a questionnaire).
- **Composer**: auto-growing textarea (40→132 px, Enter sends / Shift+Enter newline) —
  long requests wrap instead of scrolling out of a one-line input.
- **Measure tool v2**: click two points OR press-and-drag a live tape line; both ends
  SNAP to the nearest tessellation vertex (then triangle edge) with screen-constant
  radii (~14 px / ~9 px) — hole rims measure their true ⌀ (verified: drilled ⌀7 via the
  hole tool, dragged across it, read exactly "7 mm"; curved surfaces tessellate with
  vertices ON the true surface, which is why vertex snap is exact). Drag is fully
  imperative (temp line/label in s.measures, committed via new `onMeasureSegment`).
  Label pills clamp to a 13–30 px on-screen band (was 16–53 — zooming into a small hole
  used to bury it under its own label).
- **Build stamp**: the status bar shows `v<N>` where N = the git commit COUNT (vite
  `define` `__BUILD_STAMP__`; strictly numeric by user request — it increases on every
  push to main, so a bigger number after refresh = the deploy landed). The Pages
  workflow uses `fetch-depth: 0` (a shallow clone would freeze the count at 1). Tool
  hints (`.box-hint`) sit at bottom: 50px — ABOVE the Top/Front/Right/3D pills.
- **Installable app (PWA)**: `vite-plugin-pwa` (autoUpdate) + manifest + generated
  icons (`public/icons/*`, rendered from the brand box glyph via Playwright —
  regenerate with a gen-icons harness if the brand changes) + iOS meta tags in
  index.html. The service worker precaches the WHOLE shell including the ~11 MB OCCT
  wasm (`maximumFileSizeToCacheInBytes` raised; Google Fonts runtime-cached), so the
  installed app works fully OFFLINE for everything local (templates, direct edits,
  hole/measure/export) — verified by building a template with the network off against
  the production build. AI chat still needs the internet. Note: after a deploy, the
  new worker installs in the background — the SECOND refresh shows the new build
  number. SW is disabled in dev, so the Playwright harnesses are unaffected.
- **Kernel errors are human**: OCCT C++ exceptions cross the wasm boundary as bare
  pointer numbers ("8759440" — a real user hit this). `cad.worker.ts kernelError()`
  translates them (best-effort real OCCT text via `OCJS.getStandard_FailureData`,
  else a causes-explainer) at build/export/import — which also gives the AI repair
  loop something to act on (verified: bad-fillet program → readable repair prompt →
  fixed on attempt 2).
- **On-device AI (WebLLM)**: provider "local" — Qwen2.5-Coder-1.5B on WebGPU,
  ~0.9 GB one-time download cached by the browser, then works fully offline.
  `src/llm/local.ts` (lazy-imports @mlc-ai/web-llm; download progress narrates via
  onThinking). Picker/Settings hide it without WebGPU. ALSO an automatic fallback:
  in send(), a reachability failure (fetch/5xx/timeout — NOT model or key errors)
  retries the same request locally when the weights are already on the device, with
  a chat note + "on-device" model label. Test hook `localStorage.moldable_local_mock
  = "1"` swaps in an instant mock engine (streams a 25 mm cube) — the real 0.9 GB
  download was NOT exercised in CI; first real-device use is the true test.
- **Worker shape-cache safety**: replicad's TRANSFORMS (translate/rotate/scale/mirror)
  DELETE their source shape. Anything that transforms a cached shape (`dropToBed` on
  export, transform ops on cached intermediates, user code moving the imported STEP)
  must `.clone()` first — without it the first export killed the cache and the next
  one failed with "This object has been deleted" (real user report: STL ok → STEP
  failed). clone() wraps a fresh handle of the same B-rep; booleans (cut/fuse/
  intersect) and fillet/chamfer do NOT consume inputs.
- **iPad-width layout**: `.tabs` never wraps internally; at narrow viewer columns
  (≤680px container) the head wraps as clean rows (tools cluster drops below whole).
  `.statusbar` wraps whole chips (dims/p2p are nowrap units). Audited at 1194/1024/834
  via a Playwright overflow scan (no element crosses the viewport at any of them).
- **Sync payload fix**: cloud sync pushed ALL projects as ONE row — unbounded inline
  images (camera photos in chat, thumbs) blew past Supabase's statement timeout
  ("canceling statement due to statement timeout", user report). Now: gzip BEFORE
  encrypt (envelope v2 `gz:true`, ~4% of plaintext; v1 decrypts fine), inline images
  capped at 64 KB each (model thumbs pass, camera photos don't), and a statement-
  timeout retry that drops all images (code/chats/settings always survive).
- **Settings redesign**: every tab is 1-2 titled `SGroup` cards (`.sgroup`), advanced
  bits behind `<details>`: AI = Brain + AI changes (OpenRouter search/reasoning
  collapsed under "More models & thinking"); 3D engine = Engine + Access; Printer =
  Your printer + Print checks; Appearance = Look (theme + bubble tint) + Workspace
  (units + dims mode — NEW controls mirroring the View menu / topbar); Sync = Cloud
  account (+ "What syncs, exactly?" details) + File backup (collapsed).
- **Quiet chat (explain-once)**: routine direct actions post their tutorial message the
  FIRST time only (`explainOnce(key, full, brief?)`, persisted in
  `localStorage.moldable_explained`) — separate/hole/merge/exports now repeat silently
  (a user got 4 identical separation walls of text). Errors always post.
- **Attachment gizmo centring**: enterTransform ALWAYS drives attachments through a
  temp pivot at the selection's bbox CENTRE (a separated part keeps geometry in model
  coordinates, so direct mesh attach parked the gizmo at the origin — beside the part —
  and made rotate/scale orbit that point). dropAttachment releases the pivot group
  first (world-space z-drop even after a rotation) then re-arms. Separated parts keep
  the model grey via the new per-attachment `tint` (foreign imports stay teal).
- **Touch/trackpad/Pencil policy** (real iPad report: trackpad drags painted native
  text-selection blue across the app): body is `user-select: none` with explicit
  opt-ins for chat bubbles, pre/code and form controls; canvas gets
  `-webkit-touch-callout/user-drag: none`; tap-highlight transparent; buttons
  `touch-action: manipulation`; `overscroll-behavior: none`; iOS-only (`@supports
  -webkit-touch-callout` + coarse pointer) 16px form type so focusing never zooms the
  page; `viewport-fit=cover` + safe-area padding on composer/statusbar. Phone topbar
  (≤480px): engine pill hidden, brand side shrinks with ellipsis — audited no-overflow
  at 390/430/834/1024/1194.
- **Cross-browser (iOS shells)**: every iPhone/iPad browser (Safari, Chrome, Arc,
  Comet…) is a WEBKIT shell, so all -webkit work applies to all of them. Audited: no
  unguarded engine-specific APIs (SpeechRecognition/requestIdleCallback/randomUUID/
  CompressionStream/navigator.gpu all guarded or fallback'd; no File System Access /
  OffscreenCanvas / Popover API). downloadBlob revokes its object URL on a DELAY —
  WebKit cancels a download whose blob URL is revoked synchronously after click().
  Effective CSS floor: iOS 16.2+ (color-mix, @container). Playwright WebKit can NOT be
  downloaded in the CCR sandbox (CDN 403) — engine-level Safari testing happens on
  real devices only.

## Conventions

- Ship each feature as its own PR to `main` (squash-merge; Pages auto-deploys ~2 min).
- Verify with Playwright against the real kernels (chromium at /opt/pw-browsers; harness
  pattern: boot app → "Try the built-in example" → drive UI → assert). Delete harnesses.
- The worker/engine test pattern and winding rules live in NOTES_PREVIEW_ENGINE.md.

## Agreed priority order for what's next

1. ~~**Template gallery**~~ — shipped (see above).
2. ~~**PWA/offline**~~ — shipped (see "Installable app").
3. ~~**Bundle/first-load**~~ — shipped 2026-07-22 (see "First-load & bundle split").
   Note: the "code-split LLM providers" half was already largely true (WebLLM and
   Supabase were dynamic); the remaining static llm/ modules are ~8 kB gz of
   render-needed constants + small clients — not worth further surgery.
4. **Print profiles** — per-project printer + filament presets feeding clearances.
5. **Share links** — public viewable model page (showcase-style turntable).
6. **Failure analytics** — opt-in local event log of failed ops/builds.

Also queued (user-requested): texture LIBRARY (more procedural patterns + grayscale
height-map upload), full lighting controls (draggable key light, environment presets),
snap-to-object magnetism, per-axis scale for mesh models.
