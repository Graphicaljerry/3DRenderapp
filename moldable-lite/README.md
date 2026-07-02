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

## Features

- **Streaming chat** with a **self-healing loop** — on a build/compile error the exact error is fed
  back to the model and it retries (up to 3×) before surfacing anything.
- **Live 3D viewer** — orbit/zoom, print-bed grid, wireframe toggle, Z-up mm.
- **Code tab** — view/edit the replicad code (or the JSON spec) and **Re-run** with no AI call.
- **Printability** — bed-fit, watertight/manifold (edge-adjacency), overhang %, triangles, volume.
- **Version history** — every change is snapshotted; **restore** any earlier version (append-only).
- **Project library** — saved locally (IndexedDB, localStorage fallback): open / duplicate / delete.
- **Export menu** — STL · 3MF · STEP · OBJ (STEP gated to the replicad engine).
- **Settings** — Anthropic key + model + printer defaults (bed size, overhang threshold).
- **Zero-spend example** — "Try the built-in example" builds an L-bracket with no API call.

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
