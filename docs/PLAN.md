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

**Non-goals (for now — explicitly out of scope):**
- No user accounts, login, or payment system in the initial build.
- No hosted/multi-tenant SaaS yet (but we won't architect ourselves out of it).
- No full mechanical CAD assembly editor — this is single-object focused.
- No guarantee of perfect prints on the first try; the goal is a strong, editable starting point.

**Guiding principles:**
- **Reliability over flash.** A boring bracket that prints beats a gorgeous mesh that won't.
- **Local-first & private.** Your keys and designs stay on your machine by default.
- **Two engines, one chat.** The user shouldn't have to know which AI engine is being used.
- **Always escape-hatch to the raw output.** Power users can view/edit the OpenSCAD code or the
  raw mesh.

---

## 2. Who it's for

- **Primary user (now): me.** A maker with some coding comfort who wants to guide, not hand-code.
- **Later (optional): hobbyist makers** who don't code at all and want a friendly describe-to-print
  tool. This is why we keep the UI simple and the architecture commercial-ready.

---

## 3. The two engines (core concept)

The heart of the app is routing a request to the right generation engine.

### Engine A — Parametric (LLM → OpenSCAD) — **Phase 1, the reliable core**
- The LLM (Claude by default) is prompted to output **OpenSCAD** code for the described part.
- The app compiles that code to an STL **in the browser** using `openscad-wasm` (OpenSCAD
  compiled to WebAssembly). **No server needed.**
- **Why this is great:** output is parametric, watertight, manifold, and reliably printable.
  Refinements are just edits to the code, which LLMs do well. The code is human-readable, so it's
  debuggable and the model "remembers" the design exactly.
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
| Parametric engine | **openscad-wasm** | Runs OpenSCAD in the browser → STL, **no server**. |
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
- LLM-writes-OpenSCAD is a well-trodden, reliable approach for parametric parts. ✅
- `openscad-wasm` in-browser STL generation works and removes the need for a backend. ✅
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
- **Compile failures.** Generated OpenSCAD occasionally won't compile. Mitigation: a
  **self-healing loop** — feed the compiler error back to Claude automatically for one retry,
  plus a visible "Fix it for me" action. Never show the user a raw stack trace as a dead end.
- **`openscad-wasm` performance.** The wasm binary is a multi-MB first load, and complex models
  take seconds to compile. Mitigation: run compilation in a **Web Worker** (UI never freezes),
  cache the wasm, show a compile spinner in the viewer.

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
**Deliverable:** Chat → Claude writes OpenSCAD → compile to STL in-browser → view in 3D →
refine by chatting → export STL.
- [ ] Project scaffold (Vite + React + TS + Tailwind).
- [ ] Settings screen: paste & store API key locally; pick model.
- [ ] Chat UI with streaming responses.
- [ ] Prompt design that makes Claude reliably emit valid OpenSCAD.
- [ ] `openscad-wasm` integration: code → STL (in a **Web Worker** so the UI stays responsive).
- [ ] **Self-healing compile loop:** on compile error, auto-send the error to Claude for a fix
      (1 retry), plus a "Fix it for me" button in the error state.
- [ ] 3D viewer (react-three-fiber) rendering the STL.
- [ ] "Export STL" button.
- [ ] Conversational refinement (keeps prior code as context).
- [ ] **Design version history:** every model-changing turn snapshots the code; "revert to an
      earlier version" from the chat (iterations sometimes make things worse).
- [ ] Code panel (view/edit the OpenSCAD directly).
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
- **Which mesh provider** to integrate first in Phase 2 (Meshy vs Tripo vs Hunyuan3D…): decide
  based on quality, price, and API friendliness at build time. *Data point: Krea AI's 3D tool
  runs Hunyuan3D-2.1 in production (see `docs/inspiration/INSPIRATION.md`).*
- **App name / branding** (working title: "3D Print AI Assistant").
- **Units & defaults** for FDM: default wall thickness, etc.

---

## 8. Glossary (plain-language)

- **STL** — the standard 3D-printing file format (a mesh of triangles). What slicers eat.
- **Slicer** — software (PrusaSlicer, Cura, Bambu Studio) that turns an STL into printer
  instructions (G-code).
- **OpenSCAD** — a "describe shapes with code" CAD tool. Code in → solid model out. Ideal for AI.
- **Parametric** — a model defined by adjustable parameters (e.g., `hole_diameter = 22`).
- **Mesh** — a 3D surface made of triangles. Generative AI produces these.
- **Manifold / watertight** — a mesh with no holes or self-intersections; required to print well.
- **WebAssembly (wasm)** — lets heavy tools (like OpenSCAD) run fast *inside the browser*.
- **FDM** — fused-deposition (filament) 3D printing; the common desktop type.
- **CORS** — a browser security rule that can block direct calls to some APIs from a web page.
