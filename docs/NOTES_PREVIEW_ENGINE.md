# Engineering notes — the dual-kernel live-preview pipeline

*Last updated: July 2026 (PR #62). Code: `moldable-lite/src/worker/preview.worker.ts`,
`engine/previewEngine.ts`, `worker/cad.worker.ts`, `components/Viewer.tsx` (`buildSolidPrism`),
`App.tsx` (`previewDirectOp`).*

## The problem

Direct edits (drag the blue arrow to extrude a face or round an edge) should update the model
**while dragging**, Shapr3D-style. But our source-of-truth kernel is OpenCascade (OCCT/replicad,
WASM): correct, feature-complete (fillets, STEP), and too slow to rebuild+remesh a whole op chain
at pointer-move rates on heavy models.

Commercial apps dodge this with kernels we can't embed (Shapr3D runs Parasolid) or by not being
B-rep CAD at all (Spline is mesh/SDF modeling — smooth, but no real fillets or STEP).

## The architecture

Two kernels, strict roles:

| | kernel | when | cost/tick |
|---|---|---|---|
| Extrude drag preview | **Manifold** (mesh booleans, WASM, own worker) | every snapped pointer move | ~2–20 ms |
| Fillet drag preview | **OCCT** (CAD worker, cached op chain, coarse mesh) | every snapped pointer move | ~25–50 ms + mesh |
| Commit (release / typed mm / AI edit) | **OCCT** | once | full quality |

**OCCT remains the only source of truth.** The Manifold worker never feeds exports, history, or
printability — it only paints preview frames. On release the same distance commits as a parametric
op through the CAD worker exactly as before, and the real tessellation replaces the preview.

## How the extrude preview works

1. **Drag start** (`Viewer.onDown`): the selected face's triangles (`cap`) and boundary edges
   (`bnd`, via `faceBoundary`) are captured once.
2. **Each tick** (`Viewer.onMove` → `buildSolidPrism`): a **closed prism** is built from pure
   array math — offset cap (top) + swept walls + reversed original cap (bottom).
   *Winding rules:* the cap keeps the model's outward winding; each boundary edge keeps its
   in-triangle order, which makes the walls face outward for a positive extrude; a negative
   (cut) extrude mirrors the solid, so every triangle is flipped to restore orientation.
3. **Boolean** (`preview.worker.ts`): the committed display mesh is loaded once per commit as the
   boolean base (`Mesh.merge()` welds the tessellation's duplicated per-face vertices; the
   `Manifold` constructor rejects anything that isn't a closed solid). Each tick is then a single
   `base.add(prism)` / `base.subtract(prism)`; the result returns as a triangle soup
   (transferable), and `computeVertexNormals` on soup gives flat per-face normals — the CAD look.
4. Coordinates are display coords end-to-end — no recentring drift during the drag.

## The fallback ladder

Every step degrades gracefully; a user should never see a hard failure mid-drag:

1. Manifold can't weld the base (open/degenerate mesh) → that geometry is remembered as dead,
   OCCT preview path used instead.
2. A single boolean tick fails → keep the last good frame; try the next tick.
3. OCCT preview tick fails (dragged past the feasible size) → keep the last good frame.
4. Commit fails at a size OCCT rejects → the worker **bisects for the max size that fits**
   (~8 probes, failure path only), applies it, and the chat states both numbers.
5. Release at ~0 / pointercancel / failed commit → the committed model is restored.

## Supporting changes that make previews cheap

- The CAD worker's op cache stores **every intermediate shape** of the last chain
  (`buildShape`), so `[prior ops…, tentative op]` re-runs exactly one op per tick — and undo
  (a chain prefix) is near-instant.
- Preview builds skip the limit probe (`probeLimit:false`) and mesh coarse
  (`tolerance 0.2` vs `0.05`); commits re-mesh at full quality.
- The worker's `meshEdges()` call was removed outright — its output had no consumers.
- The viewer skips its main-thread `EdgesGeometry` crease-overlay pass for geometry tagged
  `userData.preview`; the overlay returns on commit.

## Measured (Playwright, real WASM, software GL container)

- Box base: weld OK from real OCCT tessellation; fuse **9 ms**, cut **2 ms**, exact bboxes.
- Filleted shell with cavity (≈case-like, 380 tris): weld OK, rim fuse **18 ms**.
- OCCT preview tick after a 3-op chain: **~25 ms** (vs ~200 ms replaying the chain).

## Known limits / future ideas

- Fillet/chamfer previews stay OCCT-bound — mesh booleans cannot round an edge. If fillet drags
  ever need more, the options are precomputing fillets at a few radii and morphing, or a GPU
  SDF-blend *visual* (non-committal) preview.
- The Manifold base rebuilds from scratch per commit (fine: one weld per commit). If models get
  very heavy (500k+ tris), pre-warm the base when the push arrow appears instead of on the
  first tick.
- `manifold-3d` is also the obvious engine if we ever want client-side mesh repair or
  boolean-based split-to-fit improvements on generative meshes.
