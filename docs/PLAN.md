# Project Plan — 3D Print AI Assistant

_Last updated: 2026-06-12_

This document captures the **goals, intentions, scope, architecture, and roadmap** for the app.
It is the source of truth we revise as the project evolves. It is intentionally written to be
readable by a non-expert — if a section gets too jargon-heavy, that's a bug.

---

## 1. Vision & goals

**Vision:** Let anyone create a 3D-printable object by *talking about it* — describe it in words
(now) or show a photo/sketch (later) — and walk away with a print-ready file, without learning CAD.

**Primary goals (what success looks like):**
1. I can describe a functional part in chat and get a **printable STL** I can actually print on an
   FDM printer.
2. I can **refine** the result conversationally ("bigger hole", "round the corners", "add a lid").
3. I can see the model in a **live 3D viewer** and rotate/zoom before exporting.
4. The app supports **both** precise/mechanical parts and organic/artistic shapes.
5. It runs **on my own machine** with **my own API keys**, costing only what the AI providers charge.
6. Parametric designs export as **STEP** so they open in **Shapr3D as fully editable solid
   bodies** — not just as frozen print meshes. (STL/OBJ are always available for printing.)
7. **Apple-simple.** The app should feel like Apple made it: no home page, no login, no visible
   complexity. Open the app → you're on the canvas → describe a thing. One primary action per
   screen; everything else is quiet or hidden until needed (progressive disclosure).

**Non-goals (for now — explicitly out of scope):**
- No user accounts, login, or payment system in the initial build.
- No hosted/multi-tenant SaaS yet (but we won't architect ourselves out of it).
- No full mechanical CAD assembly editor — this is single-object focused.
- No guarantee of perfect prints on the first try; the goal is a strong, editable starting point.

**Guiding principles:**
- **Reliability over flash.** A boring bracket that prints beats a gorgeous mesh that won't.
- **Local-first & private.** Your keys and designs stay on your machine by default.
- **Two engines, one chat.** The user shouldn't have to know which AI engine is being used.
- **Always escape-hatch to the raw output.** Power users can view/edit the CAD code or the
  raw mesh.

---

## 2. Who it's for

- **Primary user (now): me.** A maker with some coding comfort who wants to guide, not hand-code.
- **Later (optional): hobbyist makers** who don't code at all and want a friendly describe-to-print
  tool. This is why we keep the UI simple and the architecture commercial-ready.

---

## 3. The two engines (core concept)

The heart of the app is routing a request to the right generation engine.

### Engine A — Parametric (LLM → replicad) — **Phase 1, the reliable core**
- The LLM (Claude by default) is prompted to output **replicad** code — JavaScript CAD built on
  **OpenCascade** (the same class of B-rep kernel real CAD apps use), running in the browser via
  WebAssembly (`opencascade.js`). **No server needed.**
- The app executes that code in the browser and exports **STL/OBJ** (printing) **and STEP**
  (real solid geometry → **fully editable in Shapr3D**, Fusion, FreeCAD…).
- **Why replicad over OpenSCAD** (the original plan): OpenSCAD compiles only to meshes (STL) —
  it **cannot produce STEP**, so its output would never be Shapr3D-editable. Replicad gives the
  same "AI writes code → solid model" workflow *plus* B-rep output. The Shapr3D requirement
  decided this.
- **Why this is great:** output is parametric, watertight, and reliably printable. Refinements
  are just edits to the code. The code is human-readable, so it's debuggable and the model
  "remembers" the design exactly.
- **Best for:** brackets, enclosures, holders, mounts, spacers, gears, jigs, replacement parts.

### Engine B — Generative mesh (text/image → 3D) — **Phase 2**
- Calls a 3rd-party text-to-3D / image-to-3D API to get an organic mesh (`.glb`/`.obj`).
- Candidate providers (BYO key, decide at build time): **Meshy, Tripo, Hunyuan3D, Trellis, Rodin.**
- The mesh is run through **printability cleanup** (make watertight/manifold, check wall
  thickness) before STL export.
- **Best for:** figurines, characters, ornaments, sculptural/organic shapes; this is also the
  natural home for **photo/sketch input**.

### Routing
- **Phase 1:** everything goes to Engine A.
- **Phase 2+:** a lightweight classifier (an LLM call, or simple heuristics + a manual toggle)
  decides A vs B. The user can always override with a toggle ("Precise part" vs "Organic shape").

---

## 4. Recommended tech stack

Chosen for: fastest path to a working prototype, no backend required, strong 3D support, and a
clean upgrade path to a hosted product later.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript** | Safer than plain JS, great tooling, industry standard for this. |
| Build/dev | **Vite** | Instant dev server, simple builds. |
| UI framework | **React** | Huge ecosystem, easy to hire/learn, pairs with the 3D viewer. |
| 3D viewer | **three.js** via **react-three-fiber** + **drei** | The standard for web 3D; renders STL/meshes, orbit controls, etc. |
| Parametric engine | **replicad** (on `opencascade.js`) | Code-CAD in the browser → **STL + STEP**, no server. STEP = Shapr3D-editable. |
| AI calls | **Anthropic SDK** (`@anthropic-ai/sdk`) | BYO key from browser — officially supported via the SDK's `dangerouslyAllowBrowser: true` option (sends the API's CORS opt-in header). Safe here because the only key in the browser is the user's own. **No proxy/backend needed.** |
| State/storage | React state + **localStorage** / **IndexedDB** | Keys + project history stay on-device. |
| Styling | **Tailwind CSS** (or plain CSS modules) | Fast, consistent UI. |
| Packaging (optional later) | **Tauri** or **Electron** | If we ever want a desktop app for local file/slicer access. |

