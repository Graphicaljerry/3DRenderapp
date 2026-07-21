# Moldable

[![Deploy to GitHub Pages](https://github.com/Graphicaljerry/3DRenderapp/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Graphicaljerry/3DRenderapp/actions/workflows/deploy-pages.yml)

A local-first, BYO-Anthropic-key web app that turns a text description into a **3D-printable model**:

> **describe → AI writes CAD → live 3D viewer → export STL · 3MF · STEP · OBJ**

**🔗 Live demo:** https://graphicaljerry.github.io/3DRenderapp/ · **💰 Business plan:** [`docs/COMMERCIALIZATION.md`](../docs/COMMERCIALIZATION.md)
(Precise CAD + Hugging Face image→3D work on the hosted site; the paid engines need the Cloudflare Worker relay from `proxy/`.)

This is the full Phase-1 build (see `../docs/PLAN.md`, `../docs/RESEARCH.md`). The folder is still
called `moldable-lite` for continuity with earlier runs.

## Two engines, one chat

- **replicad (primary).** The model writes **replicad** code; it runs on the **OpenCascade (OCCT)**
  B-rep kernel in a **Web Worker** (WASM). Real solids → **STL, 3MF, STEP, OBJ** export. STEP opens
  as an editable solid in Shapr3D/Fusion.
- **primitive (automatic fallback).** If the OCCT kernel fails to boot, the app silently falls back
  to a dependency-light primitive+CSG engine (the model emits a JSON spec). Everything still works
  except STEP export (a banner tells you). The app never dies on a WASM hiccup.

## Direct edits & live previews (dual-kernel)

Dragging the blue arrow (push-pull extrude, drag-to-fillet) edits the model **live**, with two
kernels sharing the work — see [`../docs/NOTES_PREVIEW_ENGINE.md`](../docs/NOTES_PREVIEW_ENGINE.md)
for the full engineering notes:

- **OCCT is always the source of truth.** Every released drag / typed value commits as one
  parametric op through the CAD worker; exports and history only ever see OCCT geometry.
- **Extrude drags preview through [Manifold](https://github.com/elalish/manifold)** (robust mesh
  booleans, WASM, its own worker): a closed prism is fused/cut against the display mesh per tick —
  a few ms per boolean, no CAD kernel in the loop.
- **Fillet drags preview through OCCT** (mesh booleans can't fillet). The CAD worker caches every
  intermediate of the op chain, so one drag tick costs exactly one OCCT op, meshed coarse.
- **If a size doesn't fit** (e.g. a 33 mm fillet on a 1.4 mm wall) the worker bisects for the
  largest size that *does*, applies it, and the chat states both numbers.
- **Any Manifold failure** (a mesh it can't weld into a solid) silently falls back to the OCCT
  preview path; a failed preview tick keeps the last good frame.

## Features

- **Streaming chat** with a **self-healing loop** — on a build/compile error the exact error is fed
  back to the model and it retries (up to 3×) before surfacing anything. The **thinking panel
  narrates every step** live (studying your reference image, web research, which model is writing,
  kernel build), with the model's own reasoning streaming underneath when available.
- **Smart engine routing** — organic asks go to the AI-mesh engine, dimensioned parts to CAD;
  ambiguous requests (words **or an attached photo/sketch**) are classified by your configured
  brain. **Hand-drawn sketches become models**: drawn lines are read as edges and handwritten
  dimensions are used exactly, in either engine.
- **Live 3D viewer** — orbit/zoom, print-bed grid, wireframe toggle, Z-up mm.
- **Code tab** — view/edit the replicad code (or the JSON spec) and **Re-run** with no AI call.
- **Printability** — bed-fit, watertight/manifold (edge-adjacency), overhang %, triangles, volume —
  plus **print prep**: an overhang **heatmap** painted on the model, Tweaker-style
  **auto-orientation** with one-tap apply, ray-cast **wall-thickness** checking, and a one-click
  **elephant-foot chamfer** on the bed-contact edges.
- **Fit calibration** — print the **Tolerance test coupon** template once, enter the measured snug
  clearance in Settings, and every future snug/press/loose fit uses your printer's reality.
- **Fastener presets** — the hole tool knows **M2–M5 heat-set inserts** (with boss guidance),
  screw clearance, and thread-forming pilot sizes.
- **Surface textures** — knurl, hex, noise, **wave, voronoi, diamond, fuzzy skin**: real displaced,
  printable geometry (not a shader).
- **Version history** — every change is snapshotted; **restore** any earlier version (append-only).
- **Project library** — saved locally (IndexedDB, localStorage fallback): open / duplicate / delete.
- **Export menu** — STL · 3MF · STEP · OBJ (STEP gated to the replicad engine).
- **Settings** — AI brains (Anthropic, Gemini, OpenAI, Groq, **OpenRouter with per-request Auto
  routing**, Ollama, on-device) + printer defaults (bed size, overhang threshold, fit calibration).
- **Zero-spend example** — "Try the built-in example" builds an L-bracket with no API call.
- **Template gallery** — photo cards of 11 common parts (phone stand, cable clip, wall hook,
  box with lid, tolerance coupon…): one tap builds a fully parametric model, no AI call, no key.

## Run

```bash
cd moldable-lite
npm install
npm run dev
```

Then open **http://localhost:5173** (run `npm run dev` on its own line — no trailing `# comment`).

1. Click **"Try the built-in example"** to confirm the viewer + export work (no key needed).
2. Paste your **Anthropic key**, pick a model, and describe a part, e.g.
   *"a 60×40 mm bracket, 4 mm thick, with two 4 mm holes"* → refine: *"round the corners 3 mm and add a 20 mm wall on one edge."*
3. Try **Export ▾ → STEP** and open it in Shapr3D.

`npm run build` typechecks (tsc) and bundles (vite). First load fetches the ~11 MB OCCT WASM once, then it's cached.

## Notes / limits

- The replicad kernel is a multi-MB WASM in a worker; the **first** build in a session waits for it
  to boot (a spinner shows). Complex models take a few seconds.
- LLM fluency with replicad is thinner than with mainstream languages — the embedded API cheatsheet
  + the self-heal loop cover most misses; occasionally a prompt needs a nudge.
- Printability wall/overhang checks are best-effort heuristics; bed-fit and watertight are exact for
  the displayed mesh.
- Untrusted generated code runs in the worker sandbox (globals shadowed, watchdog timeout). It's your
  own key and machine, but treat generated code as you would any code you run.

## Architecture (where things live)

```
src/
  worker/cad.worker.ts     OCCT boot + run untrusted replicad code + mesh/export blobs
  engine/                  Engine interface, replicad + primitive engines, auto-fallback selector
  llm/                     Anthropic streaming client, system prompts (+ replicad cheatsheet), extract
  cad/                     primitive JSON schema + CSG builder (fallback engine)
  print/                   printability analysis + STL/OBJ/3MF export
  store/                   IndexedDB project + version persistence
  components/              Workspace, Viewer, Library modal; App.tsx orchestrates
```

<!-- deploy retrigger: run 29 hit a transient GitHub Pages outage -->
