// Shared "this mesh is heavy" threshold. Lives alone so UI code (Workspace,
// preflight) can read it without pulling in print/simplify — whose meshoptimizer
// dependency (~150 kB, embedded wasm) now only loads when Simplify is clicked.
export const HEAVY_TRIANGLES = 1_000_000;