> **Why web, not desktop?** It's the fastest route to something usable, the 3D tooling is
> excellent, and it deploys anywhere later. We can wrap it as a desktop app with Tauri *later* if
> we want deeper local-file or slicer integration — without rewriting the core.

---

## 5. Feasibility & honesty section

What's genuinely solid vs. where the risk lives — so there are no surprises.

**Solid / proven:**
- LLM-writes-code-CAD is a well-trodden, reliable approach for parametric parts. ✅
- In-browser CAD kernels work: replicad/`opencascade.js` export STL **and STEP** with no backend
  (CascadeStudio proves the same stack in production). ✅
- Shapr3D officially imports STEP as fully editable solid bodies (per their docs). ✅
- three.js / react-three-fiber 3D viewing is mature. ✅
- BYO-key, local-first apps are a common, low-cost pattern. ✅

**Resolved (2026-06-12 review):**
- ~~Browser → AI API CORS~~ — **Anthropic officially supports direct browser calls.** The SDK's
  `dangerouslyAllowBrowser: true` option enables it (it sends the API's CORS opt-in header). The
  docs flag it as risky only when an app ships *the developer's* key to other users; in our
  BYO-key local-first app the only key in the browser is the user's own. No proxy needed. ✅

**Medium risk / needs care:**
- **LLM geometry mistakes.** The AI sometimes produces parts that compile but are subtly wrong
  (overlapping, wrong dimensions). Mitigation: show the 3D result immediately, show dimensions,
  let the user iterate, expose the code.
- **Compile failures.** Generated code occasionally won't run. Mitigation: a **self-healing
  loop** — feed the error back to Claude automatically for one retry, plus a visible
  "Fix it for me" action. Never show the user a raw stack trace as a dead end.
- **LLM fluency with replicad.** Claude knows OpenSCAD from vast training data; replicad is a
  smaller library with less. Mitigation: embed the replicad API reference + worked examples in
  the system prompt (it's a compact, well-documented API), and lean on the self-healing loop.
  If quality proves insufficient, fallback is OpenSCAD for geometry + accepting mesh-only export
  — but that sacrifices the Shapr3D goal, so replicad gets a real attempt first.
- **CAD-kernel wasm performance.** `opencascade.js` is a multi-MB first load and complex models
  take seconds to build. Mitigation: run the kernel in a **Web Worker** (UI never freezes),
  cache the wasm, show a build spinner in the viewer.
- **Shapr3D import tiers.** STEP import is supported per Shapr3D's docs, but feature access can
  vary by Shapr3D plan (free vs. paid). Verify on your own Shapr3D account early in Phase 1.

**Harder / Phase 2+ risk:**
- **Generative meshes are often not print-ready** (non-manifold, thin walls, floating bits).
  Mitigation: automated cleanup step + clear warnings; treat as "starting point, may need work."
- **Single photo → accurate 3D is inherently approximate.** Set expectations: it captures the
  gist, not exact dimensions.

**Cost reality:** Every generation is a paid API call. Parametric (text) calls are cheap (cents).
Generative-mesh calls cost more (often ~$0.10–$1+ each depending on provider). BYO-key means you
see and control this directly.

---

## 6. Roadmap (phased)

Each phase ends with something usable.

### Phase 0 — Planning ✅ (this document + wireframe outline)
- Goals, scope, architecture, wireframe content. **← we are here.**

### Phase 1 — Parametric MVP (the core)
**Deliverable:** Chat → Claude writes replicad code → build in-browser → view in 3D →
refine by chatting → export **STL (print) / STEP (Shapr3D) / OBJ**.
- [ ] Project scaffold (Vite + React + TS + Tailwind).
- [ ] First-run key card (no login/account — one field, one button), key stored locally.
- [ ] Chat UI with streaming responses.
- [ ] Prompt design: replicad API reference + examples embedded so Claude reliably emits valid code.
- [ ] replicad/`opencascade.js` integration: code → solid (in a **Web Worker** so the UI stays
      responsive).
- [ ] **Self-healing compile loop:** on build error, auto-send the error to Claude for a fix
      (1 retry), plus a "Fix it for me" button in the error state.
- [ ] 3D viewer (react-three-fiber) rendering the model.
- [ ] **Export menu: STL · STEP · OBJ.** Verify a STEP file opens as an editable solid in Shapr3D
      (this is the Phase 1 acceptance test).
- [ ] Conversational refinement (keeps prior code as context).
- [ ] **Design version history:** every model-changing turn snapshots the code; "revert to an
      earlier version" from the chat (iterations sometimes make things worse).
- [ ] Code panel (view/edit the replicad code directly).
- [ ] Save/load projects locally (history).

### Phase 2 — Generative mesh + image input
- [ ] Integrate one mesh provider (BYO key).
- [ ] Engine routing (auto + manual toggle).
- [ ] Photo/sketch upload → image-to-3D.
- [ ] Mesh printability cleanup (watertight/manifold, wall-thickness check).

### Phase 3 — Print-readiness & polish
- [ ] Dimension readout & measuring; unit handling (mm).
- [ ] Basic printability checks/warnings (min wall, overhangs, size vs. bed).
- [ ] Optional slicer hand-off / export presets.
- [ ] Nicer model library, thumbnails, tags.

### Phase 4 — (Optional) commercialization
- [ ] Accounts/login, hosted keys, usage limits/billing.
- [ ] Server-side proxy for providers, shared model gallery, etc.

---

## 7. Open questions / decisions to revisit

- ~~CORS/proxy~~ — **Resolved:** Anthropic supports direct browser calls (`dangerouslyAllowBrowser`).
  No proxy needed for Phase 1. Phase 2 mesh providers must be re-checked individually for CORS.
- ~~Home page / login?~~ — **Resolved (2026-06-12):** **Neither.** The app opens directly into
  the workspace; the empty canvas with one centered prompt is the front door (Visual Electric /
  Manus pattern). No accounts exist — the only first-run gate is a minimal one-field API-key
  card, shown once. A marketing/landing page is out of scope unless the app is ever published.
- ~~Local-first or web-based?~~ — **Resolved:** it's **both** — a *local-first web app*. Built
  with web tech and opened in a browser, but with no server: keys, designs, and history live on
  the device. This beats a native desktop app for v1 (faster to build, runs anywhere) and can be
  wrapped with Tauri later without rewriting.
- ~~OpenSCAD or replicad?~~ — **Resolved:** **replicad**, because Shapr3D-editability requires
  STEP and OpenSCAD can't produce it (see §3 Engine A).
- **Which mesh provider** to integrate first in Phase 2 (Meshy vs Tripo vs Hunyuan3D…): decide
  based on quality, price, and API friendliness at build time. *Data point: Krea AI's 3D tool
  runs Hunyuan3D-2.1 in production (see `docs/inspiration/INSPIRATION.md`).*
- **App name / branding** — *in active exploration; see [`NAMING.md`](./NAMING.md).* Working title
  remains "3D Print AI Assistant." Finding: the 3D/AI/print namespace is heavily saturated — ~30+
  candidates checked, nearly all taken in-space or with `.com`/`.ai` already registered. Cleanest
  in-space shortlist: Billet · Moldable · Chamfer · Vorm · Maku (none with a clean domain). Direction
  per discussion: a clever, "as-if-Apple-made-it," intuitive name spanning CAD-accurate ↔ artistic;
  likely a coined/invented brandable chosen domain-first. Decision pending a naming brief.
- **Architecture: standalone web app vs. plugin** — current lean is the **standalone local-first web
  app** (per §4). Researched: a **Cura** plugin (Python) or **Fusion 360** add-in are feasible *later*
  from the same portable core; **Shapr3D has no public SDK**, so its integration stays via **STEP
  export** (already planned). Recommendation: web-app-first, optional plugins later. Decision pending.
- **Units & defaults** for FDM: default wall thickness, etc.

---

## 8. Glossary (plain-language)

- **STL / OBJ** — mesh formats (triangles). Perfect for printing; **not** truly editable in CAD
  apps — Shapr3D imports them as reference meshes only.
- **STEP** — the universal *solid CAD* exchange format (B-rep, not triangles). Opens in Shapr3D,
  Fusion, FreeCAD as **fully editable solid bodies**. Our parametric engine exports this.
- **B-rep** — "boundary representation": exact mathematical surfaces (what real CAD uses),
  versus a mesh's triangle approximation.
- **replicad / OpenCascade** — our code-CAD engine: a JavaScript library on the OpenCascade
  B-rep kernel (compiled to WebAssembly), so real CAD geometry runs in the browser.
- **Slicer** — software (PrusaSlicer, Cura, Bambu Studio) that turns an STL into printer
  instructions (G-code).
- **OpenSCAD** — a popular "shapes as code" tool (our original engine pick); dropped because it cannot export STEP.
- **Parametric** — a model defined by adjustable parameters (e.g., `hole_diameter = 22`).
- **Mesh** — a 3D surface made of triangles. Generative AI produces these.
- **Manifold / watertight** — a mesh with no holes or self-intersections; required to print well.
- **WebAssembly (wasm)** — lets heavy tools (like a CAD kernel) run fast *inside the browser*.
- **FDM** — fused-deposition (filament) 3D printing; the common desktop type.
- **CORS** — a browser security rule that can block direct calls to some APIs from a web page.
