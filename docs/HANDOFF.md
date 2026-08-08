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

**Still open**: undoing a RECOLOUR does not restore the previous colour (it no longer
deletes the layer, which is what it used to do); and REDO after retyping or resizing a
word does not come forward. Both reproduce in `undoall.mjs`.

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
