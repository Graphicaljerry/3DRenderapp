# Moldable Lite

A **light, runnable prototype** of Moldable's core loop, for testing the functionality end to end:

> **describe a part → AI generates a parametric model → see it in 3D → export STL**

It intentionally trades the full Phase-1 engine for something dependency-light and reliable, so
you can try the UX today.

## What it does (and the one simplification)

- **Chat → model.** You describe an object; the AI returns a small **JSON spec** of primitives
  (`box`, `cylinder`, `cone`, `sphere`, `torus`) that are **unioned**, with **cuts** subtracted for
  holes/slots.
- **Live 3D viewer.** Built with `three.js` + `three-bvh-csg` (real boolean CSG for the holes),
  orbit/zoom, a print-bed grid, wireframe toggle, and a **W × D × H mm** readout + "fits bed" check.
- **Export STL.** Binary STL, Z-up, millimetres — ready to drop into a slicer.
- **BYO key, local-first.** Your Anthropic key lives in `localStorage` and is sent **only** to
  Anthropic (browser-direct via the official CORS opt-in header). No backend, no accounts.
- **Zero-spend example.** "Try the built-in example" renders an L-bracket with no API call, so the
  viewer + STL export are testable without a key.

**The simplification vs. `docs/PLAN.md`:** the real Phase 1 has the AI emit **replicad** code run on
the **OpenCascade (WASM)** kernel to get true B-rep + **STEP** export. That kernel is multi-MB and
needs a Web Worker, so this "lite" build swaps it for the JSON-primitive+CSG path. The *loop and UX
are identical* — only the geometry engine differs. See `docs/RESEARCH.md` for the full engine plan.

## Run it

```bash
cd moldable-lite
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. (Run `npm run dev` on its own — don't add a
trailing `# comment`, or the shell/npm may pass it to Vite as the project root.)

1. Click **"Try the built-in example"** to confirm the viewer + STL export work (no key needed).
2. Paste your **Anthropic API key** (and pick a model) to generate from your own prompts.
3. Try: *"a 60×40 mm bracket, 4 mm thick, with two 4 mm holes"*, then refine: *"make the holes 5 mm and add a 20 mm wall on one edge."*

`npm run build` typechecks and produces a static bundle in `dist/`.

## Notes / limits

- Geometry is **primitive union + subtract** only (no fillets/lofts/sweeps) — enough to test the
  loop, not the full CAD vocabulary.
- Includes a **one-shot self-heal**: if the model's reply isn't valid JSON, it asks once more.
- STL is exported at the mesh tessellation of the primitives (cylinders are 64-sided).
- This folder is a throwaway prototype; it's separate from the eventual Phase-1 app.
