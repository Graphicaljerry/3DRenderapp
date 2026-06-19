# Research — methods & possibilities for "describe → printable model"

_Compiled 2026-06-19. This is the evidence base behind the architecture in `PLAN.md`._

> **How this was researched.** Seven parallel, source-cited investigations (run as background
> agents) covered: code-CAD libraries, LLM→CAD code generation, browser 3D rendering, in-browser
> printability checks, file-format handoff, generative-3D providers, and image/sketch→3D. Every
> load-bearing fact below carries a primary-source link. **Caveat:** this is a fast-moving space —
> provider pricing and model versions change monthly; treat anything not from an official docs/spec
> page as soft and re-verify before building. Staleness flags are collected at the end.

---

## Part 1 — Phase 1: Parametric (text → code-CAD → print)

### 1.1 Engine library: **replicad** is the only fit, and the research confirms it

The decisive constraint is **STEP export in the browser with no server** (so STEP round-trips into
Shapr3D as an editable solid). That eliminates every option except replicad.

| Library | In-browser (WASM) | B-rep / STEP | License | Maturity (2026) | LLM training corpus |
| --- | --- | --- | --- | --- | --- |
| **replicad** | ✅ yes | ✅ STEP + STL (+SVG) | MIT | v0.23.x, ~650★, active | Small |
| CadQuery | ❌ Python/server | ✅ STEP/STL/3MF/… | Apache-2.0 | v2.7 (2026-02), 5.3k★ | **Large** |
| build123d | ❌ Python/server | ✅ STEP/STL | Apache-2.0 | v0.11 (2026-06), 2.5k★ | Medium |
| OpenSCAD-WASM | ✅ yes | ❌ mesh only (STL/3MF) | GPL-2.0 | active; wasm wrapper older | Very large |
| JSCAD | ✅ yes | ❌ mesh only | MIT | active | Medium |
| Manifold | ✅ yes | ❌ mesh only | Apache-2.0 | v3.5 (2026-06) | n/a (not authoring) |

