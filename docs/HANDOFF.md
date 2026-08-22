# Session handoff — state & roadmap

> **Rebuilding or running the app? [`docs/BUILDING.md`](BUILDING.md) is the concise
> survival sheet** — stack, build/deploy, and where every API key comes from.
> Keep it updated whenever a feature changes setup, keys, or architecture.

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
  has none). CI: `.github/workflows/build-desktop.yml` builds **BOTH** macOS
  (`macos-14`, aarch64 `.dmg`) and Windows (`windows-latest`, x64 NSIS `.exe`) via a
  matrix + `tauri-apps/tauri-action`, **automatically on every push to main**
  (docs/harness-only commits skipped). A SEPARATE `publish` job then refreshes the
  rolling **`desktop-latest`** pre-release with both installers — separate because
  two runners self-publishing would race to recreate the same release and clobber
  each other's asset. Permanent URLs:
  `/releases/download/desktop-latest/Moldable_aarch64.dmg` and
  `…/Moldable_x64-setup.exe`. Asset filenames are fixed; build identity is the
  stamped version `0.2.<commit count>` = the app's own v-number. `v*` tags
  additionally cut a versioned Release. **`fetch-depth: 0` is REQUIRED** — without it
  the commit count is 1 and the bundled app reports "v1". Windows uses **WebView2
  (Chromium)** so WebGPU/WebLLM DOES work there; only macOS WKWebView lacks it
  (<26). First run is unsigned on both: macOS right-click→Open, Windows SmartScreen
  →Run anyway.
  Unsigned beta; APPLE_* secrets commented for later signing. The `.dmg` can ONLY
  be built on macOS — not on this Linux box. NOTE: the GitHub App token in these
  sessions CANNOT trigger `workflow_dispatch` (403 "Resource not accessible by
  integration") — a push to main is how builds start. Only the *optional* on-device
  WebLLM degrades (WebGPU, macOS 26+).
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
- **Mac-app audit (WKWebView parity, PR #135)**: from Jerry's real-device report.
  (1) Drag lag: `preserveDrawingBuffer` removed (all captures render to their own
  offscreen `WebGLRenderTarget`; keeping it forced WebKit to full-copy the framebuffer
  every frame), and the raycasting pointermove handlers (gizmo `arbitrate`, the
  hover tail of `onMove`, brush painting) are FRAME-GATED: WebKit fires pointermove at
  input rate (~2× frame rate; Chrome coalesces), so each handler runs once per
  rendered frame and the newest skipped event replays from the animate loop (a pause
  never leaves hover/enable state stale; pointerup flushes the last brush dab before
  the stroke commits). Separate tick vars per handler — arbitrate (capture) and onMove
  (bubble) see the SAME event, one shared stamp would starve the second. (2) Objects
  panel now docks top-RIGHT (`.layers-panel`): the tool rail + flyouts own the left
  edge and drew over the rows; stats yield while it's open; height stops above the
  zoom cluster. Fixed the invisible row names too — fixed pills (badge/swatch/plate)
  squeezed the flex name to 0px (`.lp-name` min-width 56 + ellipsis, `.lp-sub` yields,
  panel 240→264). This 0px bug was silently failing sandbox-e2e. (3) Select no longer
  vanishes when a CAD model is separated: rail shows it disabled ("Regroup parts to
  use it", gated on new `separatedKind` prop) and separateParts turns select mode off.
- **Mesh cloud sync (Storage bucket, PR #136)**: fixes "mesh project synced to another
  device opens empty" (the Lambo-on-Mac report). Each project's HEAD mesh (generated
  `glb` or imported STEP/STL) uploads to the private `mesh-sync` Storage bucket at
  `<uid>/<projectId>.bin`, AES-GCM encrypted client-side (`encryptBytes`/`decryptBytes`
  in backup.ts: "MB1" magic + gz flag + salt + iv + ct, same key derivation as the row
  payloads). Owner-scoped RLS policies (migration `mesh_sync_bucket`, 50 MB/file).
  Push: sha-256 hash per blob, skips upload when the device-local marker
  (`moldable_meshhash_<id>`, excluded from settings sync via prefix-aware
  `isLocalOnlyKey`) already matches; injects `cloudMesh: {hash, src}` into the synced
  JSON; deletes bucket objects for removed projects. Pull: downloads when the marker
  doesn't match (or bytes are missing), attaches to `glb`/`importFile`; a local-newer
  project missing its mesh still restores. Version-history blobs stay on-device —
  undo into an old mesh snapshot on another device explains itself. Opening a
  generative project with no mesh now posts an honest chat message (rebuildHead
  throws; openProjectById's catch surfaces errors instead of silently blanking).
  NOT verifiable in CI: the live bucket round-trip needs a real signed-in session —
  Jerry signing in on web + Mac and reopening the Lambo is the true test.
  FIELD NOTE (first attempt failed, diagnosed server-side): Jerry synced from a
  browser tab still running the PRE-mesh-sync build (PWA second-refresh takeover) —
  sync_blobs row updated at 09:29 UTC but the bucket stayed EMPTY. The bucket
  listing (`select … from storage.objects where bucket_id='mesh-sync'`) via the
  Supabase MCP is the fastest way to tell "never uploaded" from "won't download".
- **Mesh-sync self-healing + desktop update notifier (PR #137)**: three follow-ups
  from that field failure. (1) `openProjectById` calls `scheduleSync()` — the opened
  project's mesh uploads ~2.5 s later instead of waiting for the 45 s interval.
  (2) A missing-mesh open does a ONE-SHOT on-demand `cloudSyncPull()` and retries the
  rebuild before showing the error — after the other device uploads, just re-opening
  the project fixes it (no app restart). (3) `pushMeshes`/`fetchMesh` console.warn on
  failures instead of vanishing into catch{}. (4) The DESKTOP app (never the web)
  shows a status-bar "Update to vN" chip when the rolling desktop-latest release is
  ahead of the running build (`src/lib/desktopUpdate.ts` polls the GitHub release API
  on boot + every 6 h, 60/h unauth rate limit is plenty); clicking opens the right
  installer (dmg vs exe) in the system browser via @tauri-apps/plugin-opener (JS
  package added; `opener:default` capability already allowed open_url). The installed
  desktop app is a frozen bundle — silent in-place auto-update would need the Tauri
  updater plugin + a signing keypair as a repo secret (Jerry must generate/add; offer
  stands). GOTCHA fixed en route: vite `envPrefix: ["VITE_", "TAURI_ENV_*"]` (the
  snippet in Tauri's docs) matches NOTHING — prefixes are literal startsWith, so the
  desktop code saw no `import.meta.env.TAURI_ENV_PLATFORM` until it became
  `"TAURI_ENV_"`. (`process.env.TAURI_ENV_PLATFORM` in vite.config.ts was unaffected
  — that's node-side.)
- **Silent desktop auto-update (PR #138)**: superseded the manual chip above.
  tauri-plugin-updater + tauri-plugin-process; `watchDesktopUpdate()` checks the
  rolling release on launch + every 6 h, `downloadAndInstall()`s in the background,
  then the chip offers "Restart to update" (only the restart is the user's call).
  Updates carry NO Gatekeeper prompt — bytes fetched by the app never get the
  quarantine flag, unlike a browser download. Signature-checked in Rust against the
  pubkey in tauri.conf.json. **Key setup (done)**: keypair generated with an EMPTY
  password; the private half is repo secret `TAURI_SIGNING_PRIVATE_KEY`. There is
  deliberately NO `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret — GitHub refuses empty
  secret values, and an unset secret resolves to `""`, which IS the password. Never
  regenerate the keypair casually: the pubkey is baked into shipped bundles, so a new
  key orphans every installed app (they'd reject all future updates and need a manual
  re-download). CI builds `.app.tar.gz` + `.sig` (macOS) / signed NSIS (Windows) and
  the publish job merges per-platform entries into one `latest.json`; when the signing
  secret is absent a guard step flips `createUpdaterArtifacts` off so builds still
  pass and the app falls back to offering the installer. State lives module-level
  (listener set + last state + in-flight promise) so a re-mount joins the running
  check instead of starting a second download — a naive `running` boolean broke this
  under React's double-invoked dev effects (state emitted to a dead listener).
- **Viewer perf, WKWebView parity (PR #139)**: measured FIRST with the new
  `harness/viewer-frames.mjs` — during a drag the app spends **0.63 ms of JS per
  frame** while frames take ~26 ms, i.e. our code was never the bottleneck; the cost
  is browser raster + composite. So: (1) ALL 8 `backdrop-filter: blur()` overlays over
  the canvas removed (panels are opaque now) — a blurred layer above an animating
  canvas makes the compositor re-blur that region every frame, cheap in Chrome and
  expensive in WKWebView; do NOT reintroduce blur on anything above `.viewerCanvas`.
  (2) `alpha: false` on the context. (3) **Render on demand**: draw only when
  `controls.update()` reports motion, when something invalidated, or on a 500 ms
  heartbeat — idle went 104 → **4** drawn frames per 2 s (measured). Invalidation is
  belt-and-braces: one dependency-free effect covers every prop-driven change, the
  imperative handle is wrapped by `wakeOnCall` so every method (including future ones)
  redraws, canvas pointer/wheel events invalidate at the source, ResizeObserver
  repaints immediately, and the heartbeat bounds anything missed. A dev-only
  `window.__viewerStats` records drawn/skipped with the reason. NOTE for future
  measuring: this container renders with SwiftShader, so compositing wins are NOT
  measurable here; and OrbitControls' inertia decays 5% per FRAME, so at low frame
  rates the post-drag glide legitimately lasts many seconds (measure idle BEFORE
  touching the canvas, not after).
- **Toolbar placement + one popup at a time (PR #149)**: "Set size" and the snapping
  magnet were rendered as bare siblings inside the Transform rail flyout — no panel of
  their own, so they floated loose on the 3D canvas, and they were buried behind a tool
  even though both are settings you change at any time. Both moved to the horizontal
  `.viewer-tools` toolbar; the flyout is now just the Move/Rotate/Scale seg (which has
  its own background). ONE POPUP AT A TIME: `useSoloMenu(open, close)` keeps a
  module-level set of close functions — opening any menu closes the rest. AnchoredMenu
  calls it unconditionally (mounted == open) so every portal menu gets it free;
  SnapMenu and ResizeMenu manage their own dropdowns, so they call it directly and also
  gained `useOutsideClose` (outside click / Escape) which they never had — that's why
  two of them could sit open on top of each other. Any NEW self-managed dropdown must
  call both hooks, or it will stack again. `harness/menus-e2e.mjs` covers placement,
  the flyout's contents, cross-menu dismissal and that both still work where they moved.
- **Staying signed in on the desktop app (PR #147)**: TWO separate problems, and the
  second is the one that actually bites. (1) STORAGE — supabase-js persists its session
  in localStorage; the web keeps that, a WKWebView data store is not guaranteed to.
  `IS_DESKTOP` now swaps in an async storage adapter backed by tauri-plugin-store
  (`auth.json` in the app data dir, autoSave), plus explicit persistSession +
  autoRefreshToken. (2) SIGN-IN CAN'T COMPLETE — OAuth and magic links finish by
  REDIRECTING to a web address; `appUrl()` in the desktop app is `tauri://localhost/`,
  which no provider will redirect to and no mail client can open. So on desktop those
  options are hidden (offering them would only fail) and email+password — the one
  method with no redirect — is the whole form. For accounts created via Google/link,
  Settings → Sync → "Set a password" (`cloudSetPassword`, `auth.updateUser`) on the WEB
  gives them one. Proper OAuth on desktop needs tauri-plugin-deep-link + a `moldable://`
  redirect URL added to Supabase's allow-list (dashboard only — no MCP tool for auth
  config); not done, offer stands. `harness/desktop-auth-e2e.mjs` stubs the store IPC
  and asserts the desktop build reads its session through the plugin while the web build
  keeps social + link sign-in and never touches it.
  Also fixed two STALE settings-e2e assertions that pinned exact setting-group lists
  ("Cost & balance" and "Fit calibration" had been added since) — they were failing on
  main and hiding real regressions; they now assert the required groups are present.
- **Multi-view photos + shortcuts (PR #146)**: MULTI-VIEW — `MultiViewRow` (left/back/
  right slots) already existed but rendered only for `mode === "generative"`, so nobody
  in Auto ever saw it. Now shown whenever a photo is attached (not for markup edits,
  where the screenshot IS the subject) and, crucially, the CAD path now SENDS them:
  `sendInner` appends each view to the vision message as a labelled text+image pair
  ("Additional reference — the left side…"), and VISION_ADDENDUM tells the model to
  cross-read views. Content is already a parts array, so this works for both Anthropic
  and OpenAI-compatible providers. `harness/multiview-e2e.mjs` asserts both images
  reach the request.
  SHORTCUTS — ⌘/Ctrl+Z undo, ⌘⇧Z **and Ctrl+Y** redo, Esc = dismiss, V/G/M/B tools,
  F re-frame, 1–4 select kinds. PAINT IS NOW UNDOABLE: strokes aren't model versions
  (no geometry change) so they get their own `paintPast`/`paintFuture` stacks in App
  plus `ViewerHandle.restoreFacePaint(tc)` to repaint the overlay imperatively. A model
  commit calls `clearPaintHistory()` — paint is keyed to the triangle list and can't
  replay onto new geometry, which ALSO makes "stack non-empty" mean "your last action
  was a stroke", giving ⌘Z last-in-first-out order without tracking a global action log.
  DISMISS — tapping EMPTY canvas (primary button only; right-click must still open the
  context menu, and ux-e2e caught that) or pressing Esc runs one shared
  `dismissOverlays()`. Canvas pointerdown also blurs a focused input so ⌘Z means "undo
  my model edit" once you're working on the canvas. GOTCHA: the rail buttons had their
  exclusive one-tool-at-a-time logic written INLINE in the props object; the keyboard
  used raw setters and left two tools armed. Both now call shared
  `toggleSelectTool`/`toggleMeasureTool`/`toggleTransformTool` — put any new tool
  toggle there, not inline. `harness/shortcuts-e2e.mjs` covers all of it.
- **Double-submit + canvas overlay layering (PR #145)**: from an iPad report of "two
  thinking bubbles at once" plus a VPN/ad-blocker error. ROOT CAUSE of both: `send()`
  guarded with `if (status === "generating") return` — REACT STATE, which doesn't
  update until a render, and sendInner awaits (intent routing, engine boot) before it
  ever calls setStatus. Two taps in the same tick both passed the guard → two user
  messages, two placeholders, two API calls; the losing request surfaced as a network
  error. Fixed with a `sendingRef` set synchronously in a thin `send()` wrapper around
  the renamed `sendInner`. `harness/double-send-e2e.mjs` proves it (old code: 2
  requests / 2 replies; new: 1). Any future guard on an async user action must use a
  ref, not state. `friendlyNet` also stopped blaming the user's ad-blocker for what is
  usually a dropped connection (and reports offline separately).
  LAYERING: `.mesh-stats`, `.inspector`, `.help-sheet`, `.layers-panel` each pinned
  themselves to the SAME top-right 10px corner, so any two open at once overlapped
  (Objects over the selection inspector, 172×154px, made worse when the Objects panel
  moved right in #135). They now live in one `.right-dock` flex column that also holds
  `.zoom-ctl` (pinned to its bottom via margin-top:auto, dock ends 112px up to clear
  the corner orientation gizmo). ORDER MATTERS: stats, Objects, help, inspector, zoom —
  the inspector appears on every model click, so it goes BELOW the panels; putting it
  above shifted the Objects panel mid-double-click and broke rename. `.paint-fly` had
  no background at all — the palette floated on the model (his "transparent colour
  picker"); it's a real panel now. `.canvas-rail` must NEVER get an overflow value:
  its flyouts are absolutely-positioned children extending right, and even
  `overflow-y` alone makes the other axis compute to auto and clips them (wrapping to
  two columns instead pushed flyouts off-screen — also rejected).
  `harness/ui-overlap-sweep.mjs` opens every panel/menu at four REAL device sizes and
  reports overlaps; use it after any canvas-overlay change. Test at real sizes — a
  square 834×834 viewport invents overlaps that don't exist on a real iPad portrait.
- **Chat render cost (PR #140)**: `harness/load-perf.mjs` seeds a realistic library
  (25 projects, long chats with images, 30-version stacks, 6 MB meshes). The store is
  NOT the problem (listProjects ~30 ms; opening a mesh project = 2 ms record + 7 ms
  blob). Every keystroke re-rendered every bubble and re-parsed every message's
  markdown — same on every streamed token. Fixed with a memoised `MessageRow` whose
  props are narrowed (only the edited row sees `editText`, only the streaming row sees
  `thinking`). CRITICAL: App rebuilds `brain={{…}}` and the `hasBrainKey`/`hasGenKey`
  arrows every render, which defeated the memo entirely — measured no better until
  handlers were routed through a ref-backed stable object and `brain` passed as
  primitives. Typing is now FLAT with history: 40 turns 33.8→30.6 ms, 120 turns
  54.7→32.2 ms per keystroke-frame. Library open (~390 ms for 25 cards here, ~37 ms of
  it thumbnail decode) was left alone — a store-schema meta index isn't worth it yet.

- **Orbit damping was frame-rate dependent (PR #150)** — the last piece of Jerry's
  "Mac app drags worse than the web" report, still present after the WKWebView work
  (#136/#139). three.js OrbitControls applies damping once per `update()` **call**,
  with no notion of elapsed time: `theta += delta * f`, then `delta *= (1 - f)`, with
  `f = 0.05`. So catch-up speed is tied to the frame RATE, not the clock — the same
  gesture settles in half the wall-clock time at 120 Hz that it does at 60 Hz, and the
  slower one visibly trails the cursor. Jerry's panel is ProMotion 120 Hz, so any
  build that doesn't achieve 120 (a WKWebView that didn't get the high rate, a thermal
  dip, a heavy mesh, or a ProMotion downshift while the render-on-demand loop is idle)
  trails proportionally MORE while running identical code. `animate()` now rescales the
  factor by real measured dt — `f = 1 - (1 - 0.05)^(dt·120/1000)`, dt clamped to 100 ms
  so a long stall catches up over a few frames instead of snapping — giving a constant
  ~400 ms settle at any rate. `harness/damping-e2e.mjs` proves it by patching `rAF` to
  a controllable clock and driving one identical orbit at two rates: 414 ms vs 396 ms
  coast (0.96×) where a per-call damper gives ~2.8×; measured factors match theory
  (20 Hz predicted 0.2649, measured 0.2651). THREE traps in writing that harness, all
  of which produced confident-looking wrong numbers first: (1) `setInterval` cannot
  synthesise 120 Hz — it lands ~74 Hz under load, so the test compares 60 vs 20 Hz, a
  strictly harder 3× spread; (2) "settled" must NOT mean OrbitControls' numeric rest —
  its residual decays to a 1e-6 epsilon over ~1.3 s of imperceptible drift at every
  rate, which measures nothing about feel, so use time-to-90%-of-travel over a FIXED
  window; (3) a stop detector with an absolute movement threshold truncates whichever
  run releases with the gentler residual, which faked a 7.35× ratio. Pace the gesture
  slow enough (40 ms/step) that the slow clock gets ~10 frames during the drag, or the
  two runs release from physically different states. `Viewer` also gained a dev-only
  `window.__viewerCam()` probe (position + live damping factor) for that harness.
  UNRESOLVED: whether the Mac app actually achieves 120 Hz. `BuildTag` now measures the
  real rAF cadence and shows it in the version chip's tooltip (hover re-samples) —
  the packaged desktop app has no devtools console, so that is the only way to read it.
  If it reports well under 120 while idle but ~120 during a drag, the render-on-demand
  idle skipping is letting ProMotion downshift and the ramp-back is the remaining lag.
- **Known, pre-existing, unfixed**: `ui-overlap-sweep` reports `.pmenu ∩ .viewer-head`
  = 230×7 px at 1366×1024 only. Verified present on clean HEAD before #150. Cosmetic —
  the menu is z-80 over a z-0 header, so nothing is obscured or unclickable.

### Model → slicer hand-off (v331–v333)

The audit's top three findings, all "connect what already exists":

- **v331 — one source of truth for printer fit** (`src/lib/fit.ts`). The Tolerance
  coupon measurement used to drive only the AI's `clearance` parameter; the screw
  tool, magnet tool, fastener presets and cut-piece sockets all carried their own
  hardcoded numbers. `fit.ts` now separates the two ideas that kept getting confused:
  `fitClearance(fit)` is the gap you WANT between mating parts, `boreAllowance()` is
  how far this machine drifts from the charts (measurement minus the 0.2 average) and
  applies to every hole, chart-sized or not. Deliberately untouched: the rib crest on
  a bite hole (nominal, or the screw stops biting), pocket depth (Z is layer-accurate),
  and the cut kerf (a glue line, not a fit). Preset labels are generated from the size
  that will really be drilled, so they can't drift from it.
- **v332 — the desktop slicer hand-off works.** It was gated on `import.meta.env.DEV`
  and the packaged app runs `npm run build`, so the one place it was meant to work was
  the one place it couldn't. A Rust command (`stage_for_slicer`) writes the 3MF to
  `<app data>/handoff/<name>.3mf` and the OS opens it with whatever owns .3mf — no deep
  link, no trusted-site prompt, no guessing app names (the opener plugin spawns
  detached, so a wrong name fails silently and can't be detected). The path is stable
  per project, which buys the v2 loop: re-send after an edit → "reload from disk" in
  the slicer keeps supports and print settings. PrusaSlicer is NOT a deep-link target:
  its `prusaslicer://open?file=` handler rejects anything that isn't printables.com.
  Bytes cross IPC as a raw body with the name in an ASCII header. **Unverified here:**
  the packaged app's own click-through (no display in CI); `cargo test` + a browser run
  against a `TAURI_ENV_PLATFORM` build with stubbed IPC is what was actually exercised.
- **v333 — one 3MF writer** (`write3MF()`). The rich writer was reachable only through
  the plate menu; everything else got an unnamed bare mesh, so painting a model and
  hitting Export silently dropped the paint. Every path now emits both dialects (core
  basematerials for Prusa/Cura, the Bambu/Orca project config for slots and
  `paint_color`). `preflightExport` went from 1 of 5 export paths to all 5. Paint a
  format can't carry is now stated on EVERY export, not once — the second silent STL is
  the one that gets printed in one colour.

- **v335 — the four "the app already knew and never said" fixes**, on one new
  mechanism: `ChatMessage.offer`, a one-tap suggestion card that freezes with the
  choice recorded (`offerChoose` in App.tsx dispatches by `kind`). Inch rescue:
  imports under 13 mm across get the ×25.4 offer (STEP exempt — real units).
  Orientation: imports get the offer when a different pose meaningfully cuts
  supports, and `suggestOrientation` now takes the bed — a pose that leaves the
  build volume is rejected before it's suggested (unless the current pose doesn't
  fit either). Walls joined the export gate as a fifth row, auto-run, with a
  sample budget that scales with the mesh (was a flat 800) and honest pass copy
  ("none thin in N samples", not "healthy"). The elephant-foot bevel is offered
  in the export gate with the why on the button; the ops chain remembers so it
  can't stack.

## How to use /design in Claude Code (written for Jerry)

/design makes picture mockups of your app's screens that you can edit by hand —
like a mini Figma that lives at a claude.ai link. We used it for the Launchpad.

**Making a design:**
1. In Claude Code, type `/design` and describe what you want. Example:
   `/design the Launchpad in desktop, tablet and mobile sizes`.
2. Claude reads the real app's code (colors, fonts, spacing) and draws artboards
   that match it — not generic mockups.
3. You get a link to a canvas page. Open it in your browser.

**Editing in the canvas:**
4. Click anything to select it — a properties panel opens on the right.
5. Change colors, sizes, spacing, fonts there. Double-click text to retype it.
6. Undo/redo work like normal (Ctrl+Z / Ctrl+Shift+Z). Pan and zoom the canvas
   to move between artboards.
7. Some canvases have little control knobs above the artboards (ours has
   "State: First run / Returning" and a Dark toggle) — flip them to preview
   different versions of the same screen.

**Saving and getting it into the app:**
8. Press **Save** in the canvas. Until you Save, edits live only on your screen.
9. Saving updates the shared link — it does NOT touch the code.
10. To bring your edits back: tell Claude "pull my canvas changes into the repo"
    (paste the link if it's a new session). Claude reads the saved page and
    updates the design files in git.
11. To make the real app match: that's a separate ask — "make the real
    Launchpad match the canvas". Keeping them separate means you can experiment
    in the canvas without accidentally shipping it.

**Watch out for:**
- It's a research preview — it may change between Claude Code versions.
- If you delete an artboard in the canvas, pulling changes back deletes it
  from the repo too.
- Each canvas is one link. Asking for a brand-new design makes a NEW link;
  updating an existing one keeps the same link.

## Build 500 — ten reported niggles: history stops duplicating, the sliders answer at once, and the stats card says how long

Ten things from one round of use, plus the review pass that found nine more.

- **History no longer breeds copies.** Restoring appended a full row every single press —
  browsing five steps back left five near-identical rows tagged `restored`. Three rules
  now: the summary keeps its ORIGINAL wording and the fact rides as a `restoredFrom` id
  (the old scheme rewrote it to `Restored “…”` and restoring a restore wrapped it again);
  a restore that changes nothing isn't recorded at all; and a restore step still sitting at
  the tip is REWRITTEN rather than stacked beside. Browsing now leaves one row.
  Researched against Shapr3D's Project Versions ("Restore as Latest" appends with a
  structured "Copy of" back-pointer), Onshape (rollback moves a pointer; a history restore
  appends), Fusion (suppress vs delete), Figma and Google Docs (restore appends, but
  autosaves collapse and only unnamed versions can be removed). Appending was kept
  deliberately: `mergeProjects` picks HEAD by which version was created last, so a
  pointer-only restore would lose to a newer step on another device.

- **Steps can be removed, and stay removed.** A ✕ per row with an inline confirm — never
  the step you're on, never one you named, never the last one left; the rule lives once in
  `whyNotDeletable` and both the control and the guard ask it. The part that took the work
  is `Project.dropped`: `store/merge.ts` exists precisely because a merge that deleted once
  cost a user a day of history, so it never drops a version — which meant a deletion would
  come straight back from the account on the next sync. Tombstones are the one explicit
  exception, and they travel both ways.

- **A print-time estimate, in the stats card.** New `src/print/printtime.ts`. It is a
  harder number than grams and says so: grams follow from geometry, but the same file is
  ~25 min on an X1C and ~1 h 50 m on an Ender 3, so the machine class is an INPUT (defaulted
  from the printer already chosen in Settings) and the answer is a range, skewed upward
  because everything it leaves out — supports, brim, raft, purge tower — adds time. Layer
  height is a picker. The three published check figures are pinned in the harness.

- **The Adjust sliders answer at once.** The highlight cost a full OCCT rebuild per hover.
  Two changes: a cached answer now applies on the hover itself (it was waiting out the
  260 ms hover-intent to show something already in a Map), and the probes are run in the
  background while the panel sits idle. Measured on a box-with-lid: **730–816 ms before,
  247–265 ms after** for a first look at a row. The warm-up is deliberately timid — one
  probe at a time, never while a build or a drag is running, and it stops after the first
  probe if that probe was slow, because on a heavy part eight background rebuilds is a hot
  laptop for a highlight nobody asked to see.

- **View ▾ behaves like a button.** No open state, and a second press closed it on
  mousedown then its own click reopened it — "it disappears for a second and comes back".
  Same `ignore` fix the account menu got, applied to all five button-triggered menus
  (balance, build options, view, colour swatch, plate).

- **Stats stays off.** It was the one View ▾ switch that forgot.

- **Breadcrumb at the top of Privacy and Terms.** There was a way home already, at the
  bottom, past a screen of legal text.

- **Improve says what it is.** A bare sparkle nobody could name, greyed out with no
  explanation. It has the word "Improve" on the Launchpad now, and `aria-disabled` rather
  than `disabled` so the reason it is off can actually be read — a disabled button receives
  no pointer events, so its tooltip never opens for the person who needs it.

- **The send button was 3px low.** It and the controls row were two separately anchored
  boxes in opposite corners of the composer with the same `bottom` and different heights.
  One flex row now, which also makes the old phone bug (the row sliding under the send
  circle, where a covered chip tapped as SEND) structurally impossible.

- **Export stopped covering the printer chip.** Measured at 390px: 61×40px of the bedchip
  sat under an opaque sticky Export. The statusbar is two boxes now — the facts scroll
  inside their own, Export sits beside it. Also found: `.mesh-stats` is `pointer-events:
  none`, so the material picker inside it had never been clickable.

- **Harness**: new `batch-fixes-e2e.mjs` (31 checks) covering only this batch. Two probes
  were fixed rather than accepted: `enterWorkspace` waited for a door the app never renders
  when it resumes itself, and `resize-e2e`'s redo never fired because focus hadn't returned
  to the canvas — both were being written off as flakes. `launchpad-widths-e2e`'s
  centre-line check was one-sided and has been rewritten. **CLAUDE.md gained the standing
  rule** Jerry asked for: every change ships with an executed test, and the check must be
  proved to fail when the feature is broken.

- **Review found nine real bugs in the first pass**, all fixed: a restore made the row it
  came from a silent dead click and made the chat's "go back" report a bogus rebuild error;
  `saveCheckpoint` and `replaceHeadVersion` both inherited `restoredFrom`; superseding could
  destroy the last surviving copy of an aged-out snapshot; the speed class never followed a
  printer change; and the full-width controls row swallowed clicks meant for the text box.

**In plain words:**
1. Going back in History used to leave a copy every time you clicked. Now it leaves one
   row no matter how much you browse, and you can delete steps you don't want.
2. The sliders light up the part they change about three times faster — because the app
   works the answers out in the background while you read the panel.
3. The stats card now tells you roughly how long the print will take. It asks which kind
   of printer you have, because that changes the answer by four times, and it gives a
   range rather than pretending to know.
4. The View button now looks pressed when its menu is open, and closes when you press it
   again. Turning Stats off sticks.
5. Privacy and Terms have a link home at the top. The "Improve" button says "Improve",
   and tells you why it's greyed out instead of just looking broken.
6. The green send button is properly lined up now, and Export no longer sits on top of
   your printer name on a phone.
7. A review pass found nine more real bugs in my own work before it shipped — including
   one where clicking a history row did nothing at all.

## Build 499 — mobile UI: legal in a footer, New chat and dark mode behind the avatar

From two phone screenshots. The Launchpad header carried the wordmark, the version,
Privacy, Terms, a theme toggle and Sign in — at 390px the sign-in button truncated to
"Sign…". The workspace top row had four controls fighting for the same space.

- **Privacy and Terms moved to a standing footer.** Deliberately not the existing
  `launch-foot`, which only renders for first-time visitors: a privacy policy shown only
  to newcomers is not a privacy policy. It is a separate element, on every visit.

- **"+ New chat" and the light/dark switch moved into the account menu**, beside Settings
  and the account, which were already there. Below 760px the top row is now a wordmark
  and a face. Templates and Library are hidden at that width, so the menu carries them
  too — on a phone that menu IS the navigation row.

- **Three mobile bugs fixed on the way**, each of which this change would otherwise have
  made worse. The menu was gated on being signed in, so folding controls into it would
  have taken New chat and dark mode away from every signed-out visitor. It dismissed on
  `onMouseLeave`, a gesture a finger cannot make, so on a phone it could only be closed by
  picking something out of it. And a second tap on the avatar closed it and instantly
  reopened it, because the outside-tap handler fires before the trigger's own click — the
  first gesture anyone tries. It is built on the app's `AnchoredMenu` primitive now:
  outside tap, Escape, one-menu-at-a-time, and viewport clamping.

- **Harness**: five probes drove the moved controls and would have broken. `enter.mjs`
  gained `accountMenu`/`newChat`/`toggleTheme`; `accuracy-e2e`, `assist-visibility-e2e`,
  `e2e`, `resize-e2e` and `theme-toggle-e2e` now go through the menu. New `mobileui-e2e`
  (19 checks) drives a 390px viewport end to end. `launchpad-widths-e2e` still passes
  17/17, which is the probe that guards the project shelf staying above the fold — so the
  new footer costs the shelf nothing.

**In plain words:**
1. Privacy and Terms are at the bottom of the start screen now, where people look for
   them — and the "Sign in" button has room to say "Sign in" again.
2. New chat and dark mode live under your profile picture, along with Templates,
   Library, Settings and Sign out. The top of the app is just the logo and your face.
3. Three phone bugs went with it: the menu used to need you signed in, it could not be
   closed by tapping away, and tapping your face twice reopened it instead of closing it.
4. Two rounds of review caught things the first pass missed, including two automated
   tests that would have quietly started failing.

## Build 495 — playbook moves 5–8: the Steps panel, the guided flow closes its loop, and the launch checklist

Moves 5 and 6 verified by two new probes — `harness/steps-e2e.mjs` (8 checks, asserting
the STORED op chain via IndexedDB, not just pixels) and `harness/guided-e2e.mjs` (4
checks) — plus the receipt/accuracy/mainblock regression set, all green. The steps probe
was proven to discriminate by breaking the edit wiring and watching the right checks go
red; that break test also caught the probe's own store-assertion being vacuous
(waitForFunction doesn't await async predicates) and it was rewritten to a real poll.
The diff-review pass then hardened the panel: edit/remove carry the op TYPE and bail
if the chain shifted under an open row (another panel's remove could have landed a
fillet radius as a rotation angle), Enter on an untouched field no longer rebuilds
and rounds, rebuild errors name the change that failed instead of saying "hole edit",
and the guided loop-closer no longer burns its once-ever flag on a preview the user
may Discard.

- **The Steps panel (move 5).** A new "Steps" section in the Inspector lists the whole
  recipe — every hole, rounding, bevel, shape and move, in the order the kernel applies
  them. Steps one number describes (a bevel's size, a hole's diameter, a rotation's
  degrees, a scale factor) are retyped in place; every step has a ✕. Each change rebuilds
  through the same `rebuildWithOps` path the tools already use and lands as a History
  version, so Undo walks it all back. Screws, shapes and moves list with their numbers
  shown but edit through their own tools — one input field would misrepresent them.

- **The guided flow closes its loop (move 6).** The fix-a-broken-part flow already
  shipped end to end (door → replacement-mode prompt → fit directive on every precise
  build since 489 → receipt on every export since 492). What was missing: after the first
  guided build, nothing told you what to do when the PRINT comes back tight. One message
  now does — pointing at Part fit in Build options, the ten-minute hole test in
  Settings → Printer, and the export receipt. Once, ever.

- **Moves 7–8 are Jerry's moves — prepared, not done.** `docs/LAUNCH_CHECKLIST.md` holds
  the plan: the desktop-licence checkout options (Lemon Squeezy / Gumroad / Paddle, with
  cuts and why), the steps only Jerry can do (seller account, product, price), what the
  code side still needs (a licence field + gentle gate — not built yet), and the free
  distribution list in effort order with the no-"AI"-framing rule. The receipt shipping
  in 492 is what unlocked the caliper-audience channels.

**In plain words:**
1. There's a new "Steps" list showing everything done to your part, like a recipe. Tap a
   step to retype its number, or ✕ to take it off — and Undo still works on all of it.
2. After the app builds you a replacement part, it now tells you what to do if the
   printed part grips too tight: one setting re-cuts every fitted hole.
3. Selling the desktop app and posting to maker communities are YOUR moves — the plan,
   the order, and exactly what to click are written down in docs/LAUNCH_CHECKLIST.md.
4. Two new automated tests drive these features in a real browser before every claim.

## Build 492 — playbook moves 1–4: no writer can forget a field, storage asks to stay, the coupon is tappable, and exports carry a receipt

The playbook's first four do-next items, verified by `harness/receipt-e2e.mjs` (7 checks)
plus the existing accuracy/mainblock/tokentrim/buildfail/truncation set — 71 checks green.

- **No save path can forget your decorations again (move 1).** The four decoration
  fields (surface pattern, text layers, logos, part colours) are now REQUIRED keys on the
  version snapshot type — the compiler itself listed the three forgetful writers (the
  Adjust commit, Save-as-version, pattern apply) plus the template path, and refuses any
  future writer that omits one. `decorSnap()` is the one way to say "whatever is on the
  model now". This bug family shipped as a fix seven times; the eighth is now a compile
  error instead of lost logos.

- **Storage asks to persist, and failure stands on screen (move 2).** The app now calls
  `navigator.storage.persist()` at boot (Safari could evict everything after 7 idle
  days), and while writes are failing a standing banner says so — the old chat-line
  warning scrolled away with the conversation it was warning about.

- **The fit coupon is tap-to-answer (move 3).** Settings → Printer now shows the
  coupon's six holes as buttons — tap the tightest one the peg fit and the clearance is
  stored, same as typing it. Counting notches and typing decimals stays available for
  caliper people.

- **Exports carry a verification receipt (move 4).** STL/3MF/OBJ exports post: measured
  size, every requested figure confirmed (✓) or honestly declared "not an overall
  dimension — check it on the model", watertightness, bed fit, and — when the part has
  drilled holes — the clearance applied and whether it came from YOUR calibration or the
  typical-FDM table. Only computed numbers; a line the app can't compute is omitted,
  never estimated.

- **Found on the way:** "30 x 20 x 5 mm" only counted the 5 — the trailing unit now
  distributes over the whole chain, in the receipt AND in the build-time size caution.

**In plain words:**
1. The bug that could silently delete your logos when you adjusted a slider is dead —
   and the compiler now blocks anyone from reintroducing it.
2. The browser is asked to protect your projects from cleanup, and if saving ever
   breaks you get a banner that stays until it's fixed, not a message that scrolls away.
3. Calibrating your printer is now: print the coupon, push the peg, tap the hole.
4. Every export ends with a receipt: "you asked for 30 × 20 × 5 — measured 30 × 20 × 5,
   watertight, fits your bed." That receipt is the thing no competitor has.

## Build 490 — security pass: the relay grows teeth, and the site grows a privacy policy

Prompted by "what could get back to me as I scale". Findings first, fixes after; the
worker's guards are covered by a 13-check Node test (`scratchpad` harness run against
the real module), the markdown guard by a real React render test.

- **The relay was an open proxy.** `/prox/dl?url=…` fetched ANY address and piped it
  back — anyone could bounce arbitrary traffic off the worker, spending its bandwidth
  under its deployer's name. It now refuses everything except https URLs on the
  generation providers' own CDNs (extensible via `DL_HOSTS`).

- **Any website could embed the relay.** CORS answered `*` with a "lock this down"
  comment nobody could act on. `ALLOW_ORIGINS` (env) now confines browser use to the
  sites you name, echoing the matched origin; unset keeps the open dev behaviour.

- **Endpoint spam.** `/prox/*` had no limits at all. Every path now meters per IP per
  day (default 500, `PROX_DAILY`, KV-backed when bound); the house endpoint's cap now
  shares the same metering, and one sponsored request can no longer buy an arbitrary
  amount of output — bodies over 1 MB are refused and `max_tokens` is clamped
  (`HOUSE_MAX_TOKENS`, default 4096). proxy/DEPLOY.md documents all four knobs.

- **One real XSS hole closed.** Chat markdown built links from MODEL OUTPUT with no
  scheme check, so a generated `[click me](javascript:…)` ran code on click. Only
  http(s) URLs become links now; anything else renders as plain text.

- **Privacy policy and Terms of Use exist now** — `/privacy.html` and `/terms.html`,
  static pages linked beside the version tag on the Launchpad. Written to match how the
  app actually works (keys and designs stay on the device; sync stores projects, never
  keys; no analytics) and to carry the load-bearing scaling language: AI output is not
  human-reviewed, verify before printing, no safety-critical use, no warranty, liability
  capped. A template to have reviewed properly when the app takes money — not legal advice.

- **Reviewed and fine as-is:** chat renders through React elements (no innerHTML
  anywhere); API keys live only in localStorage and are sent only to their own provider
  — `sanitizeProject` keeps them (and photos/blobs) out of cloud sync; no secrets in the
  repo (the Supabase anon key is public by design, RLS scopes every row); generated CAD
  code runs in the worker with network globals shadowed — a determined payload could
  still reach same-origin fetch, but the blast radius is the user's own browser.

**In plain words:**
1. Your relay could be used by strangers as a free traffic bouncer, from any website,
   with no limits. It now only talks to your site, only fetches model files from the
   real providers, and cuts every IP off after a daily allowance.
2. A malicious AI reply could have planted a booby-trapped link in the chat. Not any more.
3. The site now has a real Privacy page and Terms page, linked on the front screen.
   The Terms carry the sentences that protect you as you scale: check sizes before
   printing, no safety-critical parts, no warranty. Have a lawyer look at them before
   you charge money.

## Build 489 — the five accuracy fixes: the part is the size you asked for, and your work survives

The reliability audit's top five items (see the session's roadmap), shipped together.
`harness/accuracy-e2e.mjs` (13 checks) drives all five through the real UI; removing the
fixes turns five specific checks red, so the probe is proven discriminating.

- **Rebuilds carry your work (audit item 1).** The full-regeneration path and the Code
  tab's Re-run built from bare code: committed slider values reverted and every drilled
  hole, magnet pocket and drag fillet was deleted — then baked into the version, with
  only "Updated the model" on screen. Both now carry `params` (same keep-rule as the
  edit fast path: a value survives only where the AI left that default alone) and the op
  chain. If the ops can't follow a reshaped part, they are shed with an honest note and
  undo brings them back — never fed to the model as if the code were wrong. Re-run also
  re-seeds the chat history, so the next AI request sees the program actually on screen.

- **A dimension check after every AI build (item 2, phase A).** `src/lib/dimAudit.ts`
  pulls every explicit length out of the request (mm/cm/inches), and if a figure appears
  nowhere — not in the overall size, not in a parameter, not as a literal in the program —
  the reply says so: "⚠ You asked for 75 mm and I don't see it anywhere in the result."
  A caution, not a gate: figures honoured as a param or a literal (hole spacing) stay
  quiet, so it doesn't cry wolf on clearances.

- **extractParams refuses ambiguity (item 3).** It brace-balances instead of stopping at
  the first `}`, strips comments first, and skips computed values and nested objects —
  `half: 60 / 2` no longer reads as 60, a comment's number is no longer a parameter, and
  `hole: { dia: 3.4 }` neither loses the keys after it nor leaks `dia` as a slider. No
  slider beats a wrong one. And commits now send ONLY the keys that differ from the
  code's own defaults, so a misread value can no longer be forced into the solid by
  touching an unrelated slider.

- **True micrometre measurement (item 4).** The worker rounded every dimension to 0.1 mm
  before anything downstream could check it, and used OCCT's padded bounding box (up to
  0.014 mm over on curved parts — the reason exported STLs floated above the bed).
  It now measures with `BRepBndLib.AddOptimal` (true surface extrema), reports at 1 µm,
  and drops parts to the bed from the tight box. Chat and statusbar round to 0.01 at
  display, so "60 × 40 × 12" still reads clean.

- **Part fit does something (item 5).** The loose/snug/press control was shown on every
  Precise build but only reached the model in the guided "fix a broken part" flow. It
  now rides on every Precise build, with a new guard sentence so a part with no mating
  features doesn't grow a pointless clearance slider.

- **Found on the way: the plan/questions ping-pong.** With plan mode on (the default),
  "Skip the plan" → "Build what I asked for" raised a FRESH plan card, whose skip raised
  fresh questions — forever, burning a utility call per bounce, on exactly the first
  part of a fresh chat. `buildFromClarify` now passes `skipPlan` too.

**In plain words:**
1. When the AI rewrote your part the long way round, it used to throw away your slider
   changes and every hole and pocket you'd added by hand — silently. Now they ride along,
   and if one truly can't fit the new shape, the app says so and undo brings it back.
2. If you ask for 75 mm and the part comes back without a 75 anywhere, the reply now
   warns you instead of announcing the wrong size confidently.
3. Some sliders used to show numbers the code never used — and touching any slider
   pushed the wrong number into the real part. Those sliders no longer appear.
4. The app now measures parts about a hundred times more precisely, and exported files
   sit exactly on the print bed.
5. The loose/snug/press "Part fit" choice actually reaches the AI now. Before, it only
   worked in the "fix a broken part" flow — everywhere else it was decoration.
6. Bonus bug: skipping the plan and then skipping the questions used to bounce the two
   cards back and forth forever. Fixed.

## Build 488 — a reply that also recaps its parameters stops failing the build

The failure Jerry hit twice: `Your code must define \`function main(replicad, params) { ... }\`
returning a Shape.` — 31k tokens and 481 credits spent to be told the AI wrote a broken
program. It hadn't. It wrote a correct one and then recapped the parameters underneath.

- **Extraction picks the block that defines `main`, not the last block.** A spec ending
  "put these exact values in defaultParams" reliably gets back the program AND a second
  ```js block listing the parameters. That recap is valid JavaScript with no `main()` in
  it, so the kernel refused it and the retry re-sent the same shape to the same wall. The
  fallback to "last block" is kept for the case the old rule existed for — a wrong first
  attempt followed by a corrected one — and a probe asserts the later block still wins
  when both define `main`.

- **Module syntax is stripped instead of rejected.** The program is compiled with
  `new Function`, which is a script: `export function main(...)` is a SyntaxError and
  `module.exports = main` a ReferenceError. Both are a correct program wearing the wrong
  wrapper. Stripped at the last gate before compiling, so it covers hand-edited code and
  applied edit blocks too.

- **The message says something a reader can act on.** The kernel's wording is right for
  the code panel and wrong for someone who typed a description; the chat now says the
  reply came back without a finished program and what to do next. The retry prompt is
  pointed too — "if your reply contained more than one fenced block, that is the cause" —
  and the system prompt tells the model up front not to send a recap block.

- **Counts stop being measured in millimetres.** The planner is invited to offer "counts
  that resize the part", and the plan card and the build prompt then labelled every
  parameter mm: "Number of drivers: 3 mm". A label carrying number/count/quantity now
  gets no unit, on the card and in the prompt.

- `harness/mainblock-e2e.mjs` (20 checks): the recap shape builds through the real UI at
  the size its program describes; a genuinely program-less reply is explained in plain
  English; and fourteen extractor cases run through the real module against the worker's
  own compile gate. Proven discriminating — with the block-choice rule removed, five
  checks go red, including the live one.

**In plain words:**
1. When you asked for a part and listed the sizes, the AI often wrote the program and
   then repeated the size list underneath. The app read the size list instead of the
   program, decided it was broken, and charged you for a second try that failed the
   same way. It now reads the right one.
2. If the AI ever does send something with no program in it, the message says so in
   normal words instead of quoting a rule about code you never wrote.
3. The plan card used to say things like "Number of drivers: 3 mm". Counts no longer
   get a millimetre label.

## Build 487 — the test suite stops failing for reasons that aren't bugs

Three flaky probes, three different races. None of them was the app misbehaving; all
three read as if it were, which is worse than a plain failure.

- **`enter.mjs` waits for the Launchpad door instead of sampling for it.** `.launchpad`
  mounts a render before its buttons do. Every probe that reloads mid-run went through
  this helper, and after a reload the helper looked once, saw no button, and reported
  "found no way into the workspace" about a screen that grew one a moment later. It now
  waits for the button text. `resize-e2e` went from 42–75s to 12s as a side effect.

- **`resize-e2e` clicks the canvas before Ctrl+Z / Ctrl+Shift+Z.** The app's shortcut
  handler deliberately ignores keys typed into an INPUT or TEXTAREA so a field's own undo
  keeps working — and the step before types into the resize menu's `%` box. Whether focus
  had left it by then depended on how fast the menu closed: fine idle, a coin-flip under
  three-lane suite load. Its geometry waits also went to 90s across the board, because on
  a cold vite server the first OCCT rebuild outran the old 30s and the probe called that
  a crash.

- **`preview-e2e` waits for the explanation text.** `deliverResult` sets the pending
  proposal (which paints the preview bar) and the caller then rewrites the bubble, so the
  bar exists one render before the sentence does. The probe read the chat right after the
  bar appeared and lost the race.

Harness only — no app code changed in this build.

**In plain words:**
1. Three of the automatic tests were failing on and off. None of them was a real bug in
   the app — they were reading the screen a split second too early.
2. They now wait for the thing they're checking instead of guessing it's ready.
3. This matters because a test that cries wolf makes the real failures easy to ignore.

## Build 486 — messages stop re-billing dead code, and the credits counter moves when money does

- **trimOldPrograms (llm/extract.ts).** The history sent with every request carried the
  full replicad program in each assistant turn, while the current program already travels
  with the request (system-prompt build-log framing; verbatim in `editMsg` on the edit
  path). A fifth edit re-billed four superseded copies — thousands of input tokens per
  message, buying nothing. Older assistant code blocks are now a one-line "superseded"
  note; the newest is kept on the full-regen path (it is the code being edited) and dropped
  on the edit path (the user message carries it verbatim). User turns are never touched —
  their fenced blocks are their message. The trimmed history is what gets recorded, so the
  stored transcript stops growing by a program per turn too.

- **The credits chip moves the moment money leaves.** `recordSpend` (the one door every
  priced call walks through) now names its provider and notifies listeners; App subtracts
  OpenRouter spends from the chip immediately, then reconciles with the provider's own
  figure. OpenRouter's ledger lags a spend by minutes, so for 90s after one, a fetched
  figure HIGHER than the displayed one is treated as stale rather than bounced back up.
  The number plays a brief colour tick when it changes, so spending is visible.

- **Found by an adversarial review pass, fixed before shipping:** a Discarded proposal
  used to stay in the conversation as the newest program, so the next request built on
  the change the user had just rejected (`discardPending` now drops that exchange); the
  trimmed history was written BACK into memory, making the saving destructive — the
  request now carries a trimmed copy while memory keeps the full one; a manual Refresh
  is exempt from the lag guard, because "top up, come back, press refresh" lands inside
  the window; the Settings spend meter uses the same guard as the chip instead of
  contradicting it; the spend timestamp is persisted so a reload can't bounce the
  number back up; and the optimistic subtraction is clamped at zero.

- `harness/tokentrim-e2e.mjs` (14 checks): a build and two edits through the real UI,
  asserting each request's messages carry at most ONE full program, that the edit still
  works, and the trimmer's own rules (keepNewest, user code untouched, no mutation).
  `harness/balance-live-e2e.mjs` (3 checks) intercepts openrouter.ai in-page: chip drops
  without a poll, a stale poll doesn't bounce it, a genuinely fresh figure is accepted.

**In plain words:**
1. Every message you sent was secretly carrying every old version of your part's code.
   You paid for all of them, every time. Now old versions are replaced with a short note,
   and only the current code is sent. Long sessions get much cheaper per message.
2. The credits number next to the model picker now drops the instant a message costs
   you something, instead of waiting for OpenRouter to notice. It also refuses to jump
   back up when OpenRouter's own counter is running behind.
3. Both are covered by automatic tests that run the real app in a real browser.

## Build 485 — a reply that ran out of room stops looking like bad code

Reported from a real session: a speaker cabinet failed to build twice on Claude Opus 5,
about 31k tokens and ~480 credits gone, and the chat said *"Your code must define
`function main(replicad, params) { ... }` returning a Shape."*

- **The model had not written bad code — it had not finished writing.** Providers say so
  (Anthropic `stop_reason: "max_tokens"`, OpenAI-compatible `finish_reason: "length"`) and
  nothing read it. A truncated reply arrives as an ordinary 200 and reads like a complete
  one; `extractJsBlock` tolerantly returns the unclosed block, and the CAD kernel then
  blames the model for the shape of a half-written function. Both transports now report the
  stop reason through `StreamHandlers.onStop`.

- **The ceiling was the cause.** `max_tokens` was hard-coded to 8192 on the Anthropic path
  and no caller ever raised it. A parametric part with several features and printed notes
  runs past that. Streaming requests now ask for 32000 — a ceiling, not a reservation — and
  a model whose own limit is lower is retried at 8192 rather than failed, so there is no
  per-model table to rot. The non-streaming rescue path stays at 8192, which Anthropic
  requires for a non-streamed request.

- **The retry stopped making it worse.** A fragment cannot be repaired, and the old loop
  sent it back with "fix this", so attempt two carried a bigger context into the same
  ceiling — that is the second full-price call. Now a cut-off reply is answered with
  `truncatedRetryMessage()` (same part, written compactly, features in loops) and the
  fragment is kept out of the conversation. One such ask, then it stops: asking twice is
  asking the same question with nothing new to say.

- **And the message says what happened**: the model ran out of room, ask for the part in
  pieces or drop a feature. Not the kernel's `main()` line, and not a raw JS SyntaxError
  (which is what a fragment cut mid-expression actually produces).

- `harness/truncation-e2e.mjs` (11 checks) runs both outcomes through the real UI against a
  new `TRUNCATE` / `TRUNCATE_ALWAYS` stub fixture, and drives the Anthropic transport
  directly against a fake fetch — that path has its own body builder and its own stop
  signal, and the app's OpenAI-compatible stub never exercises it. Four checks go red with
  the `onStop` wiring removed.

## Build 484 — the reasoning panel reads like writing, not like source

- **The model's thinking is markdown, and the panel renders it as such.** Reasoning models
  title each section `**Like This**` and emit `##` headings and bullet lists; the panel
  printed the raw string, so the loudest thing in it was the punctuation. It now goes
  through the same `Markdown` renderer the reply bubble uses — in both places reasoning
  appears, the live panel under the timeline and the collapsed "Thought process" on the
  finished reply, which are two separate render paths.

- **At the panel's own scale.** Scoped CSS under `.think-body`: a section title is a bold
  line the same size as the text around it, not the chapter heading, hairline rule and size
  jump that give a full answer its skeleton. This is a side channel, not the answer.

- **No half-written marker flashes.** A title arrives one token at a time, so the opening
  `**` sits unpaired for as long as it takes to write the words after it — which printed
  the exact punctuation the change exists to remove. `ThinkScroll` closes an odd trailing
  `**` for the render; the model's own closer takes over a moment later. Live text only:
  a finished blob with an odd marker in it is the model's own text.

- `harness/thinkmd-e2e.mjs` (10 checks) drives it against a new `REASONING` stub fixture
  that streams paced `delta.reasoning` frames and deliberately cuts a bold title across two
  of them. It samples the live panel throughout the stream rather than once, because a
  single well-timed look would miss the flicker being complained about.

## Build 483 — the strip says what a picture IS, not where it was taken from

- **"Front" is gone from the thumbnails.** Every first attached picture was tagged Front
  the moment it landed — whatever it was, and whatever engine was going to read it. Attach
  a dimensioned drawing in CAD mode, where nothing downstream treats any picture as a
  viewpoint, and the app announced a fact nobody had stated. The tag now says what the
  picture is: **Sketch** or **Photo**. Which one leads is still shown — by the accent
  border, and in the foot line ("· the first is the front view") only on the mesh path,
  where an engine genuinely builds from one viewpoint.

- **Read from the pixels, in `lib/photoKind.ts`.** Not from a vision call: it has to be
  instant, work with no key and no network, and a wrong answer costs one click. The test
  is stroke thinness — in a drawing nearly every dark pixel sits against the page, while an
  object's dark pixels are the inside of a shape and mostly sit against each other.
  Brightness alone cannot do it, because the photograph the app's own advice asks for (a
  part on plain white) is as bright and as colourless as a sheet of paper. Colour rules a
  picture out first; a picture with no marks at all is a photograph, not a blank page.
  `harness/photokind-e2e.mjs` runs the app's own module against 13 pictures drawn from
  source in `photokind-fixtures.mjs`, including the ones designed to break it: a grey part
  on white paper, a shaded pencil sketch, a night photo whose highlights make every dark
  pixel look like a stroke edge, a drawing photographed with a vignette that eats the page.

- **The tag is a control.** Click it to disagree; the correction is remembered per picture
  and survives Retry and Edit, which restore a message's attachments from blobs alone and
  would otherwise let the re-read quietly overrule the answer the user had already given.

- **It reaches the request.** A drawing among the extras is introduced as one ("read every
  dimension written on it as exact") rather than as "an additional reference photo", and a
  photo-only ask with a drawing in front asks for the solid the drawing describes instead
  of estimating from a photograph. `prompts.ts` already read the two differently; it had to
  guess which was which from a mixed set. `harness/photolabel-e2e.mjs` (15 checks) drives
  the real UI and reads the request bodies, including the retry's.

## Builds 470–476 — a suite you can run, and chat photos you can actually look at

- **HD chat photos (474).** Expanding a photo in the transcript showed an enlarged
  *thumbnail*: `chatThumb` writes 420px webp into the chat JSON (deliberately — that is
  what keeps a project inside one IndexedDB record and inside the sync row's statement
  timeout), and the lightbox stretched it to a fixed 1100px. A 2.6× upscale of a picture
  the user had uploaded at full size. Now `Project.photos` holds the full-resolution
  blobs keyed by message id, beside the transcript: blobs cost the chat JSON and the sync
  payload **nothing**, because IndexedDB stores them as bytes and `sanitizeProject` strips
  them before the row is built. The viewer fits by default (never scaling past the file's
  own pixels), offers **Actual size** with drag-to-pan, prints the real dimensions under
  the picture, and says "Preview size — the full-resolution copy isn't on this device"
  when the thumbnail is genuinely all there is (older messages, or a project pulled from
  another machine).
  - Two schema changes came with it. `ChatTurn.id` is saved and restored, because message
    ids are the photo store's key and reopening a project used to re-mint them — which
    orphaned every photo the reload was supposed to bring back. `openProjectById` pushes
    the id counter past the restored ids so a fallback id can't collide with one.
  - `mergeProjects` unions `photos` (they are on-device blobs; a cloud copy carries none,
    so taking the more-recently-touched side alone would delete them), and the chat
    autosave prunes entries whose message has been deleted.
  - Verified end to end by `harness/hd-photo-e2e.mjs`: two photos of different sizes go
    in, the transcript keeps 420px thumbs, each expands to its **own** original
    (1400×1050 and 900×1200 — a mixed-up index shows the wrong photo at a plausible
    size), actual size renders 1:1 inside a pannable box, and all of it still holds after
    a reload, which only the on-disk copy can do.

- **Two small app fixes the probe repairs turned up (475–476).** The hole panel's
  align (=) button and its spacing field snapped to the magnet on the way in, so a button
  whose tooltip promises Δ = 0 left Δ at -0.01 and a typed 20 mm spacing became 19.91 —
  the reference hole's centre is wherever the CAD put it, not on a whole millimetre. Both
  values are measured off another hole, so they go in exactly now; hand-typed offsets and
  hand-placed clicks still snap. And "refine this as a mesh" screenshots the model and
  feeds that picture to the image→3D engine — the reply said so and the transcript showed
  nothing, so the snapshot now appears in the bubble like any attached photo, HD copy
  included.

- **Ten probes repaired (475–476), none for reasons to do with the features they cover.**
  The recurring causes are worth knowing: probes run SIGNED OUT, so the account button
  opens the sign-in popup rather than Settings (use the status bar's printer chip) and the
  sign-in modal's backdrop eats the first click unless `moldable_signin_prompted` is
  seeded; replies are revealed a character at a time, so matching the first few words of a
  sentence reads a half-written bubble; the headphone desk hook is curved nearly
  everywhere and no click on it ever picks a face (use the phone stand); and Select,
  "Surface texture", the export MENU and the .directop bar are all names for things the UI
  replaced. Three assertions were retired with the reason written down rather than
  loosened into something trivially true.

- **`harness/run-suite.mjs` (470–473).** 45 of the 61 probes printed `FAIL` and exited 0,
  so anything judging the suite by exit status read a wall of failures as green. The
  runner judges by what probes print, runs three lanes on their own vite ports, restarts
  servers that die under it, and writes per-probe logs to `/tmp/suite-logs/`. Two traps
  found the hard way: resolve on `exit` rather than `close` (an orphaned chromium
  inherits stdout and holds the pipe open — a 15-minute wait with nothing running), and
  never `pkill` browsers mid-run (lanes are concurrent; it took the score from 42 to 25).
  Nine probes were repaired from their own logs and three stale assertions retired with
  reasons written down.

## Build 459 — mesh repair that runs on your machine, and six defects an audit caught

Jerry: bigger phone heading; fix the multi-image composer; then five agents (Mobbin
research ×2, an end-to-end walk, a print-readiness feature, a code audit).

- **Phone heading.** The cap in the phone clamp was dead code — 9.4vw only reached the
  44px ceiling at 468px, wider than any handset, so the vw term did all the sizing and
  raising the ceiling would have changed nothing. Now `clamp(2.3rem, 11.5vw, 3.4rem)`:
  37px at 320, 45px at 390, 50px at 430. Two lines at every width measured.

- **`print/meshdoctor.ts` (new, 688 lines) — local mesh repair, no network, no credits.**
  Names defects instead of reporting one "open edges" number for six different problems:
  boundary edges AND how many holes they close into, non-manifold edges, inverted faces,
  inside-out shells, degenerate triangles, separate shells with their volumes in mm³.
  Repairs what can be repaired locally: welds near-duplicates (three's `mergeVertices`
  buckets on a fixed grid, so pairs straddling a bucket line survive it — this searches
  neighbouring cells), drops zero-area triangles, re-winds faces per shell, deletes
  debris under 1 mm³ AND 2% of the diagonal (both, and each deletion named with its
  volume), fans holes up to 512 edges.
  **manifold-3d is the VERDICT, never the repair** — every Manifold op needs a valid
  manifold to start with, which is exactly what a broken mesh isn't; `verifySolid()` in
  the preview worker runs the result through it before the UI may say "watertight".
  meshoptimizer deliberately unused (welds on exact equality; can't say what it removed).
  Budget `DIAGNOSE_BUDGET_TRIANGLES = 300_000`, measured: 113ms @67k, 505ms @159k,
  1.13s @312k — within a few percent of the printability pass sharing the same idle callback.
  **Cannot fix, and says so:** self-intersections (undetected — the receipt refuses the
  words "print-ready" and points at Deep repair), non-manifold edges, holes over 512
  edges, near-degenerate slivers, shells above the debris threshold.
  20 checks in `harness/meshrepair-e2e.mjs`, half of them against the real UI.

- **Six defects an audit reproduced, two of them shipped that morning.**
  - Removing the FRONT photo called `clearImage()` — deleting every other attached photo
    and all three view slots. Five attached, drop the blurry first, lose four.
  - A failed first build saved a shell project (chat, no code); reopening handed the
    kernel an empty program, and the catch appended a hidden error turn EVERY time —
    unbounded growth, a stale kernel banner, and it synced.
  - Stop was checked only around the stream. The kernel pass that follows is the slow
    half of a real build, and Stop did nothing there. Checked in both places now; the
    Comlink worker has no signal, so a mid-kernel stop can't interrupt it but does
    refuse to deliver and version the result.
  - **Hugging Face — the free default — dropped the abort signal entirely** (declared
    with two params, TypeScript accepts it as a `GenFn`), while the engine comment
    claimed every provider honoured it.
  - A stopped stream recorded zero spend though the provider bills for what it streamed.
  - The Launchpad's Improve left ~⅓ of its rewrite unreachable (grows only in `onChange`,
    `overflow-y: hidden`).

- **Card turns now persist.** `toChatTurn` dropped `plan`/`clarify`/`confirm`/`offer`, and
  each renders a CARD rather than text — so reopening a project turned the approved plan,
  the one artefact plan-first exists to produce, into an empty bubble containing only its
  Delete action. Found by the end-to-end agent; its other eight steps passed, including
  dimension claims exact to **0.000 mm** against real geometry and all four exports parsing.

- **From the Mobbin research:** you can now pick which photo is the FRONT (index 0 is
  load-bearing — the mesh engines build from it — and was whatever order the file picker
  returned). `Hint` became a tap-to-open popover: it was a bare `title=`, i.e. nothing at
  all on the phone people photograph parts with. Deliberately NOT taken: always-visible
  view slots, gauge-style quality meters, a pre-picker guidance interstitial.

Known-stale: `printprep-e2e.mjs` Part B uses a `.tabs button` selector from before the tab
strip moved into the inspector dock (pre-existing; its Part A passes). The Ollama probe
puts two console errors in every load. One run logged a duplicate `createRoot` warning
that did not recur — worth a look.

## Build 458 — Stop, the reply that survives a failed build, a calmer front door

Jerry: "Please fix it" — the whole open list, plus "it's still on v456".

- **The v456 confusion was mine, and it is now impossible.** The in-app version is
  `git rev-list --count HEAD` baked in at build time, and `deploy-pages.yml` was
  path-filtered to `moldable-lite/**` — so a docs-only commit advanced the count
  without deploying, and "shipped 457" and a site reading v456 were both true.
  **The path filter is gone**: every push to main deploys, so the number in the
  status bar is always the number of the commit that built it.

- **Stop button.** Send becomes Stop in place (`.send.stop`, red, same circle).
  `abortRef` in App holds ONE controller per request — retries included, which is
  where a stuck build spends most of its money. The plumbing was nearly all
  present: `StreamHandlers.signal` existed and `anthropic.ts` honoured it;
  `openaiCompat.ts` passed `signal: undefined`, and `GenerativeEngine` never handed
  providers the signal `GenFn` already accepts. **An abort must not read as a
  network failure** — `attempt()` treats any throw from the direct fetch as CORS and
  retries via the relay, which would re-send the request the user just cancelled;
  `isAbort()` guards it. A stopped reply is a plain bubble, not an error one, and
  keeps its reasoning. The mesh path says the provider may still bill a run that had
  already started, because aborting the poll doesn't cancel a remote job.

- **The vanishing reply, solved — and it was in the RENDER, not the send path.**
  `Messages` mapped `messages.filter((m) => !m.error)`, on a reasonable-sounding
  rule ("errors are STATUS, not conversation — 61 of them buried a session"). True
  of a tool op that didn't apply; false of a build that failed, which IS the outcome
  of a paid request. The canvas banner also auto-dismisses after 9 s, taking 8,000
  tokens of reasoning with it. **`ChatMessage.reply`** marks messages that answer a
  user turn: those stay in the transcript whatever they say, incidental errors still
  go to the banner (`CanvasToast` now skips `reply`), nothing appears in both. The
  flag rides through `toChatTurn`/`openProjectById` + `ChatTurn` — without that the
  error vanished again on the next reopen. `harness/buildfail-e2e.mjs` flipped from
  failing-on-purpose to passing.

- **Improve prompt: it works, and it was never on the Launchpad.** The in-project
  button rewrites correctly (verified end to end). The Launchpad — where a part is
  described for the first time, with nothing on the canvas to correct it against —
  had no button at all. `refineText()` is now the shared core; `improveInput()`
  drives the project box, `improveDraft()` returns text for the Launchpad (which
  owns its own draft, so its box is never written from outside).

- **Composer, one shape.** New exported **`PhotoStrip`** used by BOTH composers:
  equal thumbnails in send order, the first tagged Front, one count, one Hint, one
  Remove all. The Launchpad had a hand-written near-copy — wide chip for photo one,
  small squares for the rest — so the same five pictures rendered two ways depending
  on which side of the front door you stood. **View slots are opt-in**: three empty
  black boxes used to appear the moment any photo was attached; now a link opens
  them, and they auto-open if a slot is already filled.

- **Signed-out Launchpad.** It ended in five stacked links (Anthropic key form,
  example link, "Sign in to sync", "Start free in generative mode", "Skip"), every
  one a second route somewhere the page already went. The **key form is gone** — two
  better doors exist (send without a key and the app asks in context; Settings
  explains every provider and price), and asking for `sk-ant-…` under "What do you
  want to make?" wants a credential before showing anything. The action row is now
  two honestly-named doors. `onContinue`/`onFree`/`enterFree` and the draft key
  state went with it.

Probe note worth keeping: `stop-e2e.mjs` asserts the **server** saw the socket close
(`abortedByClient`), because a stop that merely hides the result costs exactly as
much as letting it finish. Two fixture bugs found while writing it — `req.on("close")`
fires when the request BODY finishes uploading (use `res`), and a keyword fixture
lives on in the conversation history and hung every later build in the session (so
the hang is armed over HTTP via `GET /_hang` and consumed once).

## Build 456 — Opus 5 is on the list, Retry keeps your photos, the part can be deleted

Jerry, three questions in one message: "Where is Opus 5? / When I click retry on the
button under the bubble, does it not retry with the photos I attached? / How come the
app doesn't let me right click the mode and delete it from the canvas/buildplate?"
All three were real; the second and third were bugs, the first was staleness.

- **Opus 5** added to `MODELS` in `llm/anthropic.ts` (`claude-opus-5`), and 4.8
  relabelled "previous Opus" so the pair reads as a pair. Adding it surfaced a
  worse neighbour: **`llm/pricing.ts` still carried the RETIRED Opus 4.1 figures**
  (15/75) for every Opus and 20/100 for Fable, so the "≈N cr/build" beside each
  row — the number a model gets picked on — was **2–3× the real cost**. Every
  Claude row re-checked against platform.claude.com pricing (17 Aug 2026): Fable
  10/50, Opus 5 / 4.8 / 4.7 / 4.6 → 5/25, Sonnet 5 → 2/10 (its intro price is now
  standard), Sonnet 4.6 3/15, Haiku 4.5 1/5. The table is first-match-wins, so
  the retired Opus 4.1/4 row sits ABOVE the family row, and `sonnet-5` above
  `sonnet`.

- **Retry and Edit resend the photos.** They resent the words alone: `clearImage()`
  empties the composer on every successful send, and the transcript only ever held
  420px thumbnails (`chatThumb`), so by the time either button is on screen the
  real attachments are gone from both places. A build made FROM a photo was
  silently retried as a text-only guess. New `sentPhotos` map in App.tsx keys the
  original Blobs by user-message id (bounded at 20 messages, tab-lifetime — a
  retry after reload still falls back to text).
  **The timing is the fix, not the map.** Restoring at the click was too early:
  the composer can still be holding the last send's attachments until a pending
  proposal resolves, so the restore declined ("something is staged") and the ask
  went out bare anyway. It now travels as `SendOverride.photosFrom`, which
  `send()` unpacks *after* the pending branch — the one moment the composer is
  genuinely free — then re-queues through `queuedAsk` so the next render's
  closure sees the restored state. `imageRef`/`refsRef` mirror the composer for
  the same reason `resultRef` exists.

- **Right-click → Delete on the part.** Layers had a Delete; the thing the project
  is about did not, so clearing the plate meant starting a new project and losing
  the chat with it. `deleteModel()` takes the part off the plate and nothing else
  — chat, version chain and other layers stay — and posts an `offer` card
  (`kind: "undelete"`, the fifth kind) with "Put it back", because Undo steps the
  version chain and a delete appends nothing to it.
  It keys off **geometry, not `result`**: a part you just asked for is still an
  un-applied proposal (`geometry` is the proposal, `result` is null on a first
  build), so the first cut guarded on `result` and did nothing at all in the most
  ordinary case there is. Restoring puts the proposal back AS a proposal.

- **Probes** (both committed, both driving the real UI): `harness/retry-photos-e2e.mjs`
  — Opus 5 in the list, photo build, retry, edit, delete/restore; it asserts the
  stub actually SAW the image AND that the bubble shows it, because the payload
  check alone passed against the broken build (a canvas snapshot and an uncleared
  composer both put pictures on the wire). `harness/delete-model-e2e.mjs` covers
  the pending-proposal delete specifically.

Still open from Jerry's earlier list: the stop/interrupt button (needs real
AbortSignal plumbing — `openaiCompat.ts` passes `signal: undefined`), the vanishing
assistant reply on build failure (`harness/buildfail-e2e.mjs` fails on purpose), the
"improve prompt" audit, multi-image composer consistency + a toggle for the
left/back/right slots, and the signed-out Launchpad UI.

## Build 448 — Escape works, the model says its name while it works, thinking gets a dial

Jerry: "Fix the Escape key on both modals… I still can't see what models are being used
when auto is on… not sure if there should be an option to turn off or on Thinking as
well. what do you think?"

**Escape.** Not two modals — **six**, and none of them bound the key (Templates, Sign-in,
Settings, Library, Measure, Extrude). `lib/useEscape.ts` is a shared subscriber STACK, not
a listener per modal: the naive version has every open overlay's listener fire on the same
keystroke, so a lightbox over the library takes the library down with it. Only the
last-mounted subscriber is called. Six callers, so the abstraction is earned.

**"Auto on by default" was already true.** Engine `useState<ModePref>("auto")`, webMode
`"auto"`, plan on since 446 — all three of Jerry's asks were already the defaults, so the
real gap was visibility, not defaults. Research now also resets per new part (`startPlanned`
became `startFresh`, and clears `moldable_web_mode` alongside `moldable_plan`).

**The model, while it works.** Careful correction to the obvious story: the model was NOT
invisible during a response — App.tsx:6500 narrates "Writing the CAD program with <model>…"
as a step. But that step is transient; it folds into the collapsed "Completed N steps"
details when the reply lands, and the durable `.msg-model` tag was gated on
`!m.streaming`. The model is resolved BEFORE the request goes out (`effLlm` after
`pickAutoModel`), so it is now stamped on the placeholder there, and the tag renders
during the stream — one stable place, from decision to transcript. Same on the mesh path
in `runGen`, where it matters more: minutes and real money per run, and a mid-flight
fallback rewrites the label so the transcript shows what actually ran.

**Thinking.** A display-only on/off would have been a lie about cost — you pay for
reasoning tokens whether or not the text is shown. A REAL control already existed and was
buried in Settings' third pane: `moldable_or_reasoning` → OpenRouter's `reasoning: {effort}`.
So it was surfaced, not reinvented: an Off/Low/Medium/High row in Build options beside
Research and Plan, OpenRouter-only because that is the one provider whose request carries
the param (`llm.ts` also guards per model, so a model that cannot think is never sent it).
Re-read on menu OPEN, not on mount — Settings still writes the same key, and two controls
disagreeing about one setting is worse than one buried control.

Mobbin was checked for the model-attribution question: Claude puts the model in the header
as a tappable control, WhatsApp/Meta AI as a header subtitle ("Llama 4"), Brave Leo with an
ⓘ, Mimo as a composer chip. All keep it in persistent chrome rather than only on the
finished message — which is the pattern adopted here, scaled to a composer row that has
8.7px of slack at 320px and cannot take a fourth chip.

Probe: `assist-visibility-e2e.mjs`, 14 checks. The stub gained a `SLOWBUILD` fixture that
holds a reply open ~2.5s, because with an instant stub the mid-stream state is gone before
Playwright can look at it.

## Builds 443–447 — the phone gets its hierarchy, the engine gets stated, planning gets honest

**443–444 — phone hierarchy and a decluttered nav.** Jerry, from an iPad/phone: "mainly
the issue is heirarchy", then "nav looks a bit cluttered". The phone type scale was a
44 px headline followed by a flat 16 px plateau; it is now a measured step (h1 31 → sub 13
→ composer 16 → labels 11–12). The account pill was wrapping to two lines, so the email
hides on phones (`.la-who`) and the explainer paragraph under the h1 now only renders for
newcomers — six Mobbin iOS references all show no explainer on the home screen. Also a
genuine overflow bug: `.signin-card { max-width: 440px }` was overriding `.card`'s
`calc(100vw - 48px)` and running 74 px off a 390 px screen.

**445 — the engine is a project fact, not a mode.** Jerry asked why a CAD project can
still toggle the Mesh tab when the app won't honour it. It was worse than he thought:
"Auto" is inert once a model exists, and `appendVersion` spreads the snapshot onto the
project root, so `project.engine` is silently reclassified by whatever the last version
built. A segmented control also lies about reversibility. Now: once geometry exists the
seg is replaced by an `EngineChip` in the statusbar that STATES how the part was built,
and crossing to mesh is a deliberate two-step with the losses, the History escape and the
cost named. Watch the phone statusbar — the chip cost 111 px in a row that already summed
to 383 px in a 390 px box, which is why Export is `position: sticky; right: 0`.

**446 — plan first, said out loud and meant per part.** Planning already ran by default
and nothing said so. There is now a `Plan · on` chip in the Launchpad composer foot. The
sharper fix: "off" was a permanent global setting, so one mid-project opt-out silently
skipped the spec on every part afterwards — it resets per new part now. And `draftPlan`
took ONE image while the builder took the whole set, so the plan you read and corrected
had seen less of your part than the thing building from it; it gets every reference, is
told they are views of ONE object, and is asked which view each number came from.

**447 — what the 446 review found.** Four reviewers over the 446 diff, each finding
attacked by a skeptic before it was believed. Three real:
- **The plan skipped the photo byte budget.** The build path fits the set to 9 MB
  (`fitPhotoBudget`) precisely because PNG sketches stay PNG and a stack of them is a body
  the provider rejects. The plan path encoded raw — and `draftPlan` swallows failures, so
  it would not read as "too much to upload", it would read as the plan quietly not
  happening, on exactly the heavily-referenced parts it is for. Measured: 13.9 MB of
  sketches → 18.5 MB sent before, 5.1 MB after.
- **Two reset paths were wrong.** A cold load never ran the reset at all (`planOn` boots
  straight out of storage), so an "off" pinned in a tab closed yesterday survived the
  night. And `goHome` ran it unconditionally — but "All templates"/"All projects" enter the
  workspace to float a modal, and the wordmark is the only way back, so browsing undid a
  choice made on the Launchpad. A `partStarted` ref tells the two trips apart; asking the
  project instead fails the other way, since walking home mid-build has no project yet.
- **The composer row sits under the send button below 375 px.** Both are absolutely
  positioned in opposite corners with the send button later in the DOM, so nothing pushes
  or wraps — the row slides underneath and the covered part of a chip taps as SEND. Also
  found: 446's `gap: 6px` had been dead all along, because the phone block sat EARLIER in
  the file than the base rule at equal specificity. The paperclip drops its label on
  phones; 360 px went from 12 px overlapped to 48.7 px clear.

Prompt hardening too: the planner is told words inside a picture are labels to read and
never instructions, and `planToPrompt` no longer stamps planner-written text with "the
user has reviewed these numbers" — text transcribed from a photo was inheriting the
authority of something the user typed.

Harness: `stub-llm.mjs` is now IN the repo (it lived only in a session scratchpad, so the
probes could not run from a clean clone) with a `GET /_reset` — probes index into its
request log, so a run following other runs sliced past its own requests and reported an
app bug that wasn't. New probes: `plan-payload-e2e.mjs` (multi-MB PNGs — 1×1 pixels prove
nothing about payload) and `launchpad-widths-e2e.mjs` (320–414 px).

## Builds 433–439 — reload keeps your part, and the harness gets repaired

**Build 436 — the resume window.** Build 429's "always land on the Launchpad" was too
blunt. Jerry: "if I refresh it, it'll still stay within the project. But if I won't touch
it for hours, then it'll refresh into the launch pad." `lib/session.ts` stamps the last
time the app was TOUCHED; a stamp under `RESUME_WINDOW_MS` (2 h) reopens the part, older
lands on the Launchpad with it offered on the shelf. Leaving via the wordmark clears the
stamp; so does wiping the device. The stamp never syncs.

**Trap worth keeping:** stamping on `pagehide`/`visibilitychange` was tried and is WRONG.
Those fire on the way out of every load, so a tab idle five hours stamps itself fresh the
instant you press refresh and carries you back in — defeating the window entirely. Only
real interaction may stamp it. The probe caught this, not review.

**Build 433 — nothing moves on hover in the template and library galleries.** Reported as
the gallery shrinking a few per cent while hovering a tile. Measured every frame at DPR
1/2/3: no box moves by a pixel, so it is compositing, not layout — a transform on a child
promotes a layer and forces the panel to re-rasterise. Removed the remaining hover
transforms (thumbnail scale, library card lift). The template card had already lost its
lift for a near-identical report ("the gallery shaking"); this finishes that.

**Build 435 — Library toolbar heights.** The modal-wide `.card input/select` 44 px rule
still won on HEIGHT over the library's own overrides, so search + selects sat at 44 px
between ~28 px buttons. Everything in `.lib-toolbar`/`.lib-bulk` is 33 px now.

**Four subagents** in `.claude/agents/`: `probe-auditor` (adversarial probe review — every
rule in it is a mistake made here), `moldable-verifier` (owns the harness ritual),
`kernel-bencher` (one OCCT case per process under timeout), `diff-reviewer` (runs
/code-review then the no-ai-slop pass).

**The harness was systematically stale — seven repairs, all script rot, no app bugs.**
`harness/triage.mjs` runs the suite in resumable batches and refuses to score a script
that exits 0 having asserted nothing as a pass. What it found:

1. 56/61 scripts seeded `moldable_entered` then waited for `.topbar`; that flag went inert
   in build 429 so they sat on the Launchpad for 60 s. `harness/enter.mjs` clicks the
   Launchpad's "Open an empty workspace" door and waits for the topbar to be POPULATED —
   `.topbar` renders one commit before its buttons, and callers click Templates on the
   very next line.
2. 33 scripts matched `"Build the X template"`; the modal grid says `"Build the X —
   instant, free"` now. They match the stable prefix.
3. 13 scripts named templates removed in the rebuild-to-12 (coaster, cable clip, wall
   hook, washer/spacer), remapped to the nearest survivor by function.
4. 15 scripts found the composer by placeholder copy (reworded twice) → `.composer
   textarea`.
5. `"Or start from a template"` lost its "Or".
6. `geometriesTo3MF` → `write3MF`. One word; the script then passed every check.
7. **`gen-thumbs.mjs` rewrites tracked artwork.** It re-renders template thumbnails into
   `src/assets/templates/`, so a sweep left a modified `box-with-lid.webp` in the working
   tree. The triage now skips generators that mutate tracked files.

**Genuine app findings, deliberately NOT patched away** (fixing a test to hide these would
be the worst possible outcome):
- `boot-e2e` **B3: the kernel does not finish warming with no interaction.** Landing on the
  Launchpad instead of the workspace plausibly changed this — first build after landing may
  now be slower.
- `damping-e2e` **A5: camera damping does not scale with frame time** (0.265 at 20 Hz vs
  0.150 at 63 Hz). May be headless frame-rate noise; needs a judgement call.
- `dims-e2e`: selection bounding box measures 0 px.
- `engine-audit`: the mesh templates fail with "must define function main" — likely the
  stub returning CAD-shaped code for mesh fixtures.
- `double-send-e2e`: double-tapping Send fires 3 requests, hammering Enter fires 2.

Triage state lives in `harness/triage-state.json` (gitignored, resumable). At handoff:
15/60 verdicts on the post-repair run — 2 pass, 5 shots, 10 fail. Re-run with
`node triage.mjs 20`.

## Mixed CAD + mesh scenes — researched, not yet built

For the speaker project. Two agents (codebase + industry) reported; conclusion:
**objects stay native-kind, the scene is heterogeneous, export per-kind** — literally what
Onshape ships as "Mixed Modeling". Mesh→BRep is a trap (FreeCAD's own docs call it "not an
easy operation"; no credible WASM implementation exists), BRep→mesh is free and safe below
printer resolution. Slicers prove the scene model: a flat list of independent objects +
plate assignment + per-object overrides.

Moldable already does most of it IN SESSION: importing a mesh beside a CAD model,
per-object plate assignment, and combined multi-object multi-plate 3MF export all work
today. **The missing piece is persistence** — only text and logo layers survive a reload;
a plain imported mesh lives in session memory. The recommended next cut is a
`MeshLayerSnap` mirroring the logo pattern (`Version.meshes?`, `meshesForSnap()`,
`restoreMeshes()`, plus every `appendVersion` call site — the schema silently ERASES any
field a writer forgets). Honest constraint: blob-backed second objects cannot sync —
`pushMeshes` writes exactly one `<uid>/<projectId>.bin` per project.

## Build 429 — the app stops reopening your last part, and the shelf becomes a shelf

Jerry: "When I load the app, I want it to always load me to the library or launchpad. I
don't want it to always load the app UI with the last 3D model I was working on. I would
say let me choose if I want to open it again or not." He also asked whether the library
should become a separate gallery page, Figma/Weavy style, and asked for Mobbin research.

**Cause:** `moldable_entered` was persisted. After your first visit it was always "1", so
the boot effect took the `openProjectById` branch every time. The Launchpad was reachable
only by noticing that the wordmark is a link. `entered` is now plain in-session state.

**Mobbin research** ([Figma](https://mobbin.com/screens/e9894255-1cab-4430-b03e-9637f1ff3ac2),
[Framer](https://mobbin.com/screens/fe4dd3de-54d8-433f-b4ce-a8c80dbf2353),
[Lovable](https://mobbin.com/screens/0dcae4bf-2382-4c4d-b656-fc8ac24fc51c),
[Riverside](https://mobbin.com/screens/a9f46e08-be7b-4671-8ece-d112a2d4a588),
[Programa](https://mobbin.com/screens/bd19e1fc-02a6-4a99-b760-b3bd5ce5ceb9),
[NotebookLM](https://mobbin.com/screens/50009231-f307-4d7d-97ee-bd6ec5f1e001)):

- **None of them auto-open your last file.** Every one lands on a project gallery.
- The card is invariably picture-on-top, name + edited-time under it. Time, not file type,
  is the second line — it is what separates two similar thumbnails.
- **Riverside settles the "separate page?" question**: it puts its create surface
  ("What will you create today?") ABOVE the Projects grid on one screen. That is what the
  Launchpad already is, so the answer to Jerry was *don't build a second page* — make the
  existing recents row a real gallery. A separate route would split "make something" from
  "open something" across two screens for no gain, and the Library modal already owns
  search/rename/delete.

**Shipped:** shelf 4 → 12 cards; card rebuilt as a 4:3 picture tile with name and
`kind · when`; the last part keeps the accent ring and reads "Continue · just now";
label shows "Your projects · 12 of N" when there are more. `lib/when.ts` now holds the one
relative-time helper (the version list had a near-identical private copy) and gained
"Yesterday" plus a year on older dates.

Verified with `landing.mjs` (build → reload → Launchpad → click → part opens with its
geometry → reload → Launchpad again).

**Corrected in build 431.** Twelve cards was wrong. Jerry, on a real library of 93: "too
many project files are being shown, heading is too high. keep the old design where it
shows 3-4 projects and then clicking on 'All projects' shows me all of them." Both
complaints were one bug — the shelf pushed the column past the viewport, so the Launchpad
scrolled and the heading rode up under the top bar. Now four cards in ONE row (explicit
column count: four items on an auto-fill grid land on three-plus-an-orphan at a range of
widths; two columns under 700 px), label "Your projects · 4 of 93", and the column's
decorative foot trimmed 6vh → 2vh with body padding 32 → 24 px. A signed-out 1512x900
laptop measured 42 px over and is now exactly 0. `shelf4.mjs` seeds 93 projects straight
into IndexedDB and checks four widths plus the Library hand-off. **The lesson: the shelf
is not the point of this screen — the composer is. It gets a glance, not a screenful.**

**Two probe-hygiene notes worth keeping.** (1) The old probe corpus seeds
`moldable_entered: "1"` to skip the Launchpad. That key is inert now, so those scripts
start on the Launchpad, where the composer is `.launch-composer textarea`, not
`form.composer textarea` — expect timeouts there and update the selector. (2) `shelfgrid`
first reported "all good" having run ZERO checks, because a fresh browser context has no
projects and every case skipped; and its "light" run was a second dark run, because
`addInitScript` re-runs on reload and kept resetting the theme. Both now assert they
actually ran. A pass with no checks is not a pass.

## Build 427 — screw threads take a turn count, and the helix question gets numbers

Jerry: "How do I add sweep to a screw and control the parameters of it?" — the follow-up
to his earlier "I want to control how many spirals or how many times the spirals go
around the cylinder".

`makeThread` now takes diameter plus **any two of pitch/length/turns** and derives the
third (turns = length / pitch). An explicit `turns` is honoured exactly: the rib count is
that number, the pitch is whatever makes it fit. `turns` and `starts` joined the count
parameters in `cad/params.ts`, so Adjust steps them by whole numbers and no longer
labels a count "mm". `llm/prompts.ts` documents the signature and tells the model to
reach for `turns` when the user phrases it as turns.

**The helix question is now settled with measurements** (`scratchpad/helixcase.mjs`,
one process per case so a kernel hang kills only that case). The old header comment
blamed the sweep; that was wrong. The sweep is cheap — the boolean is the wall:

| step | time |
| --- | --- |
| `sketchHelix` | 9–13 ms |
| `sweepSketch` (frenet) | 60–164 ms |
| FUSE ridge onto core | hangs past 5 min |
| CUT groove, M3×0.5×3 (6 turns) | 8.2 s |
| CUT groove, M8×1.25×10 (8 turns) | **fails** at 7.4 s |
| CUT groove, M6×1×12 (12 turns) | **fails** at 12.1 s |
| CUT groove, 30×3×60 (20 turns) | 85.7 s |

The watchdog is 25 s, so cut is not a rescue: it fails outright at the two commonest
screw sizes. A true helix **is** reachable through Manifold (361 ms at dia 8 / 4 turns,
516 ms at dia 12.8 / 10 turns, genus 0 both; degrades past ~20 turns — dia 20 / 20 turns
is 13.4 s and genus −6, i.e. broken), but its output is a **mesh**: no STEP, no further
CAD ops. That is the same trade the surface-pattern path already makes, so the machinery
exists — but converting a CAD bolt into a mesh is a product call, left open for Jerry.

Verified through the app (`boltturns.mjs`): the AI's code calls `makeThread` with
`turns`, the worker builds it, Adjust shows Turns, and 8 → 14 raises the crest count
measured off the displayed mesh.

## Build 426 — a pattern try-on stops surviving a version restore

Jerry: applying a texture records a History step, but restoring an earlier version
"automatically puts the textures back on it" — and he guessed the cause correctly. The
committed surface was already per-version (build 407-era fix); what leaked was the
**uncommitted try-on**. `fxPreview` is view state that outlived a history navigation, so
the pattern you were only auditioning was re-applied on top of whatever you restored —
the model on screen was a version that never existed, and an export taken there would
have carried the texture.

- `rebuildHead` clears the try-on (restore, undo/redo and open all funnel through it).
- `PatternFly` cancels a preview still sitting in its 220 ms debounce when the applied
  surface changes underneath it.
- New **Live preview** checkbox in the pattern panel (Jerry's suggestion). Off, tiles and
  sliders only move the panel and the model changes on Apply — also the lever for
  browsing swatches on a heavy model, since a try-on subdivides the whole skin.

Verified with `fxrevert.mjs`. **Measurement note worth keeping:** the first version of
that probe compared vertex COUNTS and passed without a try-on ever being in flight —
refinement is depth-independent by design (build 422), so changing Relief keeps the
vertex count identical and only moves the points. Fingerprint pattern work with a
position checksum, never a count.

## Build 424 — the Settings offline banner gets the health-check link

Jerry hit the signed-in-but-offline banner on his iPad and asked how to fix it. The
banner was still the pre-421 wording: it asserted "supabase.co looks blocked" off a
plain boolean (cloudOffline is not a probe verdict) and offered no way to check —
the sign-in dialog got the honest wording + health link in build 421 and this banner
was missed. It now states the fact, links the health endpoint (loads → false alarm,
press Retry; fails → something on the device filters supabase.co), and names the
culprits that actually occur on an iPad: a VPN, iCloud Private Relay, a content
blocker (supabase.co appears on ad-block lists), a DNS profile. Verified with
Playwright (`offlinebanner.mjs`).

## Build 423 — patterns preview live and render clean; replies say who wrote them

Three Jerry requests with reference photos (the fluted-vase 3D prints): pattern/texture
quality "very low quality and badly rendered", "I can't tell what model the chat is
using", and a Perplexity-inspired chat pass (researched via Mobbin + teardowns — see
the design brief in this session; items 6-8 of it are still open).

**Why patterns looked lumpy, and the fixes** (`preview.worker.ts`):
- **Phong tessellation midpoints.** Subdivision midpoints sat on the CHORD of the
  original coarse tessellation, so the "smooth" base the displacement rode was still
  the old faceted surface — crest heights varied with where each vertex fell on a
  chord, which is exactly the wavy-streak look in Jerry's screenshot. Midpoints now
  project toward the surface the endpoint normals describe (Boubekeur–Alexa, α=0.75),
  guarded by normal agreement so model edges stay sharp.
- **The refinement budget degrades instead of abandoning.** `if (out > MAX) break`
  threw away a whole pass at the budget line, so a FINER Size setting could resolve
  COARSER than a bigger one. Over budget now loosens the tolerance ×2 and re-marks —
  the shortfall spreads evenly instead of leaving a seam.
- **Refinement is depth-independent (proven, not hoped):** the split test compares
  relative deviation, so the same refined mesh serves every Relief value. That's what
  makes the cache correct.
- Ribs refine to 8 facets per crest (was 6); clay/Grayscale view no longer runs
  `toCreasedNormals` over a treated surface (it flat-shaded every crest).

**Live preview** (the second half of the ask): tapping a tile or moving a slider now
shows the pattern on the canvas immediately, uncommitted — no history entry; closing
the panel snaps the committed surface back; Apply commits exactly one step and
re-renders at full quality. Two mechanisms: `fxPreview` state in App (an overriding
spec the fx effect renders without committing) and a **refine cache** in the preview
worker keyed by base+pattern+scale+quality, so Relief drags only re-run the cheap
displacement. Try-ons run at a **quarter triangle budget** (draft), Apply at full —
quality is part of both cache keys so neither can be served the other's mesh.
Measured on the worst-case shape (a shelled 87 mm box = 109 ribs, slow VM): tile tap
9.2 s, Relief re-drag 4.7 s, Apply full 819k tris. Jerry-sized cylinders are ~20-30×
smaller. Probe: `fxpreview.mjs` (all 12 checks green).

**"Which model wrote this"** — the tags existed and were being destroyed: both chat
serialisers dropped `model`/`usage`/`thinking`/`steps`/`sources`/`ts`, and the loader
rebuilt messages without them, so every reload wiped the metadata. One `toChatTurn()`
now (thinking capped at 4 KB for the sync row), the loader restores everything, and
the generative-mesh path stamps its engine label too. Verified across a reload.

**Perplexity items shipped** (from the research brief): finished replies collapse
their work into "Completed N steps" that expands into the real timeline rows (not a
text blob — `thinkTrail()` is reasoning-only now, steps live on `m.steps`); source
chips gained favicons; the research flow narrates its missing "Read N sources —
domains" beat; markdown headings got a real hierarchy (weight/spacing + hairline
section dividers — every level used to render smaller than body text); a successful
web-search block collapses to its head line instead of duplicating the chip list.
**Still open from the brief:** inline numbered citations wired to sources (item 7),
reveal cascade (item 6), elapsed-time footer (item 8).

## Build 422 — Adjust stops white-screening the app; the peek probes at the right resolution

Chasing Jerry's "the parameters stopped highlighting the faces" report turned up a
crash sitting underneath it.

**The crash (found, reproduced, fixed).** `ParamsPanel` declared
`const outstanding = useRef<CadParams[]>([])` **after** the
`if (!isCad || !defaults) return …` early return, while a `useEffect` above it read
`outstanding.current`. A hook that only runs on some renders is a Rules-of-Hooks
violation with teeth: on a model with nothing adjustable — or simply on the render
before the parameters are extracted — the component returned early, the `useRef` never
initialised, the effect ran anyway, and React tore the whole tree down into
*"Something went wrong loading Moldable — ReferenceError: Cannot access 'outstanding'
before initialization"*. Opening **Adjust** could white-screen the entire app.
Moving the hook above the early return fixes it. Probe: `adjustcrash.mjs` drives both
cases (a model with parameters → 4 rows listed; a model whose build never landed →
"Nothing adjustable in this design yet"), asserting no error screen and no pageerror.

**Param peek — the probe was measuring against the wrong resolution.** `runParamPeek`
built its nudged probe with `preview: true`, which in `replicadEngine` means
`{ probeLimit: false, coarse: true }` — the two were welded together. So the probe was
tessellated at `MESH_OPTS_COARSE` (0.2 mm / 0.6 rad) and then diffed against a display
mesh built at 0.02–0.08 mm (or 0.05 once the shape passes 300 faces). That disagreement
alone is ~0.25 mm on curved surfaces, against a diff tolerance of exactly
`max(0.25, diag × 0.004)` — so on a rounded, fillet-rich part `affectedFaces` saw most
of the surface "move", hit its `> 90% moved` bail, and returned null. Which is
precisely "a model that was made very cleanly stopped highlighting".

Two changes: a third build mode (`probe: true` — still no limit-probing, so a hover
never costs eight bisection rebuilds, but meshed at the **same** quality as the base),
and `peekCache` now stores only real answers. It used to cache the null too, so one bad
reading made that row permanently dark until the code, params or ops changed.

**Drag frames are now marked as drag frames.** `applyParamsLive` passed `preview: true`
to the *worker* (pick a coarse mesh) but nothing ever stamped the BufferGeometry, so the
two consumers that already know how to skip work on a drag frame never fired — the
Viewer's per-swap `EdgesGeometry` crease pass, and the surface pattern/texture
displacement, which re-welds and re-subdivides to as much as 700k triangles (1.2M for
ribbed patterns) **per tick**. The push/pull drag path has stamped `userData.preview`
for a long time; the slider path simply never did. It does now, and the fx effect
returns early on a preview frame.

**Honest limits on this one.** Only the crash fix is verified end-to-end. I could not
demonstrate the drag speedup: the only model I can synthesise here is a 4-parameter box
with no ops and no surface treatment — none of the diagnosed costs apply to it — and
run-to-run noise on that model is larger than any effect (identical code measured
471 ms and 937 ms release→settled). A third change (a trailing `onLive` on release, so
the commit build would hit the worker's shape cache) was **written and then removed**:
it adds a build on release, and I had no measurement showing it pays for itself.
The place these should show is Jerry's actual model — 39 history steps, 11k triangles,
patterns in use.

**Not shipped, but now known** (see the four-way diagnosis in this session):
- *Real spirals are feasible.* `threads.ts` says a true helical sweep "hangs the build
  past the watchdog… even on a 4-turn stud". Measured in the real browser kernel: the
  helix is 9 ms and the swept ridge 63 ms — it is the **OCCT boolean** that hangs, not
  the sweep. Unioning through **Manifold** (already shipped, used by the preview engine)
  instead: Ø8×1.25 4-turn = **361 ms**, Ø12.8×1.5 10-turn = **516 ms**, both watertight
  (genus 0). 20+ turns degrades (Ø20×2.5 20-turn took 13.4 s and came out genus −6), so
  a turns control wants a bound and a genus check. The open design question is that a
  Manifold result is a mesh, not an OCCT solid — so it cannot take further CAD ops or
  export STEP.
- *Textures/patterns.* Refinement is 95–98% of the wall time (knurl s=1.5: refine
  5555 ms vs displace 163 ms), and the Relief slider only affects refinement through one
  number — so a refined mesh is reusable across the whole Relief range, which is what
  makes live preview possible. Two quality bugs found: the refinement loop **discards
  the whole pass** when it would exceed its triangle budget (so a *finer* Size setting
  resolves *coarser* — the opposite of the control's promise), and the triplanar
  projection halves relief contrast at 30°/60° azimuth on any curved wall.

## Build 421 — the network verdict stops crying wolf (and says it once)

An iPad screenshot on v419: the sign-in dialog with **two red boxes stacked**, both
saying the network couldn't reach supabase.co, in two different wordings. Two defects
behind it.

**It said the same thing twice.** The dialog rendered its own up-front `blocked`
banner *and* whatever a failed attempt reported. Now one box, ever: the reachability
verdict wins while it stands (it is the more specific of the two), and anything else
appears only when the network isn't the story.

**And the verdict itself wasn't trustworthy.** `probeReachable()` had two flaws that
both push toward a false "your network is blocking this":

- It sent an `apikey` header. That makes the request non-simple, so every probe first
  had to survive a **CORS preflight it never needed** — a whole extra failure surface
  for an endpoint that is public, and one the code already didn't depend on (a `401`
  counted as reachable, because the server answering *is* the question).
- **One try, 5 s.** A first request doing DNS + TLS on a sleeping mobile radio can
  miss that honestly, and the failure was then reported as censorship.

It is now a bare `GET` (no preflight), two tries at 8 s, and it returns *which* kind of
failure: `"slow"` — didn't answer in time, usually a weak connection, try again — or
`"blocked"` — something refused outright, so a DNS filter, VPN or content blocker, and
note that supabase.co does appear on some ad-blocking lists. `reachMessage()` holds one
wording per verdict so the two call sites can't drift apart again. Both cases now offer
the health URL as a link: **opening it in a tab is the test that settles it** — if it
answers there, the app was wrong.

Verified with Playwright against a health endpoint that answers / hangs / refuses
(`reach.mjs`): exactly one box in every state, none at all when reachable, no `apikey`
header and no `OPTIONS` on any probe, two attempts before judging, and the hanging case
reading as "slow" rather than "blocked".

## Build 420 — the work-computer build: blank-page boot, blocked logins, a library that outlived the account

Three reports from a work machine, and two of them turned out to be the same root
cause: **that network blocks third-party hosts, and Moldable was leaning on them.**

**1. "Some models take 20+ seconds to load."** Not the CAD kernel — OCCT boots in
~0.4 s and the 10.9 MB wasm fetches in ~0.2 s. It was `index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk…" rel="stylesheet">
```

A stylesheet link **blocks first paint**. When `fonts.googleapis.com` can't be
reached — corporate networks filter it as a standard GDPR/tracking rule — the browser
waits for the socket to give up before running a single byte of the app. Traced on the
production build with that host black-holed: `DOMContentLoaded` at **12,751 ms**, and
every other request in the app queued behind it.

Fixed by self-hosting: 95 KB of woff2 in `src/assets/fonts/`, `@font-face` at the top
of `src/styles.css`, bundled and fingerprinted by Vite, zero off-origin requests during
boot. Schibsted Grotesk is a *variable* font — 400/500/700 were byte-identical
downloads — so it ships once per subset with the weight range declared, not three times.

Measured after, with all third-party hosts hanging (not rejecting — a filter that
swallows packets is the slow case):

| | before | after |
| --- | --- | --- |
| first paint | 12,751 ms | **67 ms** |
| app usable | 13,485 ms | **1,094 ms** |
| off-origin requests during boot | 1 | **0** |

**2. "GitHub isn't letting me log in."** Same class of problem, and the pre-flight
check was looking at the wrong host: `ensureReachable()` only proved *supabase.co* was
up, then handed the whole tab to github.com — which on that network is a dead page with
no way back. Now `cloudOAuth` also probes the provider's own host and refuses with words
that name it and point at what still works.

The dialog itself was the deeper problem: **email + password was folded away inside a
`<details>` under the two provider buttons**, so the only method that works on a
locked-down network was the one you had to go looking for. It leads now, with the
providers below an "or" rule, and one line covers the case Jerry was actually in —
*"Forgot it, or signed up with GitHub and never set one? Email me a link to set a
password."* (That is `resetPasswordForEmail`: the link signs the browser in, and the
password field is then reachable.) In Settings, "Set a password" came out of its
`<details>` and lost the "(for the Mac / Windows app)" label that made it look
irrelevant on the web.

**3. "My library still shows up on the work computer after it asks me to log in."**
Jerry's call, asked and answered: *"it doesn't make sense to have an account and have
the models synced if you can access them as a guest. Also it doesn't help with privacy."*
So **signing out now erases this device's copy** — but never blindly:

- it uploads to the account **first**, and a failed upload stops with the reason;
- it says what it is about to remove, by count, and that the account keeps them;
- backing out of either confirmation changes nothing at all.

`runSignOut` in `src/lib/cloud.ts` holds the whole rule, because the app has **two**
sign-out buttons — Settings → Sync and the account menu — and the account-menu one was
calling `cloudSignOut()` straight, leaving the library sitting on the machine you had
just signed out of. Both go through the one function now.

Two things the probe caught that reading would not have:
- the completion message was being posted **into the chat**, which triggers the project
  autosave, which wrote the open project straight back into the store the wipe had just
  cleared — the receipt undid the deletion. The message is held until after the reload
  decision now, and both callers reload immediately instead of after a beat.
- `wipeDevice` does a second delete pass for anything a save in flight put back.

Settings and API keys are deliberately **not** wiped — they are this browser's setup,
not the account's work, and clearing them would mean re-entering keys after every
sign-out.

Verified with Playwright against a mocked Supabase: the sign-in dialog's shape, a
blocked GitHub failing without navigating away, and the wipe driven from **both**
sign-out buttons including the cancel-changes-nothing case (`authwipe.mjs`), plus the
blocked-network boot measurement (`blockednet.mjs`). Phone and desktop suites re-run
green.

**Still open:** the session-expiry case (the server ends the session on its own) can't
upload first, because by then there is nothing to authenticate with. Today it leaves the
data in place; making that path lock or clear the library needs its own decision.

## Build 419 — the phone toolbar folds away

Jerry, after 418: *"Design it properly. Maybe make the toolbar collapsible that
houses the screw and move tool."* 418 made all thirteen tools **reachable** on a
phone by letting the strip scroll — but a scrolling strip is still a desktop rail
turned sideways: it stood over a 390px canvas permanently, and half its tools
needed a swipe. This replaces it.

**The bottom bar.** One row along the thumb arc: a **Tools** button at the leading
edge, **Inspector** at the trailing edge, stage in between. Measured on an iPhone
13: 189px of clear canvas between them where the strip used to run edge to edge,
and the rail's box drops from 48px tall to **0** when folded.

- The Inspector's vertical `‹ INSPECTOR` edge tab lies down into that row on phone
  only — same material, same height, same radius as Tools, so the two read as one
  toolbar rather than a floating pill plus a tab hanging off the screen edge.
  Desktop and iPad keep the vertical strip (a `.dock-rail-ico` / `.dock-rail-chev`
  pair swaps the glyph for the chevron; both regression-tested).
- **Folded is not amnesia**: when a tool is armed the Tools button wears *that
  tool's* icon and name in the accent (`Text`, `Move`, `Fasteners`…). A folded
  toolbar must never be the reason you cannot tell what is running. `liveTool` in
  `Workspace.tsx` derives it in rail order from the same controllers `appToolOn`
  reads, so a new tool can't quietly fall out of it.
- Its default glyph is a new `IconTools` (2×2 tiles). It first borrowed
  `IconTransform`, which read as *Move is armed* — exactly the thing this button
  must not imply.

**The tray.** Tapping Tools opens a **5-column labelled grid** over the stage —
every tool visible at once, with its *name*, which the icon strip could never do.
Five columns, not four: 13 tools over four columns is a fourth row holding one
tile, and that row cost the stage 270px against 192px measured. Tiles are 56px
minimum.

- **Picking a tool folds the tray**, and the tool's own panel opens in the same
  slot — one band above the bar, one occupant. Re-opening the tray while a tool
  runs hides that panel rather than stacking on it.
- Structural note for whoever touches this next: the rail keeps a `translateZ(0)`
  so it stays the **containing block** for its `position: fixed` flyouts. Folding
  therefore zeroes the box (`height`, `padding`, **`border-width`** — a
  transparent 1px still measures 2px) and hides the *buttons*, never the wrappers,
  because a wrapper carries the open panel and `MaterialMenu`'s wrapper has an
  inline `display` a class cannot outrank. `pointer-events: none` on the folded
  rail inherits into those panels, so they re-assert `auto`.

**Fixed alongside:** the showcase-scene bar and the plate bar were pinned at
`bottom: 12px` on phone — which is exactly where the tool row already was. Both
now sit at 62px, clear of it, as do the canvas toast and the selection actions.

Verified with Playwright at an iPhone 13 viewport in **both themes**
(`phonebar.mjs`, 27 checks each) plus a desktop / iPad-portrait / iPad-landscape
regression (`barwide.mjs`) proving the wide layout is byte-for-byte the vertical
rail it was.

## Build 418 — the phone's tools become reachable

Reported as "mobile UI still looks a bit unusable", with a request to work from Apple's
patterns. **Note for future sessions: there is no Apple/HIG skill on this account** — I
checked. The references used were Mobbin iOS screens (Apple Store, Crate & Barrel, Best
Buy's 3D viewer, Instagram's edit strip, ChatGPT/Craft sheets) plus `emil-design-eng`.

**The headline defect was functional, not cosmetic — and the numbers are stark.** The
phone tool rail set `max-width: calc(100% - 16px)` with NO overflow rule, so tools past
the screen edge could not be reached at all. Measured at iPhone 13: **588px of tools in a
372px rail** — roughly five tools completely unreachable, silently.

A comment in the CSS explained why overflow had been avoided: the tool flyouts are
absolutely-positioned children, and any overflow value would clip them. That constraint
is real, so the fix has two halves that only work together:
- `.canvas-rail` becomes a scrolling strip — momentum scrolling, hidden scrollbar,
  `overscroll-behavior-x: contain`, and a `mask-image` fade at each end so the overflow
  announces itself rather than looking like a hard edge.
- `.rail-fly` becomes `position: fixed` — which is what lets the rail scroll without
  clipping it, AND stops a panel drifting off-screen when the strip is scrolled. It
  also buys the phone what the popover never had room for: full width (356 of 390px),
  so the controls inside get real touch targets instead of a two-column wrap.

**Top pill:** icons only (`.btn-label` hidden) and Help removed — reference material, not
something reached for mid-gesture. 266px wide now, comfortably inside the screen.

Caught while writing it: the first attempt hid Help via a `.help-btn` class **that does
not exist in the markup**, which would have silently done nothing and been reported as
fixed. The selector is `[aria-label="Help"]`, verified against the JSX.

Probe (`phoneui.mjs`) asserts REACHABILITY, not appearance — a screenshot looks fine
while a control sits 40px outside the viewport. It scrolls the rail to its end and
requires the last tool to be fully within the viewport, requires the panel on-screen and
wide, and measures the canvas's share of the screen (now 70%). Both themes, real iPhone
13 viewport.

**Still open on phone:** the vertical "‹ INSPECTOR" rail eats a strip of the canvas edge
and is the least Apple-like thing left in the shell; folding it into the bottom sheet or
a floating control is the next move, and it needs a real decision about where Objects /
Adjust / Printability live on a phone rather than a CSS tweak.

## Build 417 — the Inspector gets a narrower ceiling; icon spacing reverted

Follow-up to 415's icon change, and a correction to it. Clustering the icons left DID
close the gaps, but in a panel dragged out to the old 520px maximum it just moved the
imbalance: seven icons huddled in one corner of a wide empty header. Jerry called it,
and was right about where the fix belonged.

The cause was never the icons — it was the dock being allowed to grow to 520px, at which
width the panel stops reading as a sidebar: the nav's gaps stretch with it and the
labelled rows sit in a field of empty space. So:

- `clampDockW` ceiling **520 → 390** (a quarter narrower). Floor stays 230, so it still
  drags narrower for anyone who wants the canvas back, and the double-click reset to 262
  is unchanged.
- `.dock-list.icons` reverted to `flex: 1 1 0` + `space-between` — the icons share the
  row again, which is right once the row itself is bounded.

A stored width above the new ceiling is clamped **on read** (`clampDockW` runs inside the
`useState` initialiser), so a dock left at 520 comes back at 390 rather than persisting a
size the layout no longer supports. That case is asserted directly.

Measured at the cap: 7 icons × 50px across a 364px row, 32px of slack around each glyph —
against 72px each at the old 520. Default 262px dock: 32px each, 14px slack.

## Build 416 — Auto goes first, and says what it costs

Reported: Auto sat fourth in the model picker, inside "Other providers", below three
entries that need a key pasted before they do anything — and it was the only row with
no cost at all.

Auto now has its own **Recommended** group at the very top. The OpenRouter entry was
removed from "Other providers" because it WAS that row (rendering as "Auto" whenever the
model is the auto sentinel); leaving both listed the same choice twice.

**What Auto's cost figure means, which took some thought.** Auto has no fixed model to
price — it deliberately spends little on small edits and more on hard ones — so a
single table figure would be fiction. The rule: once this device has ≥3 builds, the row
quotes the user's OWN average ("≈50 cr/build, your average"), which is the only honest
answer to "what does Auto cost me"; before that it quotes a mid-tier price marked
"typical", since that is where the router usually lands.

The inverse matters just as much and is asserted in the probe: **per-model rows must NOT
use the ledger.** The average is one number, so folding it into every row would print
the same figure beside Haiku and Fable and destroy the comparison the list exists for.
Those stay priced off the table alone (20 / 59 / 293 / 390 cr).

Copy kept short deliberately — the menu is ~240 px and the first draft truncated
mid-word, which cut the cost figure, the half that answers "can I afford this".

## Build 415 — text stops sinking into the model on reload

Reported: every refresh embedded placed text into the body, and the only cure was
selecting the layer and nudging it forward, which snapped it back.

**Root cause — a race, not a placement bug.** A text layer on a curved wall is stored
flat plus a `bend`, and `restoreTexts` re-fits it to the surface via
`viewer.conformAt()`. That needs the model's MESH, which on a reload does not exist yet:
the body is rebuilt from code in the OCCT worker, taking anywhere from ~250 ms to the
25 s watchdog. `conformAt` correctly returns false when `st.current.mesh` is absent
(Viewer.tsx) — and the old code answered that with exactly one retry at 400 ms, then
disposed the flat copy so no further attempt was possible. On any part bigger than
trivial the build outlasts 400 ms, both attempts fail, and the word stays
cylinder-bent at its stored pose — which intersects the real surface and reads as text
sunk into it. Nudging re-ran the conform against a mesh that existed by then, hence the
"move it forward and it snaps back" workaround.

Fixed with `conformWhenReady()`: poll every 250 ms until the mesh answers, bounded at
30 s (past the build watchdog, so a part that never builds cannot leak the flat copy).
Waiting on the kernel's own timescale rather than a guessed constant is the point — the
duration is the part's business.

**A second defect the fix exposed:** rendering is on-demand, and `conformAt` rewrote
vertices of geometry already on screen without requesting a frame. The single 400 ms
retry had masked it by essentially never succeeding. `conformAt` now calls
`invalidateRef.current(2)` on success.

**Also — Inspector icons were spread edge-to-edge.** `.dock-list.icons` used
`flex: 1 1 0` with `justify-content: space-between`, giving each of the seven an equal
share of *whatever* width the dock had — which is why it barely showed in a narrow
window and was glaring on the reported iPad screenshot. Now content-sized (32 px each,
2 px gaps = 236 px total) and left-aligned, so the row measures the same at any dock
width. Phone rule gained horizontal padding to keep 44 px targets now that width follows
content.

Verified with Playwright at two viewport widths — the point of the second is that the
old rule's output *changed* with width and the new one does not.

Two things the probes caught that reading alone would not have:
- A first pass at the icon CSS left a comment fragment outside its `/* */`, which
  silently ate the rules that followed. The measurement (items 236 px wide, stacked in
  seven rows) is what exposed it.
- Sizing to `padding: 8px` overflowed 236 px and wrapped a lone seventh icon onto its
  own row. `6px` fits all seven with room; `flex-wrap` stays only as a guard for a dock
  narrower than that.

**Probe note for whoever runs these next.** Two attempts failed for setup reasons, not
product ones, and both are worth knowing: Google Fonts is unreachable from the dev
sandbox (families sit on "loading…" forever), so `textrestore.mjs` serves a local TTF
under a Google family name via `page.route`; and an UPLOADED font is session-only by
design (`getFont` rejects a custom family after reload, fonts.ts), so a probe that
uploads one sees the layer legitimately vanish and learns nothing about conforming.

## Build 413 — the credits experience goes consumer-grade

**Direction decided by Jerry this session:** Moldable is being commercialized as
sign-up-and-build — end users will never fetch provider keys. The strategy review
("One Key or Many?", artifact) landed on OpenRouter as the spine; the BYOK research
fact (1M free BYOK req/month since Oct 2025) means his Claude/Gemini keys can ride
inside OpenRouter at no fee. **The remaining backend step, NOT started:** per-user
metering through the house relay (Supabase), so new users get credits without any key.
This build is the front half: the credits UX itself, rebuilt on the patterns Gamma /
Lovable / Chatbase / Krea converged on (Mobbin research, links in the artifact).

What shipped, all client-side:
- **The chip opens a Credits panel** (AnchoredMenu) instead of just refreshing: big
  friendly balance, a usage bar when the key has a cap, "= $X on your OpenRouter
  account · read N min ago", Refresh inside, top-up link out to openrouter.ai.
- **"What things cost", in the same unit as the balance** — the core of the Gamma
  pattern. CAD build row: the device's own ledger average once it has ≥3 builds
  (honest: includes routing/clarify overhead), else price-table × typical build tokens
  (`EST_BUILD_TOKENS`, 12k in / 1.5k out) marked ≈. Mesh row: the current engine's
  listed per-generation price from gen/registry. Plus "That's about N more builds" —
  the runway number, the single most useful line in the panel.
- **Picker rows speak credits too** (Chatbase pattern): Claude model rows and the
  active OpenRouter row show `≈N cr/build` from ONE estimating path (`estBuildCredits`),
  so the picker can never disagree with the panel. The hand-written "~10¢ per part"
  hints in anthropic.ts labels were deleted — they'd drifted from the price table and
  gave the picker a second currency.

Reviewed and deployed to `main` at Jerry's go.

**Not done / next — the commercial backend.** Users must never fetch a provider key, so
the OpenRouter key stops living in `localStorage` (correct for BYOK, impossible for
sign-up-and-build) and becomes a server secret. `src/llm/house.ts` already scaffolds
exactly this and is switched off (`HOUSE_RELAY_URL = ""`). The build is: a credits table
keyed by Supabase user, a relay that verifies the caller's JWT → checks credits → calls
OpenRouter → decrements, and the panel's data source swapped from OpenRouter's balance
to that table. The UI shipped here is deliberately shaped so only the source changes.

Open decision for Jerry: Supabase Edge Function vs the existing Cloudflare Worker in
`moldable-lite/proxy/`. Recommended the edge function — auth already lives there, so one
place can verify the JWT and touch the credits table with no cross-service auth invented.
Also advised, not yet done: a production Supabase project separate from
`prtpakaxzdmrehpndimy` (which holds dev data), a business domain/mailbox rather than the
personal Gmail, and a production OpenRouter key distinct from the dev key with a spend
limit set on it — that limit is what `limit_remaining` reads, so the chip doubles as the
abuse alarm.

## Build 412 — what's left in the tank, in a unit you can read

Jerry: show how much OpenRouter credit is left, and skin it as an app-level unit that
records real currency underneath, because the commercial formula will not be 1:1 later.

**`llm/credits.ts`** keeps the two ideas apart on purpose:
- BALANCE is real money read live from OpenRouter. Nothing invents it. `fetchBalance()`
  tries `/api/v1/credits` (the dashboard number: `total_credits - total_usage`) and falls
  back to `/api/v1/key` (`limit_remaining`, or `limit - usage`), parsing tolerantly across
  field spellings — a renamed field should degrade a readout, not break it. Cached in
  localStorage so the chip draws on the first frame, stamped with its age, re-read on
  mount and whenever a build settles (exactly when it moved).
- CREDITS is the app's unit: a pure display skin over USD, defined once in `PRICING`
  (`creditsPerUsd: 1000`, `markup: 1`, `unit`). 1 credit = $0.001, so a CAD build lands
  around 4 credits and $10 of balance reads as 10,000. **Commercialising = editing
  `PRICING`, not call sites** — markup, per-build floor, subscription grants are all
  arithmetic through `usdToCredits`/`creditsToUsd`. The ledger keeps recording true USD
  underneath either way, which is what makes the two reconcilable later.

**Where it shows.** A `BalanceChip` on the Model row (a balance you have to hunt for is
one you discover by hitting a wall), tap to re-read, real dollars + figure age in the
tooltip. Per-bubble cost switched from `$0.00421` to `4.2 cr` with the true dollars on
hover. Settings gained balance, spend-on-this-key, and "≈ builds left at your average" —
the number that answers "can I keep working today".

**Naming:** the unit is "credits", not "tokens", because bubbles already print `1,555 tok`
for raw LLM tokens and two different "tokens" on one line is a real trap. Renaming is one
line (`PRICING.unit`) if you'd rather.

**Two bugs the probe caught, both about honesty with money:** `fmtCredits` grouped
thousands only above 10,000, so `1750` and `20,500` appeared side by side; and a failed
network read fell through to the "no cap on this key" wording — claiming a fact about the
account from a call that never landed. Three states now render distinctly: a figure,
"no cap", and "—" (couldn't reach OpenRouter).

Verified with Playwright by ROUTING both OpenRouter endpoints locally (openrouter.ai is
unreachable from the dev sandbox): account-credits shape, per-key-limit shape with the
credits endpoint 404ing, low-balance styling, uncapped key, hard failure, no-key (chip
absent entirely), and a real build's cost rendering as credits with dollars on hover.

**Not verified here:** the live response shape. Egress to openrouter.ai is blocked from
this sandbox, so the parser was written defensively against both documented endpoints
rather than confirmed against the wire. First run on a real key is the check — if the
number disagrees with the OpenRouter dashboard, the fix is in `fetchBalance`'s `num()`
aliases.

## Build 411 — the model can read its own history

**Continue, then Build.** The clarify stepper's forward action is now `Continue` until the
last question, where it becomes `Build it` — one forward action per page, and the build
appears exactly when there is nothing left to answer. Answering still auto-advances (410).
"Build what I asked for" stays on every page as the skip-everything escape hatch.

**The build log.** The app has always recorded every change as a version with a human
summary; the model never saw any of it. It got the current CODE and the last few chat
bubbles — so it knew what the part *is*, not how it got there, and "the hole I asked for
earlier" pointed at nothing. `store/versions.ts` gained `buildLog()` / `formatBuildLog()`
/ `buildLogText()` (pure), and the CAD system prompt now carries a numbered log, oldest
first, with the live step marked `← ON SCREEN NOW`, undone-but-redoable steps marked, and
saved checkpoints marked. Window is 14 steps (`LOG_WINDOW`), ~200-300 tokens, rides the
SYSTEM prompt like `convo` does so it never compounds into `apiHistory`.

**A gap found while building it:** every AI edit recorded the same summary — `Updated the
model — 87 × 60 × 70 mm` — so ten edits in a row were indistinguishable. Direct tools were
always descriptive ("Added a ⌀3.4 mm screw hole"); the AI path, the one Jerry actually
uses, was not. `askSummary()` now appends the request that caused the change, so a step
reads `Updated the model — 87 × 60 × 70 mm · "add a screw hole in the back"`. That fixes
History for humans as much as it does the log for the model.

**"Put it back to before I added the screw hole."** New `llm/history.ts`, utility-brain
shaped (best-effort, null → normal build). Two gates, because a false positive throws away
work: a regex about *movement through time* (not about parts — "remove the screw hole"
misses entirely, so ordinary edits never pay for the call), then a model told plainly that
`none` is the safe answer. It runs in `sendInner` ahead of plan mode and clarify, reads the
SAME formatted log the CAD prompt gets, and answers with a step number the app maps back to
a real version id — the model never handles ids. Execution is the existing `restoreTo()`,
the one the History panel's rows already call. No second restore path.

`restoreTo()` now returns `"ok" | "busy" | "same" | "failed"` and takes `{ quiet }`. That
came out of the recon pass: the first cut posted "Restored …" *before* awaiting the
restore, so a refused restore (mid-build) or a mesh version whose glb never reached this
device would have left a success message next to a failure. Restore first, report second.

Verified end-to-end with Playwright (`history.mjs`, `clarifystep.mjs`): the log reaches the
real request body with the ON SCREEN NOW marker and per-step asks; "make the screw hole
bigger" never even calls the resolver; "put it back to before I added the screw hole"
issues NO code-generation request, lands HEAD on a `Restored "…"` version that is *not* the
screw-hole step, and leaves every later step in History. Read out of IndexedDB, not off the
screen.

## Build 410 — questions one at a time, a size you can see, a placeholder that fits

Three from Jerry's report (iPad screenshot with the composer circled in red):

**Composer text cut off.** History: the empty box was pinned one line tall in an earlier
build because the wrapped placeholder ballooned it — which turned the balloon into a
clip (placeholder wrapped to a second line and got cut mid-word). CSS cannot fix this
one: engines ignore `text-overflow` on a textarea's `::placeholder` (verified — computed
style said ellipsis, the render showed a hard clip). So the STRING is fitted instead:
`fitPlaceholder()` measures the box (canvas `measureText`, live via ResizeObserver) and
trims to what fits with a real "…". `::placeholder { white-space: nowrap }` stays as the
belt so the first paint can't wrap either. Typed text still auto-grows to ~5 lines —
regression-checked.

**The clarify card is now a one-question-at-a-time stepper** (the Typeform rhythm Jerry
asked for): "Quick check · 1 of 2" counter, ONE question in display type, full-width
option rows (iPad thumbs), picking an option answers it and turns the page itself after
450 ms; arrows and dots navigate back and forth without losing changed answers. The
non-negotiable kept: every recommendation arrives pre-selected and **Build it** sits on
every page — the questions remain a review, never a form blocking the build. The frozen
card is now a Q→A record (ask in small muted, answer under it), not a replayed form
with disabled buttons. Enter in the free-text field advances.

**The plan card draws its size.** `PlanSizeSketch`: the envelope as a proportional
isometric box, each number on its edge, and a dashed bank-card footprint (85.6 × 54) on
the same floor for scale — shown when the part is 15-400 mm, where the comparison still
reads. Pure SVG, `currentColor` + tokens so it sits in both themes; `aria-hidden`
because the exact figures stay in the text line above it.

Verified with Playwright in both themes (probes `clarifystep.mjs`, `planparams.mjs`):
pre-filled recs, pick→auto-advance, back/dots keep answers, the changed answers (and
not the un-picked rec) read off the actual build request on the wire, done-state recap,
placeholder fitted with a real ellipsis at 300 px chat width, sketch faces/labels/ghost.

Standing directive noted from the same message: keep looking for places where an
interactive or visual element beats prose — the size sketch and stepper are the first
two, not the last.

## Build 409 — the plan card gets a Parameters section

The last open item from Jerry's big report: "I want to make sure that I can adjust
parameters, and if I want to tell the chat to add a parameter... I want the chat to
also have a very nice UI when planning." Build 407 already made "add a parameter for
X" land in `defaultParams` reliably — but the Plan card (title/summary/steps/
assumptions/print notes) never surfaced parameters at all, so there was nothing to
see or edit until AFTER the model built.

`BuildPlan` gained `parameters?: { name, value }[]` (`src/llm/plan.ts`): the planner
LLM now lists 0-8 numeric dimensions worth leaving adjustable — main sizes, wall
thickness, hole/peg sizes — each a plain label ("Wall thickness") plus its mm value.
`planToPrompt()` folds them back in as an explicit instruction to put those exact
values in `defaultParams` under a clear camelCase key.

The card (`PlanCard` in Workspace.tsx) shows them under "Adjustable after building":
plain read-only rows normally, name+value inputs while the plan is being edited, plus
a `+ Add parameter` control and a per-row remove — so adding a parameter is a row you
type into before anything is built, not a sentence hoping the model notices. New
`.plan-param-*` CSS matches the existing `.plan-*` design language (same tokens as the
Adjust panel's `.pnum`/`.punit`).

Verified end-to-end with Playwright against the stub plan response: edited a stub
value, added a row, removed another, built, and read the actual build request off the
wire to confirm the edited/added values (and not the removed one) reached the prompt —
in both themes.

**Also already done, verified against actual repo state before starting this work**
(the model-name-under-bubble and OpenRouter-naming asks from the same report): both
existed already — `.msg-model` under every assistant bubble at 11px vs the timestamp's
10px, and `effLlm.model` resolved to the concrete picked model (never the literal
`"auto"`) before that label is set. Nothing to build there.

## Build 408 — Templates/Library actually float now

The topbar comment already said it: "Templates / Library are navigation, so they are
text with an underline that grows on hover — no box." The CSS underneath it never
matched — `.navlink` had a full `background`/`border`/`border-radius` box, and the
`::after` underline it was supposed to use was referenced only in a reduced-motion
media query, never defined. Three boxed buttons sat next to "+ New chat", so nothing
read as primary.

Fixed to match the comment: `.navlink` is transparent, borderless, no radius; the
underline is a `::after` transform (compositor-only, no layout shift) that grows on
hover. "+ New chat" is the only filled button left in the row. Verified via computed
style (background/border actually resolve transparent/0, not just visually) in both
themes, plus that the underline transform actually changes on hover.

## Build 407 — a real makeThread() helper, and why it isn't a real helix

Build 406 (below) added prompt RULES about threads but no HANDOFF entry — landed here
now. Jerry sent the actual failing screw's source and it was still ragged: rules alone
weren't enough because every model attempts a thread differently. So the app now owns
thread construction: `makeThread()`, injected into the `replicad` namespace generated
code receives (`src/worker/threads.ts`).

**What was tried first, measured, and abandoned:** a real single-lead helix —
`sketchHelix` + `sweepSketch` for the ridge, fused to a core cylinder. The sweep alone is
fast (~250 ms). The FUSE is not: booleaning a solid against a long, thin, highly-curved
sliver is a known-hard case for OCCT's boolean solver, and it hung past the 25 s build
watchdog on every test — including a trivial 3 mm, 4-turn stud, isolated by calling
`ReplicadEngine` directly (bypassing the whole chat/UI) to separate "is the geometry
right" from "is the app slow." It isn't a tuning problem; this construction hangs in this
kernel, full stop, and a model that never finishes building is worse than one with
straight grooves. (An earlier attempt also had the sweep profile's local axes backwards —
`sweepSketch`'s plane puts local X radial and local Y along the path, not the intuitive
reverse — which independently produced overlapping, non-watertight geometry. Root-caused
by reading the plane math out of replicad's own source, not by guessing again.)

**What shipped:** one closed 2D profile — root radius / ramp / flat crest (never a knife
edge) / ramp, repeated once per pitch, bounded by the axis — revolved 360° in a single
op. No boolean, so it can't hang; the axis bound means it can't self-intersect either.
This is concentric ribs, not a spiral: an honest tradeoff, documented at length in the
file header and in the system prompt, because it changes what the AI should tell a user
who asked for something that "screws in." Measured: the exact report geometry (4.55 mm
OD, 0.7 mm pitch, 8.8 mm, 12.6 turns) builds in ~250 ms, watertight, clean concentric
rings on screen. A 30-rib M6 stud: 601 ms. The full report part (base + fillet + fused
thread): 818 ms.

Prompt updated to match: `makeThread({ diameter, pitch, length, depth? })` is now the
ONLY sanctioned way to build a thread, with an explicit instruction to tell the user when
their wording implies a functional screw ("screws onto a nut") that this is ribs, not a
lead — and that a heat-set insert into a plain hole is the real FDM answer for that.

Also this build: the OpenRouter auto-router label no longer leaks its internal sentinel
("OpenRouter · auto" → "Auto"); reinforced in the prompt that "add a parameter for X" /
"make X adjustable" means promoting it into `defaultParams`, not describing the change in
prose.

**Declined, with reasoning:** Jerry asked for "the batch OpenRouter supports, like you
mentioned with uploading multiple images." That's a misreading of build 406's fix — the
`:batch` suffix excluded there is a broken *synchronous* model variant, not a feature.
OpenRouter's actual Batch API is bulk-asynchronous (submit now, results in minutes to
24h) — fundamentally incompatible with "type a prompt, see a live preview," the whole
shape of this app. Not built; explained instead of silently ignored or wrongly built.

**Not done this build:** a redesigned "nice UI" for the Plan flow — open-ended design
work, not a fix. Flagged rather than rushed.

## Build 406 — clean-solid rules for the CAD prompt (no HANDOFF entry at the time)

The ragged threads in the report were in the generated code, not the renderer. The stud
was built with `.extrude(len, { twistAngle: 4525° })` — 12.6 turns lofted as ONE ruled
surface, self-intersecting into stacked lamellae — and a tooth profile whose apex sat
exactly on the major radius, a zero-width knife edge. Six rules landed in the system
prompt: never `twistAngle` for a thread, flat crests/roots, a printable pitch/depth
floor, never fuse on exactly coincident faces, fillet stud roots, prefer one construction
to a stack of small booleans. Superseded by build 407's `makeThread()`, which replaces
"tell the AI how" with "the app builds it."

## Build 404 — undo 403's tessellation overreach

Reported straight after 403: the model stopped loading on refresh. Mine. 403 floored the
chord tolerance at 0.006 mm and scaled it at 0.0004 × the diagonal, so a 25 mm threaded
stud asked for 0.01 mm chords on a helical sweep — a mesh big enough that the 25 s build
watchdog killed it, which presents as an empty canvas.

Density was never that part's problem: the screw in the report was already ~100k
triangles at the OLD settings, so a finer chord bought nothing and cost everything.

Now: angular tolerance 0.15 rad (~42 segments around a circle, against 21 before — the
change that actually makes curves look round), chord tolerance 0.02–0.08 mm scaled to the
part, and shapes with more than 300 faces fall back to the pre-403 settings entirely. A
model that will not load is worse than one with visible facets. Same part: 2892 (before
403) → 6940 (403, too heavy) → 4396 triangles, 4.1 s.

Open question this leaves: if the screw STILL doesn't load on 404, the cause is not the
mesher and the next place to look is the rebuild path itself.

## Build 403 — three reports: the 404, the missing photos, the faceting

**OpenRouter 404 "only available through the Batch API".** The auto-router was choosing
`anthropic/claude-sonnet-5:batch`. `:batch` is half price, which is exactly why the
cheapest-of-the-family tiebreak in `recommendedForApp` kept picking it — and every
request then died, because that variant is only reachable from the Batch endpoint. Half
price is no price when the call 404s. `NOT_INTERACTIVE` excludes `:batch`; `:free`,
`:nitro`, `:floor`, `:online`, `:thinking` and `:extended` all serve normal requests and
stay.

**Chat photos didn't reach another machine — two causes.** (1) `ChatTurn` had `image`
only, so the nine EXTRA reference photos on a message were never persisted at all, on any
device. (2) The one that was saved was the full 1568 px attached photo as a data URL,
hundreds of kilobytes, and `sanitizeProject`'s 64 KB per-image budget then dropped it
from the synced row — so it showed only on the machine it was attached from. Now
`chatThumb` makes a 420 px webp for the transcript (which is all the bubble and lightbox
ever needed), `images[]` is persisted/restored/synced, and the budget admits them.

**Faceting.** Display tessellation was `angularTolerance: 0.3` rad — about 21 segments
around a full circle, which reads as a faceted barrel and as steps across a thread flank.
Now 0.12 rad (~52 segments, where desktop CAD viewers sit) with a chord tolerance that
scales with the part instead of a fixed 0.05 mm, so small features stop being the ones
that suffer most. Measured on the same part: 2892 → 6940 triangles, 4.9 s → 5.3 s.
STL export tightened to 0.008 mm so what slices matches what was on screen.

Caveat: a finer mesh means a different triangle count, so face paint stored against the
old count is discarded on rebuild (it already degrades that way by design).

NOT done yet, and asked for: engineering rules in the system prompt (the repo's `cad`,
`shape`, `step-parts` skills are the source), and the full audit. The thread artifacts in
the report can't be diagnosed from a screenshot — they need the generated code for that
version.

## Build 401 — pictures by address, not just by file

"Copy image address" is how most people hand over a picture they found, and it used to
paste a wall of URL into the prompt. Now a pasted address is fetched, resized and
attached like any photo, with its thumbnail in the composer and in the sent message.

Deliberately narrow on PASTE: only an address that says it is a picture in its own
extension (or a `data:`/`blob:` URL) is taken, because a link somebody meant as text has
to land as text. A DROP is not ambiguous — you dragged a picture — so that path accepts
any address and lets the fetch decide. It also reads the `<img src>` a browser puts on
the clipboard when you copy an image off a page, which on Safari is often the ONLY thing
there: no bitmap, no file.

The bytes are fetched rather than the URL handed to the model — a link works only on
providers that accept URL images and only while the page it came from stays up, whereas
the bytes give the same thumbnail, the same resize and the same behaviour everywhere.
Falls back to the relay when the host blocks cross-site reads (most image CDNs do), and
says so plainly when it can't. `sniffImageType` reads the format out of the bytes, since
a CDN serving pictures as `application/octet-stream` would otherwise be thrown away by
the MIME check the rest of the attach path does.

Probe: `imgurl.mjs` — paste, second paste, a page link left alone, copy-from-page HTML,
a mislabelled CDN, a dragged image, a blocked host, and the thumbnails in the bubble.

## Build 400 — 3MF import: the models you already have

The importer took `glb gltf stl step stp shapr` — everything except the format
MakerWorld, Printables, Bambu Studio and Orca actually hand you. A downloaded model
simply could not be opened.

`src/gen/load3mf.ts` reads the zip's model XML: declared units (micron through foot —
Bambu exports micron, and getting it wrong is a model a thousand times too big), the
`<build>` items rather than the resource list (a resource nothing references is a spare
part, not something on the plate), nested `<components>` assemblies with a depth cap,
and the 4×3 row-major transform **transposed correctly** — the classic 3MF bug is that
single-object files look fine and every assembly comes out scrambled.

**It imports as an editable solid, not a frozen mesh.** 3MF is triangles, so it takes the
STL road into OCCT via `geometryToStl` and comes out a faceted B-rep — which is the
difference between looking at a MakerWorld model and telling the AI to put two M4 holes
in it. Anything the kernel can't solidify (a plate of several disjoint bodies, say) falls
back to the mesh pipeline with a note, exactly as STL already did.

`loadAnyMesh` sniffs 3MF by content as well as by name, because the blob stored with a
project has no filename by the time it is re-read.

Verified with hand-built fixtures — mm/inch/micron units, a component transform, a
3-item plate, reload — plus a round-trip through the app's own `write3MF`, which is the
closest thing to a real Bambu file available offline (components wrapper, basematerials,
per-part config). The mm box comes back Watertight: Yes.

## Build 399 — the other computer stops showing the old model

Reported: a second machine keeps rendering a stale version of a project no matter how
many times it is refreshed. Three separate causes, all reproduced before being touched.

**1. An open project was pinned to its old HEAD, on purpose.** `onRemoteProjects` merged
an incoming sync with `keepHead: true` so a half-finished edit couldn't be yanked away —
but a device that is merely SHOWING a project has no edit to protect. It sat on the
superseded version while History filled with steps it refused to display, and
republished that stale head on its next push. HEAD is now held only while a build is
actually running; otherwise the project catches up, re-renders and says so.
Measured two real devices against a mocked account: device 2 stayed at 70 mm while
device 1 was at 82.5 mm, refresh after refresh. Now it follows within one sync cycle.

**2. Mesh blobs were fetched by "do I have anything", not "do I have THIS".** For
generative and imported projects, `reconcileRemote` only downloaded the bucket mesh when
the device had no geometry at all — so a device holding an older mesh never got the new
one, and re-advertised the stale hash. Now it compares the account's hash against this
device's marker, and only when the merge actually moved HEAD (so unpushed local bytes,
which HEAD already prefers, are never clobbered).

**3. Two refreshes to pick up a deploy.** The service worker precaches the shell, so a
refresh after a deploy paints the OLD bundle while the new worker installs behind it.
`controllerchange` now reloads once (guarded on there having been a controller, so a
first visit doesn't bounce), plus an update check on tab focus and hourly.

**Save this version** (History panel): name what's on screen and it becomes a checkpoint
— exempt from the 60-step trim, marked in the list, and pushed to the account
immediately rather than on the autosave debounce. It is an APPEND, which is the whole
trick: merge picks HEAD by the version's own createdAt, so a fresh checkpoint wins on
every device without any of them being told which copy is right. Restoring one appends
too, so a restore also lands everywhere.

Fixed while in there: `restoreVersion` dropped `texts`, `logos`, `surfFx` and
`partColors`, so restoring a version came back as the right solid with its text, logos,
surface treatment and colours stripped off — a state that had never existed.

Known stale probe: `sync-check.mjs` scenarios B–D still click a retired "Skip" button
and can't run; scenario A passes. `stalehead.mjs` covers the two-device case directly.

## Build 398 — ten reference photos, and only one album in flight

Asked for: attach up to 10 pictures, with a size limit, so the routed model has the best
context to build from. Was 6 (one front plus five extras).

**Ten now** (`MAX_PHOTOS` in `lib/downscale.ts`) — front photo plus nine. What doesn't
fit says so instead of vanishing, and a file over 30 MB (`MAX_UPLOAD_BYTES`) is refused
by name before it's decoded, which is what used to kill an iPad tab.

**The set is budgeted, not each picture.** `fitPhotoBudget` holds the whole payload
under 9 MB by re-encoding the SET — JPEG at full resolution first, then 1280 / 1024 /
768 — so nothing is ever dropped to make room and no photo ends up mush among nine sharp
ones. Camera photos never reach it (ten are ~4 MB after the attach-time resize); PNG
screenshots do, and forty megabytes of them now leaves as 7.1 MB with all ten intact.

**Found while measuring: every turn re-uploaded every earlier photo.** `apiHistory` kept
the image parts, so a ten-photo ask cost ten more images on the next message, twenty on
the one after — billed as fresh input each time — until the body was refused.
`keepNewestPhotos` carries one live set (this turn's, or the last that had any) and
reduces older sets to a line saying they were there. Measured: turn two was 20 pictures,
now 10.

Also: paste takes every image on the clipboard, not just the first; the extras render as
a thumbnail strip with a per-photo X, so one bad shot no longer means clearing all ten.

## Build 397 — a reload stops greeting you with an old error

Reported: "Couldn't rebuild that text: Nothing to build — type some text first" on every
page reload. Two separate faults behind it, both reproduced with Playwright first.

**The banner replayed history.** Chat is saved with the project including `error` turns,
and `openProjectById` restored them as ordinary messages, so `CanvasToast` — which shows
the newest error — announced a months-old failure as a live one on every load, forever.
Proved with a *different* error (a bad font file), so this was never text-specific.
Restored turns now carry `replayed: true` (a session-only flag, never written back to
the store) and the toast ignores them. Live failures still raise the banner, verified.

**And the error should not have existed.** Clearing the words field to retype a placed
word is the middle of typing, not a failure — `editText` rebuilt on "" and threw. It now
keeps the layer's name and glyphs, skips the rebuild, records no History step, and bumps
the generation counter so a slow font can't drop a stale word back on the model.

Found while verifying: **you could not place a second word.** The Text panel's Done
cleared `editId` but left the word selected on the canvas, and the panel's edit target
follows the *selection* while the field shows the *tool's* spec — so the next thing typed
silently retitled the word just placed and the field snapped back. Done now clears the
selection too. `multitext.mjs` was failing all the way back to build 388 on this.

## Build 396 — filament slots you can predict (the "colours are inverted" report)

Reported: a white part with black text arrives in Bambu with the colours swapped.

**The file itself is right.** Measured by driving the real writer with a known white
holder + black word and reading the zip back: basematerials `[#FFFFFF, #000000]`,
`filament_colour` the same, the holder's mesh `pindex=0` and the word's `pindex=1`, and
the config giving the holder extruder 1 and the word extruder 2. Correct in the core-3MF
path AND the Bambu path.

**The swap happens in how the file is opened.** A 3MF can only say "this part uses
filament 2" — which colour that is belongs to the slicer. Open the file and its own
colours load into the AMS slots; IMPORT it into a project that already has filaments
(five of them, on a dual-nozzle H2C) and the numbers land on whatever is already loaded
there. Nothing in the file decides that, so the Export panel now SAYS what the numbers
mean: a Filaments list — slot number, swatch, and which parts use it — plus the one line
that matters, "use File → Open, not Import". Only shown when there are two or more
colours, since with one there is nothing to get wrong.

Two real defects found while checking, both introduced by 395's components change:

- **Part ids ran off the end.** `<part id>` in Bambu's config is the object's OWN 1-based
  volume number, and the writer was emitting the global 3MF object id. With a single
  solid the two coincided (1, 2, 3…) so it looked fine; a SECOND top-level solid produced
  `<part id="4">` inside an object with two volumes — out of range, and an out-of-range
  part is a volume with no extruder assignment. Now numbered per object; verified with
  two solids each carrying a layer: ids `[1,2,1,2]`, and all four colours land right.
- **The components wrapper carried the model's material.** It holds no triangles, so a
  `pid`/`pindex` there is an invitation for a reader to paint every component with the
  model's colour. Removed — each component mesh carries its own.

Not verifiable from here: Bambu's exact import-time remapping. The file is provably
self-consistent; if opening (rather than importing) still shows a swap, the next place to
look is `project_settings.config` — it declares only six keys, and a dual-nozzle machine
also expects a `filament_map`.

## Build 395 — the 3MF gives the slicer text it can actually print

Build 394 fixed how text LOOKS. This fixes what the slicer RECEIVES — the Bambu preview
showed "Dry Erase Markers" as scattered floating islands with a floating-regions warning
and supports demanded, which is not a rendering problem at all. Two causes, both real:

**1. The letters were exactly tangent to the wall.** `conformToSurface` drops each vertex
onto the surface and re-raises it by its own extrusion height, so the base landed at
penetration ZERO. Two solids touching along a zero-thickness contact give a slicer nothing
to fuse: at every layer the letter outline merely kissed the wall perimeter. Text now
sinks `BITE_MM` (0.25mm — two layer lines at 0.12) into whatever it stands on, taken out
of the depth so a letter still stands its full `depth` proud. Measured: penetration
0.000 → 0.227mm.

**2. Every layer was exported as its own free-standing 3MF object.** `collectPlateParts`
pushed each attachment into the parts list beside the model, so Bambu received the holder
plus three unrelated objects and dropped each word on the bed to be sliced alone — hence
"Magnetic_Pen_Holder (3) has floating regions". Layers standing on the model are now
written as **components of one object**: `Solid3MF.parts` carries them, the writer emits a
mesh `<object>` per layer plus a `<components>` wrapper, `<build>` references only the
wrapper, and `model_settings.config` lists each as a `normal_part` with its own extruder —
so a black word on a grey holder still prints in two colours. A layer deliberately sent to
a DIFFERENT plate stays its own object; that one really is a separate print.

Verified by exporting a real 3MF and reading the XML back: 3 objects, **1 build item**,
2 components under it, 2 `normal_part` entries in the config. Plate bounds now include
layer geometry. textwrap, textsink (0.25mm — the intended bite) and the reload path all
green.

Note for existing projects: placed text keeps its old geometry until it rebuilds. Retype
a character or nudge any setting on the layer and it regenerates with the bite.

## Build 394 — text curves are curves, in the app and in the slicer

Reported with side-by-side screenshots: letter bowls visibly polygonal in Bambu Studio
AND banded in Moldable. Two separate defects, measured on a placed "Dog" (Inter, curved
wall, conformed) before touching anything:

1. **Coarse geometry** — `curveSegments: 8` gives every outline curve eight chords
   whatever its length, and font tech decides the damage: an OTF (Inter) draws a whole
   bowl as one or two long cubics → visible polygons; a TTF's many short quadratics were
   fine. Measured: p95 wall facet step 22.7°, worst 59.8°. The slicer shows exactly this.
2. **Flat shading** — ExtrudeGeometry is non-indexed, so `computeVertexNormals()` bakes
   one normal per facet. 0% of shared wall positions agreed on a normal: lighting bands
   even where the geometry was fine.

Fixes in `text/geometry.ts`:
- `flattenShape` re-samples every outline curve BEFORE extruding, by two criteria (the
  stricter wins): arc length (`CHORD_MM` 0.3 — ~6µm deviation on a 2mm corner, an order
  under a layer line, and bigger letters automatically spend more vertices) and total
  turn (three-tangent estimate, ≤~12° per step, so a 0.5mm corner round doesn't become
  a knuckle). ExtrudeGeometry then gets line-only shapes — nothing resampled behind us.
- `smoothTextNormals` = `toCreasedNormals(g, 40°)`: walls shade as one continuous
  surface, real arrises (glyph corners, wall→bevel) stay crisp. In place — the geometry
  is always non-indexed. **bend.ts calls it after bending AND after conforming** — its
  old `computeVertexNormals()` calls would have re-flattened everything on placement.
- `bevelSegments` 2 → 3, so the rim profile reads round.

After: wall-normal agreement 0% → 95.1%; a 26mm letter close-up shows genuinely round
bowls. Triangles scale with physical size (6.1k at 12mm → 12.2k at 26mm for one word) —
the budget follows print scale instead of curve count. The remaining "worst step" in the
metric (~30°) is real glyph anatomy (bowl-to-stem joints), not tessellation — it stays,
as it should. textwrap (bend + flat-face + reload) and textsolid (watertight, manifold,
0 open edges after conform) both green.

Not covered: **logo layers** (`svg/extrude.ts`) share the fixed-`curveSegments` pattern
but extrude in SVG units and scale to mm afterwards, so a mm chord tolerance needs the
scale factor threaded in first. Same treatment, small refactor — follow-up.

## Build 393 — text rides with the part it is stuck to

Reported: rotate a model with text on it and only the model turns. Measured before
touching anything — a word placed on the +X wall of an 87 × 60 × 70 holder, then a 90°
turn about Z: the footprint went 87×60 → 60×87 and the word did not move by a single
millimetre. **61.55mm out of place**, hanging in mid-air beside a part that was no longer
under it.

Cause: a layer's pose is stored in WORLD space and was only ever rewritten by dragging
the layer itself (`attachPose`) or re-seating it. Every path that transforms the part —
`authorObjectOp` for both CAD and mesh, `rotateOntoPlate`'s mesh branch, `resizeModel`'s
mesh branch — rebuilt the geometry and left the attachments exactly where they were.
Nothing about a decal is independent of the surface it is stuck to.

`commitMatrix(commit)` now yields the world matrix a transform applies (the mesh branch
already built one inline; it is shared rather than duplicated), and `carryLayers(m)` puts
every layer's pose through the same matrix. The Viewer's meshes are moved in the same
breath, via a new `carryAttachments` handle, because `textsForSnap` reads the LIVE mesh
pose — a layer whose state had moved but whose mesh had not would have been recorded
where it used to be.

Verified: after a 90° turn the word lands 0.00mm from where it belongs and its
orientation turns with it; Undo brings model and word back together (0.00mm); scaling the
part ×1.51 carries the word 22.6mm along with it. The undo/redo suite still passes.

Known limit: a rigid turn keeps the conform correct because the wall shape is unchanged,
but SCALING changes the wall's curvature and the text solid keeps the bend it was built
with. It follows the part and stays attached; on a heavily scaled curved wall it may want
a re-seat. Re-conforming on scale is the follow-up.

## Build 392 — what the selection can do, on the stage

Shapr3D's adaptive menu, the biggest single item on the research list. You tap a face on
the left of the model and the answer to "what now" used to appear in the Inspector on the
far right — on an iPad, a different half of the screen. `SelectionActions` now floats the
verbs that actually apply, bottom-centre of the canvas:

- a **face** → Rest on plate · Push/Pull · Round
- an **edge or corner** → Round · Angle
- **placed layers** → Duplicate · Remove (for however many are selected)
- always → **More…**, which opens the Inspector's Selection panel

Nothing here is a second implementation — every button calls the same controller the
Inspector does. Bottom-centre rather than pinned to the picked point on purpose: a bar
that chases the selection lands under the cursor, off the edge, or behind the Inspector
depending on where you tapped, and on a tablet it would sit under your own hand. The view
snaps, plate bar and showcase bar step up 54px while it is showing; it hides in focus
mode.

Note on reach: face/edge/corner picking is armed by the **Modify** tool, so the geometry
half of this bar appears while picking is on. The layer half (Duplicate/Remove) appears
whenever a layer is selected, which is the common case.

**Dropped from the list: the rail dial** (Nomad's permanent tool sliders). Built, then
removed before shipping — the premise does not hold here. Nomad keeps a slider beside the
rail because you can dismiss a tool's panel and keep the tool armed; in Moldable the rail
button IS the arm/disarm, so closing the Text flyout puts the tool down and a docked size
control would only duplicate the flyout's own Size field while it is open. Worth doing
properly one day, but it needs "dismiss the panel, keep the tool" first — a change to what
a rail button means, not a control to bolt on.

Still outstanding from the seven: Pencil-draws/finger-orbits (`pointerType` routing), and
editable History steps.

## Build 391 — borrowed from Shapr3D, Nomad and Spline (1 of 2)

From the design research (artifact: "what to borrow from Shapr3D, Nomad Sculpt and
Spline"). The three apps share seven reflexes; these are the three cheapest of them.

**Two fingers undo, three redo.** Procreate taught this to every iPad artist and Nomad
Sculpt kept it, so it is reached for before any button is looked for. The whole
difficulty is telling a TAP from the orbit and pinch that own the same two fingers:
the detector tracks how far the midpoint travels AND how much the fingers spread, and
either one disqualifies it (a pinch barely moves its midpoint — without the spread check
zooming counted as an undo). 260ms, 14px. Lives on the canvas element, `passive: true`,
so OrbitControls is untouched.

**Focus mode.** One tap clears every panel and the model has the screen — Spline hides
its UI on a keystroke, Shapr3D ships an Immersive View. The editing overlays live in the
SCENE, not the DOM, so hiding panels isn't enough: the `bare` prop also drops the
transform gizmo, the selection box, the hover highlights and the corner axes. They are
hidden for the frame and put straight back, because the gizmo's visibility is owned by
half a dozen interaction paths and a mode that permanently switched it off would leave it
off. Escape exits; one dimmed chip stays on screen for a finger that has no Escape key.

**Handedness.** Settings → Workspace → "Tools on the". A left rail is a RIGHT-hander's
assumption — with a Pencil in your left hand your wrist covers the tools you are reaching
for. `data-hand="left"` flips the rail, its flyouts, the Inspector, the dock rail, the
stats card, the zoom cluster, the pin and split panels and the toast. The model, camera
and chat column stay put: a change of reach, not a different app.

Verified at 1180×820 with real CDP touch events: undo/redo fire, a two-finger DRAG and a
slow press-and-hold do not, focus mode clears six bands of chrome and grows the stage
542k→968k px², Escape restores, and the rail/Inspector/zoom all cross the canvas midline
when handedness flips. Probe note: fan the synthetic touch points OUT from centre and the
third one lands on the Inspector card, where the canvas never sees it — which reads
exactly like "three fingers do nothing".

Still to come from that list: the contextual action bar at the selection, the armed
tool's parameter pinned to the rail, Pencil-draws/finger-orbits, and editable History
steps.

## Build 390 — a merge never deletes a version (the data loss)

Reported, and real: a project opened on a second device came back as a much older model
and the day's work was gone. Three things in combination.

1. A project lived in three storage containers — Safari, the home-screen web app (iOS
   gives an installed web app its OWN IndexedDB, separate from the browser's), and a
   desktop browser. So an old copy existed without anyone doing anything wrong.
2. `reconcileRemote` merged whole projects by `updatedAt`, last writer wins: the copy
   with the newer stamp REPLACED the other, version list and all. And the chat autosave
   rewrites a project every few seconds with a fresh `updatedAt` whether or not anything
   was edited — so a stale copy left open makes itself "newest" by sitting there.
3. `appendVersion` drops everything after HEAD (correct for undo-then-edit). Once a stale
   HEAD landed, the next edit destroyed the newer history permanently.

Plus a fourth: `persist()` blind-wrote the in-memory project over whatever was on disk,
so even a correct pull was immediately paved over by the stale tab; `onRemoteProjects`
only showed a notice and left the stale copy authoritative.

**The rule is now: a merge never deletes a version.** New `store/merge.ts` unions the two
version lists by id, decides HEAD by which VERSION is newer (not which device wrote most
recently — that is the line that defuses the autosave), and makes the live fields mirror
that head. Worst case after a wrong guess is a longer History panel; every snapshot is
still there to jump back to.

Wired in three places so no caller has to remember:
- `putProject` merges whenever the stored record was last written by anyone but this
  running instance (a per-load `INSTANCE` id; sync writes stamp `CLOUD_WRITER`, which is
  never a live instance). It now RETURNS what it stored — without that the rescue lasted
  one save, because the caller still held its pre-merge copy.
- Every autosave path adopts that return via `adoptStored`.
- `onRemoteProjects` folds a sibling device's steps into the OPEN project with
  `keepHead: true` — history arrives, a half-finished edit is not yanked away.

Verified two ways. `mergeguard.mjs` drives the real store modules off the dev server: a
stale 3-step copy carrying a NEWER `updatedAt` saved over a 5-step one leaves 5 on disk
with HEAD still the newest, and the next save keeps it. `syncloss.mjs` runs the whole
thing end to end through the real sync code against a scripted Supabase, two containers,
and reproduces the exact report — before the fix B's push deleted A's text steps
everywhere; now both converge on all 5 with the same HEAD.

Still open: `MAX_VERSIONS` is 60 and trims from the old end, so a long session of small
ops can still push early steps off. Union merges make hitting that cap more likely, not
less. Projects have no export/restore of their own either — `lib/backup.ts` is settings
and keys only.

## Build 389 — zoom goes where you point

`OrbitControls.zoomToCursor` defaults to `false` and had never been set, so every wheel
notch dollied along the camera→target axis: whatever you had put the cursor on slid away
as you closed in, and the gesture turned into zoom-then-pan-then-zoom. Reported from an
iPad Pro with the Magic Keyboard trackpad — "it doesn't zoom into the canvas where the
cursor is, I have to use my hands" — because reaching up to pinch the glass was the
faster way to get to a spot. One line: `controls.zoomToCursor = true`.

Measured, since "feels right" is not evidence: raycast the world point under an
off-centre pixel, zoom 305mm → 183mm, raycast the same pixel. Drift **0.00mm** — three
dollies the camera along the pointer ray, so the point stays exactly put. It also covers
the touchscreen: a two-finger pinch now zooms about the centre of the pinch (the touch
path sets the same cursor parameters).

The failure mode this introduces is zooming with the pointer over empty sky, which drags
the orbit target off the part. Checked: 25 notches into the background moves the target
51mm and flies past the part, orbiting from there still behaves, and Frame (`f`) puts
both the part and the target back. Bounded, recoverable, left alone.

Probe note: a first measurement read 39mm of drift and was wrong — the render loop is
demand-driven, so a raycast taken while the camera is still damping (or after it has
stopped drawing) uses a `matrixWorld` from a pose that no longer exists. Poll until the
camera stops, then `updateMatrixWorld(true)` before raycasting. `zoom-check.mjs` in the
scratchpad is stale — it clicks a "Skip" button from a retired onboarding flow and
asserts the zoom cluster hugs the bottom-RIGHT, which it has not done for many builds.

## Build 388 — an iPad tier, upright and on its side

The app had a phone tier (≤760px) and a desktop tier, and every iPad fell between them.
Measured on six iPad viewports before any change: PORTRAIT landed in the ≤900 stack — two
rows of topbar (93px), a 42vh chat, and a 554px tool rail hanging in a 444px canvas with
its bottom tools clipped away — while LANDSCAPE landed in the desktop split, where a
1024×768 iPad put a 400px chat beside a 579px stage, the Inspector covered the whole
model, and the tool rail and zoom cluster were hidden outright. The stage held 42–54% of
the screen; it now holds 76–84% upright and 55–60% on its side.

**Upright, the model is the page.** The chat becomes the same bottom sheet the phone uses
— peek is the composer, one tap opens the transcript. The `.chat.sheet` rules moved OUT
of the `@media (max-width: 760px)` block and are keyed to the class, so `SHEET_Q` in
Workspace is the single place that decides where a sheet is right (phones, and tablets in
portrait up to 1080px). The cards still float: full-bleed is the phone's answer, and a
tablet has the room to keep the app's grammar.

**Rotating re-states the chat.** `chatOpen` is one flag meaning two things — a peeked
sheet is "one tap away", a closed column is "put away" — so carrying it across the
breakpoint got both directions wrong: sideways, a peeked sheet became a chat hidden
behind a rail; upright, an open column filled two thirds of the screen instead of
peeking. One effect now re-states it on every crossing.

**On its side, the chrome gives back its height.** Topbar 58 → 48, statusbar to one
scrolling row, and the chat column capped at `min(--chat-w, 33vw)` — the stored 400px was
39% of a 1024px screen, spent on a transcript. The zoom cluster steps one rail-width
right: both were pinned bottom-left and on a short stage the rail reached down into it
(measured 48×54 of overlap at 1180×820). Nothing shrank to fit — every touch target is
the size it was.

**The Inspector stops being a full-cover sheet on a tablet.** That behaviour lives in an
`@container (max-width: 640px)` block, and a viewer column measures narrow for two
different reasons: a phone screen, or a big chat beside a small stage. It is now also
gated on `@media (max-width: 900px)`, so a 1024×768 iPad keeps its tool rail (the block
hides the rail and zoom, because they draw over the sheet) and keeps the model visible
beside a 262px card. Where a narrow column and an open Inspector genuinely can't fit both
the head pill and the stats card (647px of stage less a 262px dock leaves 361, they want
412), the stats card yields — it is a readout, and Printability has the same numbers.

Also: `.launchpad` and `.crash` moved from `100vh` to `100dvh` — on iOS/iPadOS 100vh is
the height with the browser chrome retracted, so those pages were always taller than the
window they were in.

Verified with Playwright across mini/Air/Pro at both orientations, rotation in both
directions, and the tiers either side (a 880×700 window still stacks and its topbar is
still free to wrap; 1440×900 desktop unchanged). The phone shell was re-checked after the
sheet rules moved: 77% canvas at peek, horizontal rail, flyouts still open upward.

## Build 387 — edits reach the whole selection, and errors leave the transcript

**One edit, every selected word.** `TextFly` only ever patched `ctl.editId`, so selecting
three layers and changing the font changed one — which reads as the change failing at
random depending on which was last touched. It now patches every selected TEXT layer
(logos and parts in the selection are skipped, they have no spec), through a new
`editMany` that records ONE History step for the lot.

**Errors are a banner on the canvas, not chat messages.** `CanvasToast` shows the newest
failure at the bottom-left of the stage and dismisses itself after nine seconds or on a
tap; the transcript filters `error` messages out entirely. A failed operation is a status
about the model, and a run of them used to push the actual conversation off the screen.
The messages still exist in the chat data — they are simply not rendered there.

**The rail flyout fits an iPad.** It is anchored to its TOOL, and the Text tool sits
halfway down a tall rail, so on a tablet the Placed list ran off the bottom with no way
to reach it. On touch (or any window under 820px tall) the panel now pins to the RAIL
instead — a known 63px into the stage whatever tool opened it — and caps its height so
the list scrolls inside it. Two wrong turns on the way, both worth remembering: `100cqh`
needs `container-type: size` on the stage and silently does nothing without it, and
`position: fixed` bounds to the viewport, so the panel rode up over the topbar.

## Build 386 — the last two undo holes closed

**`commitTexts` was missing `logos` AND `partColors`.** The 385 edit meant to add them
matched the wrong function, so every version recorded for a TEXT change carried neither.
Two symptoms fell out of that one line: undoing a word erased your logos, and undoing a
recolour changed nothing — because the version undo lands on had no colours at all, and
"absent" correctly means "leave what's on screen alone".

**`editText` never conformed.** Placing, duplicating, moving and restoring all lay the
solid on the real wall; editing left it cylinder-bent. So the same word had two different
shapes depending on how you arrived at it, and redoing an edit landed on a solid that
didn't match the edit — which is what "redo doesn't come forward" actually was. It is the
fifth and last call site of `conformAt`.

`undoall.mjs` now drives retype, resize, wrap toggle, duplicate, recolour and remove, and
asserts change → undo → redo for each: 18/18.

## Build 385 — undo actually steps back one action

**Root cause, and the one that produced the report: a pose change was invisible to the
Viewer.** The attachment-sync effect only swapped GEOMETRY for a layer it already knew
(`Viewer.tsx:2696`), deliberately, so retyping a word wouldn't move it. But undo and redo
of a MOVE change nothing else — so the version was recorded correctly, restored
correctly, and the mesh then sat exactly where the user had dragged it because nothing
ever told it to go back. It now applies a pose that has CHANGED, in the parent's space,
skipped mid-drag.

**Second cause: one gesture, two History rows.** The Text panel's X called
`removeAttachment` (which records) and then recorded again. Two identical snapshots, so
the first Undo press was a visible no-op — the exact "it doesn't undo the last thing I
did" signature. Multi-delete and multi-duplicate had the same shape, one row per layer.
All three are one row per gesture now, via a `silent` flag on the per-item helpers.

**Third: edits streamed one version per keystroke.** Typing five characters was five
Undos. `commitTexts`/`commitLogos` take a burst key and coalesce with
`replaceHeadVersion` inside 2500 ms — the writer chosen at commit time, so an unrelated
version landing mid-burst is never overwritten. Patches that change nothing no longer
record at all.

**Also**: the Angle field wrote to the mesh and returned before committing, so a turn was
un-undoable AND got snapped back by the sync effect; `commitTexts` dropped `logos`
entirely, so editing a word erased your logos on undo; a duplicated layer that was
neither text nor logo recorded nothing; and colours are now carried on every version.

Found by a 15-agent audit of the mutation surface (map → adversarial refute → plan) plus
a runtime probe that drives place → duplicate → move and steps back through all three.

## Build 384 — letters sit on the wall, whatever shape the wall is

One cylinder radius, fitted from three rays, was never going to hold. It is right for a
bottle and wrong for a rounded box — a pen holder, a case — where the wall is flat
across the middle and curved only at the corners: over-bent on the flat part,
under-bent at the corner, and the middle letters sink into the body.

`conformToSurface` in `src/text/bend.ts` drops every vertex onto whatever is under it
and re-raises it by its own height in the extrusion, along the local normal at that
point. It assumes no shape, so it holds on any of them. Vertices whose ray misses the
body keep the cylindrical answer, so a word overhanging an edge degrades instead of
collapsing; under 50% hits it declines entirely and leaves the cylinder alone.

It is applied at four points, all BEFORE the geometry reaches React — `conformAt` takes
a geometry and a pose rather than a layer id, which was the first attempt and lost every
race against the Viewer's own geometry swap. Placing, duplicating, moving and restoring
all go through it. Restoring matters as much as the rest: a reload that brought the word
back cylinder-bent while the placed one was surface-fitted changed the shape under you
(caught by textwrap: 5.742 mm of bow becoming 7.029).

Measured on a rounded holder, deepest penetration of any vertex into the body:
placed 0.45 mm → 0, duplicate 1.4 mm → 0.

## Build 382 — Delete belongs to the app; duplicating carries everything

**Delete/Backspace was falling through to the browser.** Nothing in the app handled
it, so the key reached whatever the browser does with it — go back in some, close the
tab in others. A 3D app has to own that key. It now removes the selected layer(s) and
is `preventDefault`ed either way, so it never escapes even with nothing selected.

**Duplicate, three ways**: ⌘/Ctrl-D, a button on every row of the Objects panel, and
Alt-drag. The Alt-drag trick: TransformControls doesn't pass the event through, so the
modifier is tracked off the pointer/key stream, and the COPY is the one left standing
while the drag carries the original away — which means the gizmo never has to be
re-attached mid-drag and the result is what the gesture means everywhere else.

**A copy keeps its colour.** `partColors` is keyed by layer id, so the new id started
grey — a duplicate you have to re-paint is the retyping this was meant to save.
`duplicateLayer` handles any layer (word, logo, dropped shape); text still routes
through `duplicateText`, which also re-seats the copy on the wall where it lands.

## Build 381 — the "canvas zooms out on every commit" was a keyboard shortcut

Measured first: across three placements, at two zoom levels, with the Objects panel
open, the camera's position, target, fov, aspect, canvas size and the model's projected
pixel size were all byte-identical. Nothing zoomed. What DOES zoom is `f` — bound to
"frame the model", which fits the whole part in view. Committing a placement is a click
on the CANVAS, and the Viewer's pointerdown deliberately blurs any focused field (so
Cmd-Z means "undo my model edit" from then on) — so the next letter typed went to the
shortcut handler instead of into the word. Type "Front" and the view snaps out on the
f. Every other letter in v/n/t/g/m/b silently swapped tools, which is the same bug
wearing a quieter hat.

Two fixes: the single-key tool shortcuts don't fire while the Text tool is out (its
panel is a text field — letters belong to the word; Escape and the rail still put it
down), and placing a word puts the caret back in the words field on the next frame. The
next-frame part matters: React flushes effects at the end of the click handler and the
browser then finishes dispatching that same click, taking focus with it.

Transform stays lit beside Text after a placement, and that is honest rather than a
regression of the one-tool-at-a-time rule — `selectAttach` puts the new word's handles
up on purpose, so both statements are true at once.

## Build 380 — text you can actually edit, and the see-through-letter bug

**The see-through polygon in the "D" was a coincident copy, not a hole.** The text
solid measures watertight, manifold and consistently wound — 0 open edges, 0 flipped
faces. What was actually on screen was TWO copies of the word in the same place: merge
and engrave call `applyResult` (which snapshots the layer list) *before* their
`setAttachments` drops the layers they just consumed, so the version recorded the model
with the word baked in AND the word still standing on it. Any later rebuild put the
layer back on top of itself; the depth buffer resolves coincident faces at random,
which reads as slashes through the letters. `consumedLayers` marks them for the
snapshot. This arrived with the 378/379 layer-persistence work — it could not happen
before, because layers didn't come back at all.

**A moved word re-seats and re-wraps.** A gizmo drag is a straight translation, so a
word slid along a curved body kept the bend AND the tilt of the spot it was placed at
and walked off the surface — the two stray "Text" layers in the report. `seatAttachment`
in the Viewer finds the nearest point on the model (BVH `closestPointToPoint`, not a
ray: a dragged layer can end up beside or inside the body), re-orients to that face,
re-measures the wall radius and moves the mesh there; App rebuilds the solid at the new
bend. Measured: 3.26 mm off the surface before, 0.02 mm after.

**Wrap is a choice now.** `TextSpec.wrap` (default on) — "Follow the curve" in the
panel. On, the word bends to the wall and re-fits on every move; off, it stays a flat
plaque you can put anywhere. Toggling it rebuilds, and turning it back on goes and
measures the wall it is standing on.

**Editing stops offering to place.** While a placed layer is selected the tool no
longer paints a cursor ghost — a second word riding the cursor over the gizmo looked
like the app was about to drop one you hadn't asked for.

**Duplicate**, from the panel or any row in Placed: copies the spec a line and a half
down the face, then seats it, so a copy on a curved body wraps to ITS spot.

## Builds 379 — one lit tool, smooth ribs, text that wraps, layers that persist

**Rail: exactly one tool armed, ever.** Every rail button now routes through
`armRail()` in `Workspace.tsx` — one stand-down list in one place, instead of each
toggle carrying its own. Add Logo sat lit beside Note (and Transform beside Text)
because Mark/Pattern/Add Logo live in Workspace state while everything else lives in
App's `standDownTools()`, and neither side knew about the other. Both directions are
covered now: `armRail()` for rail clicks, plus an effect for the paths that arm a tool
without the rail (keyboard shortcuts, the Objects panel).

**Armed state is a FILL, not a ring.** It used to be a fixed-size hairline circle on a
`::before`, drawn over a rounded-*rectangle* button — an outline belonging to no shape
on screen. At 35/36 px it could not shrink with the button, so on the compact rail
(30 px rows) and on coarse pointers it ran past its own button into the pill wall and
its neighbour: "two half rings poking outside the clipping mask". A background cannot
overflow the box that paints it. The rail's buttons are round-ended in every state now.

**The two floating toolbars stopped touching**: 3 px → 10 px, and their left edges
line up (the head pill was inset 12 px against the rail's 10 px).

**Ribbed patterns look turned instead of gritty.** Two causes, both measured. (1) The
displaced mesh travelled as a triangle soup and the main thread derived normals from
it — flat-shading every one of a million facets. The worker now returns shading
normals with it, smoothing the surface while keeping the model's own hard edges: which
corners are creases is decided BEFORE displacement, on the smooth body, because a deep
flute turns the surface through 100° in a millimetre and any after-the-fact test reads
every crest as an edge. (2) Refinement was driven by edge LENGTH, which is isotropic —
and a rib is not, so the budget went on resolving the direction a flute doesn't vary
in. It is now driven by the displacement FIELD: sample both ends of an edge and its
middle, split only where the middle isn't where a straight line would put it.

**Text wraps curved bodies.** `src/text/bend.ts`: three rays fit the wall under the
word to a cylinder, and the solid is bent around it, so the ghost you hover with is the
shape that lands. Flat faces report an infinite radius and cost two rays. The radius
rides in `TextLayerSnap.bend`, so the wrap survives undo and reload.

**Logo layers persist**, the way text layers did in 378 — `LogoLayerSnap` stores the
OUTLINE (uploaded SVG, or the trace of a bitmap), never the mesh, so a reload rebuilds
the identical solid from a few kB. Placing, moving and removing one is a History step.
Outlines over 512 kB aren't stored (a traced photo isn't a logo) — that layer still
works for the session, it just doesn't come back.

**One type scale.** The stylesheet had eighteen font sizes, half of them half-pixel
siblings (11 beside 11.5, 12 beside 12.5, 13 beside 13.5). All of them now name one of
seven tokens (`--fs-micro` … `--fs-2xl`). The composer went up a step to 15 px and the
transcript matches it. `button, input, select, textarea { font: inherit }` — the
family was inherited but the SIZE wasn't, so every icon-only button sat at Chrome's
13.333 px default.

**Kernel warm-up is connection-aware** — the eager 11 MB OCCT compile is skipped on
Save-Data and 2g/3g, where speculatively spending it can be the whole session's data.
`ensureEngine()` still boots it the moment something needs it. (This replaces the
audit's precache recommendation, which was wrong: excluding the wasm from the service
worker would have kept the download and lost offline.)

## Builds 365–367 — durable edge anchors, one editing tool, faster picking

**The blocker that made fillets disposable is gone.** A `PointOp` used to carry one
absolute point. Any parameter that moved the geometry under it left the point in mid-air,
the rebuild threw, and `rescueOps` shed the op with "the spot it was picked on moved with
the new size". `PointOp` now also carries `rel` (that point as a fraction of the bounding
box when it was picked) and `dir` (the picked edge's unit direction). `anchorsFor()` in
`worker/cad.worker.ts` tries the exact point first, then the relative one at a tolerance
scaled to the part (3% of the bbox diagonal, floored at `PICK_TOL`). `dir` settles ties so
a rounding can't spread onto the perpendicular edges it meets at a corner. Verified: round
the top rim of a 60×40×24 bracket, change depth 40→50, the rounding is still there.

That durability is what made an editable list worth building. Roundings and bevels now
appear in the Modify panel with their sizes — retype one, remove one, or Reset all — and
the reset is an ordinary undoable step. Same machinery as the magnet pocket list
(`edgeOpList` / `editEdgeOp` / `removeEdgeOp` / `resetEdgeOps` in `App.tsx`).

**Select is gone; Modify absorbed it.** Two rail tools for one motion, plus a five-way
Auto/Face/Edge/Corner/Point row asking you to declare intent before hovering anything.
Now: hover picks whatever is under the cursor, click holds it, the operation is already on
the panel. `V` opens Modify; `1–3` choose the operation. Point (pin-a-note) became its own
rail entry, **Note**, key `N` — it was doing something quite different from the four
geometry pickers it sat beside.

Vocabulary: **Round → Rounded, Bevel → Angled**, each with a profile glyph showing the
corner it takes off (`IconEdgeRound` / `IconEdgeAngle`). The words named operations you had
to already know; the glyph is the difference itself.

**Shift-click multi-select** now takes faces, edges AND corners into one set that stays lit
until applied or cleared (`addPickToMultiSel` in `Viewer.tsx` merges each pick's highlight
into `multiHi`). The panel names what's in it and applies the armed op to all of them at
once, choosing per feature: a face extrudes under Push/Pull and rounds its boundary under
Rounded; an edge or corner rounds either way.

**Perf.** `three-mesh-bvh` was already a dependency and was never wired into picking:
240 raycasts over a 2,892-triangle part went 61.5 ms → 2.6 ms, identical hits. **The tree
MUST be built `indirect: true`** — the default reorders the geometry index, which silently
invalidates every replicad `faceGroup`, and B-rep face picking degrades into a spatial blob
(a flat top reports itself as curved and Push/Pull refuses it). The CAD worker also stopped
sending three copies of every mesh: it packs the tessellation into typed arrays and
transfers the buffers (`packFaces` + comlink `transfer`), and `facesToGeometry` wraps them
directly instead of going through `replicad-threejs-helper`'s `syncFaces` copy.

Also fixed here: `standDownTools` never reset the pick kind (Note's mode leaked into every
later tool); the multi-select dedup key was centre-only, so a face and the edge loop
bounding it collided; and `facesCtl.directOp`'s implementation took `(size)` while its
declared type was `(type, size)`.

**Text tool shipped (build 371).** Rail tool `Text` (key T, next to Add Logo) on the
`src/text/` pipeline: type words → pick a font (Google list, a .ttf/.otf/.woff2 file via
`registerFontBytes`, or device fonts via `queryLocalFonts` where the browser allows) →
the built solid rides the cursor as a ghost (`textPlace` prop in Viewer.tsx, same
pattern as `magnetPlace`) → click pins it ON the face (+Z along the normal). It lands as
an ATTACHMENT carrying its `TextSpec` (`attachments[].text` + `place`), so it shows in
Objects, moves with Transform, and stays editable forever — retyping words/font/sizes
swaps geometry under the same id without moving the mesh (the attachments effect in
Viewer.tsx handles same-id geometry swaps now). Like all attachments it is session-only:
not persisted, outside undo history. `buildTextGeometry` fix: ExtrudeGeometry bevels
BOTH z-ends, so depth now means TOTAL height. Sandbox note: Chromium can't reach
fonts.googleapis.com — the probe (`texttool.mjs`) node-fetches and `page.route`-serves it.

Also: **Move (Transform) now leads the rail** — first tool, the universal convention —
and `toggleMeasureTool`/`toggleTransformTool` were rewired through `standDownTools`
(each had a hand-rolled stand-down list that new tools kept slipping through).

**Pattern tool shipped (build 372).** Rail tool `Pattern`, a two-tab flyout built the
way Fasteners is: **Pattern** (scales · chevron · basket · studs · waffle · ripple —
decorative relief) and **Texture** (knurl · hex · noise · wave · voronoi · diamond ·
fuzzy — micro surface feel). Each tab owns its own slot and both can be live at once,
so a knurl grip runs under a scale pattern.

The big change is that it is **nondestructive**, where the old `applySurfaceTexture`
baked the displacement and turned a CAD model permanently into a mesh. The treatment is
now a spec — `surfFx: { pattern: SurfFxSlot | null; texture: SurfFxSlot | null }` in
App.tsx — and an effect re-displaces from the untouched `result.geometry` whenever the
base or a slot changes (texture first, pattern over it), caching the result in `fxCache`
and guarding races with `fxGen`. Clear both slots and the base geometry returns
identical; Adjust, the op chain and every CAD tool keep working underneath, and the fx
re-applies on top of each rebuild. Works on mesh models for free — it is pure triangles.
`prepareExport(format)` substitutes the treated mesh for every format except STEP (no
B-rep to give it; `fxStepCaveat()` says so in chat), and `restat()` re-runs printability
so the stats pill describes the surface you can actually see and export.

Three field functions were wrong and are fixed in `preview.worker.ts`: `patternAt` now
blends **all three planar projections** weighted by |n|⁴ instead of hard-switching on
the dominant normal axis — the switch tore the pattern apart along every edge of a part.
`chevron` was a sawtooth fed into a sawtooth (read as crumpled rock) and is now a smooth
ridge whose phase marches along v; `weave` gave each cell an isolated pad (a quilted
pillow) and now runs unbroken strands both ways with a checkerboard deciding which is on
top; `grid`'s clamped linear ramp creased into spikes and now uses a raised-cosine
shoulder; and `knurl`'s hard 0/1 checker (a jagged staircase no subdivision could
resolve) is now `|sin·sin|` — real diamond bumps with printable flanks.

Probe: `pattern.mjs`. `plook.mjs` shoots one image per pattern — worth re-running after
any change to `patternUV`, since none of these failures showed up as an error.

**Text orientation + free transform (build 373).** Two independent defects, both shipped
in 371 and both found by measuring rather than reading:

1. *The roll was never constrained.* `Viewer.tsx` posed text with
   `setFromUnitVectors(+Z, faceNormal)` — the shortest arc between two vectors, which
   pins +Z and lets the roll fall out of the arithmetic. On a box that put text upright
   on the −Y wall, 90° on its side on both ±X walls, and upside down on +Y; on a curved
   wall the roll just tracked the azimuth. Replaced with `faceDecalQuat(n, rollDeg)`,
   which builds an explicit basis: +Z = the face normal, +Y = world-up projected into
   the face plane (falling back to world +Y on a top/bottom face, which has no vertical
   of its own), +X = up × n so the basis stays right-handed and glyphs are never
   mirrored. Measured on all five reachable faces of a box and at four azimuths round a
   curved wall: letters-up·worldZ = 1 everywhere.
2. *The solid was inside-out.* `buildTextGeometry`'s `g.scale(1, -1, 1)` (opentype
   outlines are y-down) is a det = −1 reflection that reverses triangle winding, and the
   `computeVertexNormals()` after it baked inward normals into the whole solid — so a
   FrontSide material drew its interior shell. `svg/extrude.ts` does the same flip for
   logos and repairs it; the text path never did. `reverseWinding` moved to
   `src/three/winding.ts` and both callers share it. Front-cap normal went −1 → +1.

Also, from the same request: **Angle on the face** in the Text panel (a number plus
Turn 90°) spins the ghost before placing and the layer after — applied as a delta via
the new `ViewerHandle.rollAttachment`, so it composes with gizmo rotation instead of
snapping the layer back. `roll` lives on `TextSpec`, and the ghost-rebuild effect is
keyed on the spec minus roll so spinning never re-runs the font pipeline.
**Placing now selects the layer**, so the transform handles are on it immediately, and
`enterTransform`'s attach branch honours its `mode` argument — it hard-coded
`setMode("translate")`, so the rail's Scale button had done nothing to a text or logo
layer since the gizmo was written.

Probe: `textorient.mjs` (per-face det / winding / up-vector, plus the Angle field and
the gizmo), `tcup.mjs` (four azimuths on a curved wall).

**Ribbed patterns + adaptive refinement (build 374).** Six new patterns in the Pattern
tab, in their own labelled **Ribbed** group: Fluted, Reeded, Twisted, Pleated, Waved,
Ringed — the Japandi vase/planter language from Jerry's references. They are NOT
triplanar like the all-over patterns; `ribAt()` in `preview.worker.ts` uses cylindrical
coordinates about the part's upright axis, and three rules make them come out clean:

- **A whole number of ribs.** The count comes from the requested pitch at the widest
  radius and is then fixed, so the pattern meets itself exactly at the seam behind the
  part (a fixed mm pitch would leave a visible mismatch) and ribs converge as the body
  narrows, the way a turned vase does at its neck.
- **Outer surfaces only** (`n · r̂ > 0`). A shelled pot's inner wall is a surface too;
  ribbing it buries invisible detail and doubles the triangles, and carving it eats into
  a 2.5 mm wall from the inside.
- **A plain band at the foot and rim** (smoothstep over ~one pitch, capped at a tenth of
  the height) plus a `(1−|n_z|)²` wall weight. Without these a vase gets radial spokes
  across its rim and a scalloped base that won't lay a clean first layer.

The subdivision in `displace()` is now **adaptive**. It used to split every triangle
into four every pass, which is the wrong distribution on a CAD part — an already-fine
fillet gets refined into oblivion while the big flat wall beside it is still coarse when
the budget runs out (ribs came out as a staircase with 290k triangles spent). It now
marks EDGES longer than the target and emits 2 / 3 / 4 children for triangles with 1 / 2
/ 3 marked edges; because the mark is per-edge, neighbours always agree and no
T-junctions open up (verified watertight, zero flipped or degenerate triangles).

That change exposed a long-standing lie: the all-over target of `scale * 0.45` only ever
looked acceptable because the uniform pass blew straight past it. Honest targets are now
0.08 of the feature for all-over (2-D, hard-rimmed), 0.22 of the finest rib pitch for
ribs (1-D), 0.05 for fuzzy. Rib budget is 2M triangles, everything else 700k.

Also fixed here: the **crease-edge overlay** (`EdgesGeometry(geometry, 30)` in
Viewer.tsx) was rebuilding from the displaced mesh and scribbling 33,000 line segments
down the flute valleys — it read as dashed cracks in the surface. Geometry carrying
`userData.textured` now skips it, which also saves an EdgesGeometry pass over a million
triangles. And `pleat` used to run at double density, quietly making "Rib pitch 3 mm"
mean 1.5 mm for that one pattern; Pleated is the sharp profile, not the dense one.

Probe: `ribs.mjs` shoots all six on a round body and reports triangles/watertight;
`ribdiag2.mjs` counts flipped triangles. Re-run `plook.mjs` after ANY change to
`detail` — facets show up in pixels long before they show up in a number.

**Pattern tool: deliberate Apply + real history (build 375).** Two behaviour changes,
both from Jerry's report:

1. *The panel edits a DRAFT.* Tile clicks and sliders stage; nothing touches the model
   until **Apply** (label becomes **Update** when a slot is already on; **Remove** sits
   beside it). Browsing tiles used to fire a multi-second full-surface recompute per
   click. The applied tile wears a dot distinct from the `.on` selection highlight.
2. *Applying a surface treatment is a history step.* `Version`/`Snapshot` gained
   `surfFx` (store/types.ts `SurfFxSnap` — structural twin of `SurfFxSlot`, the store
   must not import engine types). `commitSurfFx()` in App.tsx appends a version copying
   the head's model fields with only the fx spec changed, so Undo takes off exactly the
   pattern and Redo puts it back; `rebuildHead` sets `surfFx` from the target version
   (absent = plain), so restore/undo/redo/reopen show each version EXACTLY as it was —
   the old free-floating fx state silently re-wrapped anything you restored. Model-edit
   snapshots (applyResult, the Adjust coalesce path, saveParamsVersion) carry
   `fxForSnap()` so a pattern survives its own timeline. Bonus: since the fx is a spec
   in the version, patterns now survive reload/reopen.

Still OUTSIDE undo, for honesty: text/logo layers and their transforms (session-only
attachments), measurements, pins. Paint has its own undo layered before versions in
`undo()`. Probe: `fxhistory.mjs` — browsing is free, Apply = one step, Undo exact,
restore never re-wraps.

## Build 360 — Shape tool (primitive booleans that stay parametric)

New `SolidOp` in the op chain (`engine/types.ts`, executed in `worker/cad.worker.ts`):
box / cylinder / sphere, fused or cut, centred on `at`. The rail tool **Shape** arms it;
a click on the model places it (added shapes sit ON the surface, cut shapes sink IN, so
the size you typed IS the pocket depth), then the flyout types its exact size and centre.
Placed shapes are listed and removable, the way magnet pockets are.

Why an op and not an attachment boolean: `mergeAttachments` / `engraveAttachments`
(`App.tsx`) run Manifold against the display mesh and emit `kind: "generative"` — they
collapse a CAD model to a mesh and kill Adjust. A `SolidOp` stays in the recipe, so the
part is still parametric after a boolean (verified: Adjust rows survive two of them).

Gotcha for anyone extending this: replicad's `makeBaseBox` grows from a CORNER at the
origin, `makeSphere` is centred, and `makeCylinder` takes an explicit start point. The
worker normalises all three so `at` always means the centre — which is what lets the size
be retyped without the shape drifting off the spot it was placed on.

## Build 355–357 — Modify tool, spatial plates, History rework

- **Modify tool** (rail, CAD only): arm Push/Pull / Round / Bevel, click a face,
  edge or corner, then drag the anchor. Live value + live status-bar dims; drags
  clamp at real limits (bed fit out, cut-through in, radius cap) and say which
  one they hit. Typed size + Apply is the no-drag path. Shell/revolve/patterns
  still go through Select + the chat — there is no local op for them.
- **Selection highlights persist** until deselected (hover used to repaint the
  shared overlay), and the Viewer takes a `featureSelected` prop so the lock
  clears when the app drops its pick.
- **Build plates are spatial now**: one slab per plate, each centred under its
  own objects (empty plates park a bed-and-a-bit over, the `bed.x * 1.2` stride
  the multi-plate 3MF export already used). Switching plates frames that plate.
  Objects are NOT moved by plate assignment — the slab finds them, not the other
  way round, so nothing perturbs pick/ops coordinates.
- **History**: `Current` follows `headId` rather than the newest row; the row IS
  the restore control (a Restore button left ~70px for the label in the 262px
  dock); restore is guarded against mid-build races and double-fires and shows a
  loading row. **`MAX_VERSIONS = 60`** in `store/versions.ts` — versions carry a
  whole snapshot (code, ops, and `glb`/`importFile` blobs for generated or
  imported parts), so the list is now capped on both the append and restore
  paths. `persist()` writes `projectRef.current` eagerly; two commits in one
  React tick used to drop a version.
- **Magnet pockets**: `Re-cut all` applies size + fit + seat (it only ever moved
  the depth, so choosing a new magnet looked broken). The panel lists every
  pocket from the op chain — click to edit, ✕ to remove.
- **Profile photo**: `moldable_avatar` in localStorage, a 160px square WebP data
  URL capped at 48 KB. It rides the settings blob (any `moldable_*` key not in
  `LOCAL_ONLY_KEYS` syncs), mirroring `moldable_user_tint`. No schema change, no
  new bucket, works signed out. Picker: Settings → Appearance.

Still open from the audit: the naming problem — Plates / Pieces / Attachments /
Objects are four words for containers, and users can't tell which is which; the
invisible-state list (fit chip visibility, printer preset reach, silent PLA
injection in project_settings); "needs the Precise engine" leaking internal
vocabulary; auto-repair without a caveat line.

## Conventions

- Ship each feature as its own PR to `main` (squash-merge; Pages auto-deploys ~2 min).
- Verify with Playwright against the real kernels (chromium at /opt/pw-browsers; harness
  pattern: boot app → "Try the built-in example" → drive UI → assert). Delete harnesses.
- The worker/engine test pattern and winding rules live in NOTES_PREVIEW_ENGINE.md.

## Suite health pass — 2026-08-17 (builds 465–469)

All 61 Playwright probes were run across three isolated lanes and every failure was
given a verdict. The result matters more than the count: **the app was in far better
shape than its test suite.** 26 passed; of the 35 failures, 23 were STALE PROBES
asserting on UI that had legitimately changed (`.pb-export` → the Export dock,
"Extrude all" → "Push / Pull all", "Check fit" → "Check clearance", "Zoom to fit" →
"Reset view", the Select rail tool deleted by 044ab7f), 10 were harness bugs, and
only 4 were the app. `stamp-probe` was retired outright: it asserted the old
`v <sha> · <date>` stamp while `pwa-e2e` asserts the current `/^v\d+$/` and passes,
so the suite was contradicting itself.

Fixed and verified (harness/regress-465-e2e.mjs):
- **Drilling a hole had no reachable entry point.** `Hole…` renders only in
  DirectOpBar, gated on `!modifyCtl.op` — and Modify, which absorbed Select and is
  the only tool that arms face-picking, sets an op as it arms. The verb moved to the
  selection row. And it still would not have worked: `.pin-panel` sat at z-index 6
  under the tool flyout's 41, so "Drill hole" could be seen and not clicked.
- **Escape stopped cancelling Mark after the first use** — MarkOverlay was the only
  overlay not on the shared `useEscape` stack.
- **The finished step list always dropped its last step** — `setStage` archives the
  stage it replaces, so the kernel pass was never in the trail.
- **Autosave failures were structurally unobservable** — seven `void put(...).then()`
  calls with no rejection path, over a backend whose localStorage writer is
  unguarded. Also the printed-tolerance calibration, which cost a physical print.
- **Viewer.tsx was not a Fast Refresh boundary** (two dead exports), so every save
  reloaded the page and re-warmed the OCCT kernel. Same for Workspace.tsx via
  FILAMENT_SWATCHES, now moved to `print/filament.ts`.

New standing infrastructure: `npm run suite` (exits non-zero — 45 probes print FAIL
and exit 0 on their own), `npm run lint` (three rules, chosen against the two defect
classes above; a recommended preset produced 719 style errors and buried them), and
`harness/observability-e2e.mjs` (boot timings, heap growth, unhandled rejections,
failed requests, console noise). Observability baseline on this machine: shell 1.0 s,
workspace 2.1 s, first model 2.7 s, zero rejections/page errors/console errors, heap
flat across a session of orbiting and panel switching.

Still open from the pass: 23 stale probes need retiring or rewriting one by one, and
the audit's other findings (LibraryModal's partial bulk-delete, `lib/hardware.ts` —
692 lines that have never had a caller, ~26 dead CSS classes, two emoji-as-icon spots
where the right SVG exists unused).

### Finishing pass (build 470)

The rest of the audit's list, cleared:

- **All 30 stale/broken probes repaired**, not quarantined. The pattern was almost
  always the same three shapes: a renamed string ("Check fit" → "Check clearance",
  "Make it fit" → "Cut to fit", "Zoom to fit" → "Reset view", "Fit to plate — scale
  down" → "Scale to fit bed"), a control that moved (`.pb-export` → the Export dock,
  face verbs → the ContextBar, the Launchpad's Plan/Research toggles → one folded
  `.lo-trigger` with a menu), or a missing precondition (no `enterWorkspace`, no
  `moldable_signin_prompted` seed so the sign-in backdrop ate every click, no tool
  armed so canvas clicks selected nothing).

  Four were the probe's own logic rather than a rename, and those are the interesting
  ones: `library-organize` had its alphabet wrong (A–Z of Dragon/Headphone/Storage puts
  Storage at index 2, not Headphone — the app was right); `library-thumbs` used an
  ASYNC predicate in `waitForFunction`, which resolves on the first poll regardless of
  the value, so its "wait" gated nothing; `theme-toggle` read `backgroundColor` off
  `.composer textarea`, which is `background: none`, so it saw rgba(0,0,0,0) in every
  theme and two of its five checks could only ever pass; and `local-e2e`'s mock assumed
  call #1 was the CAD call when one send now fans out to four (router → plan → prepare
  → CAD), so it fed the bad program to the ROUTER and the repair loop it was testing
  never ran. It keys off the system prompt now.

  `damping-e2e` is the one that cannot be judged here: its A1 measures the probe's own
  rAF pump, while the viewer's loop is render-bound at ~53 ms/frame on software GL in
  BOTH runs, so A4/A5 were comparing a situation with itself. It now derives the real
  frame time from the damping factor and SKIPS those two with an explanation when the
  throttle never reached the render loop, instead of asserting either way.

- **lib/hardware.ts is wired up.** 692 lines of ISO-sourced bearing/nut/washer/
  extrusion/board dimensions that had never had a caller in their entire git history —
  its own docstring described the caller ("a prompt builder feeding it free text") and
  that caller was never written. `hardwareFacts()` in llm/prompts.ts now injects the
  nominal figures when a request names a known part, and nothing at all otherwise.
  Wiring it exposed a lopsided index: a washer's id carries its category ("w_m2") so
  "washer m5" resolved, but a hex nut is keyed on the bare thread ("m3") so "M3 nut
  trap" and "M5 nyloc" — about as common as maker phrasing gets — resolved to nothing,
  and the token sweep skips keys under three characters. Category aliases fix it;
  `harness/hardware-lookup-e2e.mjs` guards both directions, including that a near miss
  still returns NOTHING ("washer m5" must never come back a nut).

- **Dead CSS removed** — 55 single-line rules, ~5 kB. Done conservatively after a first
  attempt with a hand-rolled parser desynced inside an `@media` block and was reverted:
  single-line rules only, brace balance checked, and `:not()` contents excluded from the
  deadness test. That last one mattered — `.rail-fly .seg:not(.kind-seg)` targets the
  LIVE `.seg` and only mentions the dead class inside `:not()`; deleting it would have
  broken every flyout's button row.

- **Emoji out of the UI**: the texture chip rendered 🎨/⬜ while `IconTexturize` — a
  checkerboard glyph built for that exact button — sat in icons.tsx with zero call
  sites. Same for two ⚠️ strings where `IconWarn` was already imported and used
  correctly three lines away.

- **LibraryModal reports its failures.** `refresh()` was try/finally with no catch (a
  failed read cleared the spinner and left a stale list), and the bulk move/delete loops
  stopped at the first error leaving a half-applied change, uneven tombstones, and a
  modal that never refreshed. They now continue, collect, and name what did not happen.

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
height-map upload), draggable key light (environment presets shipped as Showcase
scenes — Studio/Daylight/Dark stage/Workshop with a camera-riding light rig),
snap-to-object magnetism, per-axis scale for mesh models.