- replicad = a TS/JS fluent API over **OpenCascade (OCCT)** compiled to WASM; exports via
  `shape.blobSTEP()` and `shape.blobSTL()` directly in the browser (returns a `Blob` → client-side
  confirmed). ([replicad docs](https://replicad.xyz/docs/use-as-a-library/), [Solid API](https://replicad.xyz/docs/api/classes/Solid/), [repo](https://github.com/sgenoud/replicad))
- **Risks to design around** (all documented): (a) **OCCT fillet/chamfer fragility** + the
  **topological-naming problem** — apply fillets late, shrink radius on failure; (b) **single-thread
  WASM** performance ceiling — run in a Web Worker; (c) **thin LLM corpus** vs CadQuery/OpenSCAD —
  mitigate by putting the replicad API + worked examples in the system prompt. ([ReplicadManual](https://github.com/raydeleu/ReplicadManual))
- Fallback if replicad quality disappoints: run **CadQuery/build123d server-side** (best LLM
  support + STEP), trading the no-backend property. OpenSCAD is ruled out (no STEP).

### 1.2 LLM → CAD code (this is the heart of the app)

- **Code beats proprietary formats.** Every serious 2025–26 system has LLMs emit a CAD *language*
  (CadQuery / OpenSCAD / KCL) rather than a command-sequence — even **Zoo/KittyCAD abandoned direct
  text-to-B-rep ML in favor of LLMs writing & debugging KCL code** ("similar to Codex and Claude
  Code"). ([Zoo Zookeeper](https://zoo.dev/research/zookeeper))
- **Reality check (MUSE benchmark, CadQuery, 2026):** even the best frontier model gets ~**77%** of
  scripts to merely *run* and only ~**69%** to *geometrically valid* solids — and far fewer to
  "engineering-ready." Closed models lead; the gap is smaller than expected; **geometric judgment,
  not plumbing, is the bottleneck.** Human-in-the-loop visual steering still wins over one-shot.
  ([MUSE](https://dong7313.github.io/muse-benchmark/))
- **Self-healing loop (most-validated pattern), as we'll build it:**
  1. **Compile-error retry** — feed the spec + previous code + error back to the model (cap ~3).
  2. **Render → VLM visual check** — render the result from ~4 angles, have the model answer
     yes/no questions about whether it matches the request; cap ~**2** refinements (gains flatten
     after 2). ([CADCodeVerify, ICLR 2025](https://arxiv.org/abs/2410.05340))
  3. **Manifold/watertight gate** — *preview ≠ printable mesh*; a model can look right and still
     export non-manifold. Always validate before enabling export. ([ModelRift](https://modelrift.com/blog/openscad-llm-benchmark/))
  General code self-repair literature agrees **2–3 iterations capture 76–95% of the gains.**
- **Prompting best practices** (from working implementations): put the **library cheatsheet in
  context**; **pin real-world dimensions** (M3 screw, a Raspberry Pi, an iPhone) instead of guessing;
  encode **FDM constraints as defaults** — 2 mm walls (1.2 mm min), 0.3 mm hole clearance, chamfers
  (not fillets) on bottom edges, bridges <20 mm, overhangs <45°, flat bottom for bed adhesion;
  **be interactive** (ask clarifying questions, confirm the base shape) rather than one-shot; and
  **expose parameters as variables/sliders** so dimension tweaks re-render with **no LLM call**.
  ([cad-skill](https://github.com/flowful-ai/cad-skill), [prusa-claude](https://github.com/ianonuska/prusa-claude))

### 1.3 Browser 3D rendering

- Stack: **three.js (~r184) + react-three-fiber (v9 ↔ React 19) + drei** — all MIT, mature, zero
  R3F overhead over plain three.js. ([three.js](https://threejs.org/), [R3F](https://r3f.docs.pmnd.rs/getting-started/introduction))
- replicad → three.js is **officially supported** via `replicad-threejs-helper`: `shape.mesh()` and
  `shape.meshEdges()` → `syncGeometries()` returns paired `BufferGeometry` for **faces + crisp CAD
  edges**. ([replicad-threejs-helper](https://www.npmjs.com/package/replicad-threejs-helper))
- **Run OCCT in a Web Worker** (replicad's explicit recommendation); transfer mesh/edge arrays to
  the main thread for rendering. `<model-viewer>` is great for showing a finished GLB/AR but
  consumes packaged glTF (not raw buffers), so it's not the base for this pipeline.

### 1.4 Printability checks doable in-browser

| Check | Feasibility | How |
| --- | --- | --- |
| **Fits the bed** | trivial, ship it | `Box3().setFromObject()` → compare extents to bed (test rotations) |
| **Watertight / manifold** | reliable | build/verify via **`manifold-3d`** (WASM, Apache-2.0) `status`, or boundary-edge count |
| **Triangles / volume / shells** | easy | iterate `BufferGeometry` |
| **Overhangs > 45°** | easy (approx) | per-face normal vs build axis; **make the angle configurable** (material-dependent) |
| **Min wall thickness** | **hard — heuristic only** | shrink-ray / SDF via **three-mesh-bvh** (MIT); no exact JS lib exists — manage expectations |
| **Slice / G-code / time** | later | embed **Kiri:Moto** (MIT, fully client-side, iframe or worker API). Avoid `cura-wasm` (AGPL, archived 2023) |

### 1.5 File formats — **add 3MF** (the one design change from research)

- **For printing:** emit **3MF (preferred)** + **STL (universal fallback)**. 3MF carries **units**
  (kills STL's scale ambiguity), color, multi-object, metadata; it's PrusaSlicer's native project
  format and is widely supported. Target the **core** 3MF spec for cross-slicer compatibility.
  ([3MF Core Spec](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md))
- **For MCAD round-trip (Shapr3D):** emit **STEP** — arrives as an **editable but history-free**
  B-rep solid (you re-edit via direct/push-pull modeling; the feature tree never travels in STEP).
  Shapr3D imports STEP as a single editable "Import" step. ([Shapr3D Import](https://support.shapr3d.com/hc/en-us/articles/7874501645724-Import))
- **Don't bother feeding slicers STEP** — they just tessellate it via OCCT on import, so a
  well-tessellated 3MF/STL you control is equal or better. Keep STEP for CAD, 3MF/STL for print.
- Tessellation quality knobs = replicad's `tolerance` (linear deflection, mm) + `angularTolerance`;
  rule of thumb chord height ≈ 1/20 of layer height. Expose a quality slider later.
- Net export menu: **STL · 3MF · STEP · OBJ** (3MF marked recommended for print).

---

## Part 2 — Phase 2: Generative mesh (text/image → mesh → print)

### 2.1 Provider recommendation: **Meshy first**, Tripo second, Rodin premium

Meshy is the only provider that shipped a **purpose-built 3D-printing API suite in 2026**, which
removes most of the "mesh cleanup" risk:

- **Analyze Printability** (free) — watertightness, volume, holes, non-manifold-edge counts for any
  `.glb/.stl/.obj`; async + SSE.
- **Repair Printability** (~10 credits) — fixes non-manifold edges, degenerate faces, holes.
- **Multi-Color Print → 3MF**, **Creative Lab "Figure"** (photo/text → printable figurine),
  plus `auto_size` (AI estimates real mm), `origin_at=bottom` (flat base), multi-image (1–4),
  webhooks, SSE, a free **test-mode key**, STL/3MF output. Current model **Meshy-6**.
  ([Meshy pricing](https://docs.meshy.ai/en/api/pricing), [changelog](https://docs.meshy.ai/api/changelog))

| Provider | Text→3D | Image→3D (multiview) | Print formats | Print-readiness | Notes |
| --- | --- | --- | --- | --- | --- |
| **Meshy** ✅ first | ✅ | ✅ (1–4) | STL, 3MF | **Analyze + Repair printability**, auto_size, flat base | Most mature REST API; SSE/webhooks; test key |
| **Tripo** ✅ second | ✅ | ✅ native multiview | STL, 3MF, USD | quad topology, retopo | Cheaper/faster; credits never expire |
| **Rodin/Hyper3D** (later) | ✅ | ✅ (~10 imgs) | STL, GLB… | watertight + symmetry claims | Highest figurine fidelity; premium |
| CSM | ltd | ✅ | GLB/OBJ… | retopo | ⚠️ **Acquired by Google Jan 2026** — avoid |
| Sloyd | ✅ (parametric) | ltd | GLB/FBX | inherently manifold | template categories only |
| Luma Genie / Spline / Adobe | — | — | — | — | no current headless mesh API |

- **CORS caveat:** these are server-style Bearer-token APIs and **may block direct browser calls**
  (unlike Anthropic's officially-supported browser mode). Plan to route mesh-provider calls through
  the **Tauri shell or a thin local proxy**; verify per provider. *(Not individually verified.)*

### 2.2 Open-source models (context, not the default for a no-backend app)

**TRELLIS.2** (MIT, Microsoft — best permissive option, handles open/non-manifold/internal
geometry), **Hunyuan3D 2.1** (top quality but **custom license: not EU/UK/SK + 1M-MAU cap** →
risky for a distributed product), **Step1X-3D** (Apache-2.0, watertight GLB), **TripoSR/InstantMesh**
(older, fast, permissive), **Stability SF3D/SPAR3D** ($1M-revenue community license). All need a GPU;
a hosted route is **fal.ai / Replicate** (~$0.05–0.16/gen). ([TRELLIS.2](https://github.com/microsoft/TRELLIS.2), [Hunyuan3D license](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE))

### 2.3 Image / sketch → 3D (our actual Phase-2 inputs)

- Single photo → 3D is genuinely useful for organic shapes (~80–95% accuracy on the **visible**
  side); weak points: hallucinated back, the **"Janus" multi-face problem**, baked-in lighting
  (use `remove_lighting`/"delighting").
- **Multi-view (2–4 photos) is the single biggest quality lever** → build an optional **"add
  back/side photos"** step (reflected in the Image-input wireframe).
- **Sketch → 3D is the weakest path** — needs clean single-subject line art + a text prompt +
  symmetry; set expectations and lean on regeneration.
- For FDM, **geometry is all that matters** — request geometry-only generations to cut cost/time.

### 2.4 Making generative meshes printable + GLB→STL

- Validate/repair in-browser with **`manifold-3d`** + **three-mesh-bvh**, and/or Meshy's
  Analyze/Repair endpoints; heavy cases → a native **fTetWild** pass (if/when we add a Tauri shell).
- **GLB→STL gotchas:** glTF is **meters**, STL is unitless and slicers assume **mm** (a 1-unit GLB
  prints ~1000× too small) → **scale to a user-chosen mm size before export** (or use `auto_size`);
  use **binary** STL; glTF is Y-up vs slicer Z-up (rotate −90° X). Export via three.js `STLExporter`.

---

## Part 3 — Consolidated recommended stack

- **Shell:** TypeScript · Vite · React 19 · Tailwind. Optional **Tauri** later (also unblocks
  mesh-provider CORS + native slicer/file access).
- **Phase 1 engine:** **replicad** (OCCT WASM) in a **Web Worker** → `replicad-threejs-helper` →
  **three.js / react-three-fiber + drei**. Export **3MF + STL + STEP + OBJ**.
- **AI:** Anthropic SDK in the browser (`dangerouslyAllowBrowser`, user's own key) with the
  **self-healing loop** (compile-retry → VLM visual check → manifold gate).
- **Printability:** `manifold-3d` (watertight/manifold) + `Box3` (bed fit) + normal-based overhang;
  `three-mesh-bvh` for heuristic wall thickness; **Kiri:Moto** later for slicing/G-code.
- **Phase 2 engine:** **Meshy** (Analyze/Repair printability, auto_size) first; **Tripo** second;
  **Rodin** premium — called via Tauri/proxy.

## Part 4 — What this changed in the design

1. **Print format = 3MF + STL** (was STL/OBJ); STEP stays for Shapr3D; export menu now 4 options.
2. New **Parameters panel** (sliders) — instant, no-AI re-render of dimensions.
3. **Self-healing loop** spec'd as compile-retry → visual VLM check → **manifold gate** before export.
4. **Printability report** screen (bed fit / watertight / overhang / wall heuristic).
5. **Image input** gains an **"add 2–4 angle photos"** step; Phase-2 provider decided (**Meshy**).
6. **Settings** carries Meshy + Tripo keys; mesh providers flagged as needing a proxy/Tauri (CORS).

## Part 5 — Staleness / uncertainty flags

- Generative-provider **pricing & model versions churn monthly** — re-verify before integrating.
- **CORS for mesh providers** not individually verified — assume a proxy/Tauri is needed.
- **replicad version** mismatch (git tag v0.23.3 vs npm 0.23.1) and **exact bundled OCCT version**
  are unconfirmed — inspect before pinning a kernel-specific bugfix.
- **Min wall thickness** has no exact JS solution — ours is a heuristic.
- Several primary sites returned 403 to automated fetch; those facts were corroborated via GitHub
  source, npm, jsDelivr, and official spec repos.
