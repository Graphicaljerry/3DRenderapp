import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import * as replicad from "replicad";
import { setOC } from "replicad";
import { expose } from "comlink";
import type { CadWorkerApi, WorkerBuildResult, ReplicadExportFormat, FaceMesh, WorkerOp } from "./workerMessages";

// ---- OCCT boot. locateFile MUST return the ?url import so emscripten fetches the hashed wasm. ----
let ocReady: Promise<void> | null = null;
let OCH: any = null; // kept to decode C++ exception pointers into real messages
function ensureOC(): Promise<void> {
  if (!ocReady) {
    ocReady = (async () => {
      const OC = await opencascade({ locateFile: () => opencascadeWasm });
      OCH = OC;
      setOC(OC);
    })();
  }
  return ocReady;
}

/** OCCT C++ exceptions cross the wasm boundary as a bare pointer number ("8759440") —
    meaningless to the user AND to the AI repair loop that gets the message next. Pull
    the real exception text back out of the wasm heap when the build exposes it, and
    always explain the usual causes so a retry has something to act on. */
function kernelError(e: any): Error {
  const raw = String(e?.message ?? e).trim();
  if (!/^\d+$/.test(raw)) return e instanceof Error ? e : new Error(raw);
  let occText = "";
  try {
    occText = String(OCH?.OCJS?.getStandard_FailureData?.(e)?.GetMessageString?.() ?? "");
  } catch { /* decoding is best-effort */ }
  return new Error(
    `the CAD kernel rejected this geometry${occText ? ` (${occText})` : ""} — usually a fillet/chamfer radius larger than its edge can take, a boolean between shapes that only touch instead of overlap, a shell/offset thicker than the wall, or a self-intersecting sketch. Use smaller radii/sizes or build that feature a different way.`,
  );
}

const MESH_OPTS = { tolerance: 0.05, angularTolerance: 0.3 };
// Live-drag previews trade a little surface fidelity for rebuild speed.
const MESH_OPTS_COARSE = { tolerance: 0.2, angularTolerance: 0.6 };

/**
 * Some models emit a stray `let main;` / `var main;` alongside `function main(...)`
 * — an instant "Identifier 'main' has already been declared". Strip the bare
 * re-declaration when a function main exists.
 */
function sanitize(code: string): string {
  if (/function\s+main\s*\(/.test(code)) {
    code = code.replace(/^\s*(?:let|var|const)\s+main\s*;?\s*$/gm, "");
  }
  return code;
}

// The user's imported CAD solid (STEP), held for the worker's lifetime and
// passed to main() as its third argument so code can modify it directly.
let importedShape: any = null;

// The picked point comes from the tessellated mesh, so on a CURVED edge/face it sits on the
// chord and deviates from the true B-rep surface by up to the mesh tolerance (~0.05 mm).
// replicad's containsPoint uses a 1e-6 mm (nanometre) tolerance, which rejects those points —
// so direct ops failed on any rounded geometry. Match within a small distance instead. The
// tolerance is a few× the mesh deviation, still far below the wall spacing on real parts.
const PICK_TOL = 0.25;

/** Run a finder, treating replicad's throw-on-no/ambiguous-match as "not found". */
function tryFind(f: () => any): any {
  try { return f() ?? null; } catch { return null; }
}

/** Largest size (mm) at which `attempt` succeeds, found by bisection below the size that
 *  failed. OCCT gives no analytic bound for a feasible fillet/chamfer radius — the fillet
 *  surface must fit the neighbouring faces — so probing is the only honest answer. ~8
 *  probes resolve to ~2% and run only on the failure path, never on a clean apply. */
function probeMaxSize(failedSize: number, attempt: (size: number) => any): number | null {
  let lo = 0; // largest size known to work
  let hi = failedSize; // smallest size known to fail
  for (let i = 0; i < 8 && hi - lo > Math.max(0.05, failedSize * 0.02); i++) {
    const mid = (lo + hi) / 2;
    try { attempt(mid); lo = mid; } catch { hi = mid; }
  }
  // Snap DOWN to a friendly 0.1 mm step, and shave a hair off the boundary — a size that
  // barely succeeded in the probe can still fail inside a longer op chain.
  const max = Math.floor(lo * 0.98 * 10) / 10;
  return max >= 0.1 ? max : null;
}

/** Apply ONE direct op to a shape — all local, no AI.
 *  edge/corner: fillet/chamfer every edge through the point.
 *  face-fillet/chamfer: round/bevel all edges bounding the face at the point.
 *  extrude: push the face out (+) or in (−) by the distance. */
function applyOneOp(shape: any, op: WorkerOp, probeLimit = true): any {
  const R: any = replicad;
  // The size-attempt closure for this op, if it has a size that can be probed for a max.
  let attempt: ((size: number) => any) | null = null;
  try {
    // Whole-body rigid transforms (gizmo). Cheap gp_Trsf, no re-triangulation.
    // TRANSFORMS DELETE THEIR SOURCE in replicad (translate/rotate/scale call
    // this.delete()) — but `shape` here is a CACHED base/intermediate that later
    // rebuilds and exports reuse. Clone first or the cache holds a dead object and
    // the next use fails with "This object has been deleted".
    if (op.type === "translate") return shape.clone().translate(op.delta);
    if (op.type === "rotate") return shape.clone().rotate(op.angleDeg, op.center, op.axis); // angle in DEGREES
    if (op.type === "scale") return shape.clone().scale(op.factor, op.center); // uniform only
    if (op.type === "chamferBottom") {
      // Elephant-foot guard: chamfer every edge of the bed-contact loop (z = zmin),
      // so the squished first layer doesn't bulge past the true footprint and
      // bed-adjacent holes keep their size. Selection samples the edge CURVE
      // (start/mid/end z) — exact geometry. Bounding boxes are useless here: once a
      // shape has been meshed, OCCT pads every bbox by the mesh deflection (~0.05 mm),
      // and EdgeFinder.inPlane misses filleted/spline outlines on real parts.
      let minZ = Infinity;
      for (const ed of shape.edges) {
        try { minZ = Math.min(minZ, ed.startPoint.z, ed.endPoint.z); } catch { /* skip odd edges */ }
      }
      if (!isFinite(minZ)) throw new Error("couldn't find the bottom of the part");
      const onBed = (edge: any) => {
        try {
          const a = edge.startPoint.z, b = edge.endPoint.z, m = edge.pointAt(0.5).z;
          const lo = Math.min(a, b, m), hi = Math.max(a, b, m);
          return hi - lo < 0.02 && Math.abs(lo - minZ) < 0.1; // flat in z AND at the bottom
        } catch {
          return false;
        }
      };
      attempt = (size) => shape.chamfer(size, (e: any) => e.when(({ element }: any) => onBed(element)));
      return attempt(op.size);
    }
    if (op.type === "fillet" || op.type === "chamfer") {
      const filter = (e: any) => e.withinDistance(PICK_TOL, op.at);
      attempt = (size) => (op.type === "fillet" ? shape.fillet(size, filter) : shape.chamfer(size, filter));
      return attempt(op.size);
    }
    if (op.type === "hole") {
      // Drill along −normal from 1 mm proud of the face (clean entry). depth 0 = through:
      // longer than any printable part, so it exits the far side no matter the shape.
      const n = op.normal;
      const len = op.depth > 0 ? op.depth + 1 : 2000;
      const start: [number, number, number] = [op.at[0] + n[0], op.at[1] + n[1], op.at[2] + n[2]];
      const drill = R.makeCylinder(op.diameter / 2, len, start, [-n[0], -n[1], -n[2]]);
      return shape.cut(drill);
    }
    // Faces: exact hit first (flat faces land dead-on). containsPoint works at nanometre
    // tolerance, and replicad's unique:true THROWS (rather than returning null) when it
    // misses — so each lookup is wrapped, or the tolerant fallbacks would never run and
    // every curved-face op would die with "Finder has not found a unique solution".
    const face =
      tryFind(() => new R.FaceFinder().containsPoint(op.at).find(shape, { unique: true })) ??
      tryFind(() => new R.FaceFinder().withinDistance(PICK_TOL, op.at).find(shape, { unique: true })) ??
      tryFind(() => new R.FaceFinder().withinDistance(PICK_TOL, op.at).find(shape)[0]); // several this close → take the hit
    if (!face) throw new Error("couldn't resolve the face at that point");
    if (op.type === "extrude") {
      // Extrude the face (holes preserved) along its outward normal by the distance;
      // positive fuses (push out), negative cuts (pull in).
      const extrude = (size: number) => {
        const vec = face.normalAt(op.at).normalized().multiply(size);
        const prism = R.basicFaceExtrusion(face, vec);
        return size >= 0 ? shape.fuse(prism) : shape.cut(prism);
      };
      // A cut deeper than the part can't work; probing for the max recess still can.
      if (op.size < 0) attempt = (size) => extrude(-size);
      return extrude(op.size);
    }
    const inFace = (e: any) => e.inPlane(R.makePlaneFromFace(face));
    attempt = (size) => (op.type === "face-fillet" ? shape.fillet(size, inFace) : shape.chamfer(size, inFace));
    return attempt(op.size);
  } catch (e: any) {
    // OCCT failures often surface as a bare exception pointer ("11389816") — meaningless
    // to users. Translate those to plain language; keep real messages verbatim.
    const raw = String(e?.message ?? e).trim();
    const detail = /^\d+$/.test(raw) ? "the size is too large for this geometry" : raw;
    let label: string;
    switch (op.type) {
      case "translate": label = "Move"; break;
      case "rotate": label = `Rotate of ${op.angleDeg}°`; break;
      case "scale": label = `Scale ×${op.factor}`; break;
      case "chamferBottom": label = `Bottom-edge chamfer of ${op.size} mm`; break;
      case "extrude": label = `Extrude of ${op.size} mm`; break;
      case "hole": label = `⌀${op.diameter} mm hole`; break;
      default: label = `${op.type.includes("chamfer") ? "Chamfer" : "Fillet"} of ${op.size} mm`;
    }
    // Sized op that OCCT rejected → find the real limit so the app can say it (and
    // auto-apply it) instead of the old shrug "try a smaller amount". Skipped for live
    // drag previews (probeLimit=false) — probing every over-limit tick would kill the drag.
    const sized = probeLimit && attempt && Math.abs((op as any).size) > 0;
    if (sized) {
      const max = probeMaxSize(Math.abs((op as any).size), attempt!);
      if (max) throw new Error(`${label} doesn't fit here — the most this spot allows is about ${max} mm. (max=${max})`);
    }
    throw new Error(`${label} didn't apply here — try a smaller amount or a different spot. (${detail})`);
  }
}

// ---- Compile untrusted LLM code at global scope; shadow ambient globals. ----
// Returns the BASE shape from running the program (no direct ops applied).
function runCode(rawCode: string, params?: Record<string, number>): any {
  const code = sanitize(rawCode);
  // Do NOT pre-declare `main` — the user's code defines `function main(...)`, and a
  // `let main` here collides ("Identifier 'main' has already been declared").
  const factory = new Function(
    "replicad",
    "self",
    "globalThis",
    "window",
    "fetch",
    "importScripts",
    "XMLHttpRequest",
    `"use strict";\n${code}\n;\nreturn (typeof main !== "undefined") ? main : undefined;`,
  );
  const mainFn = factory(Object.freeze({ ...replicad }), undefined, undefined, undefined, undefined, undefined, undefined);
  if (typeof mainFn !== "function") {
    throw new Error("Your code must define `function main(replicad, params) { ... }` returning a Shape.");
  }
  // NOTE: the imported shape is passed unfrozen — replicad shapes carry internal caches.
  // A CLONE goes in: user code may translate/rotate it, and replicad transforms delete
  // their source — the held original must survive for the next rebuild.
  const out = mainFn(Object.freeze({ ...replicad }), Object.freeze({ ...(params ?? {}) }), importedShape?.clone() ?? undefined);
  const shape = out?.shape ?? out;
  if (!shape || typeof shape.mesh !== "function") {
    throw new Error("main() must return a replicad Shape (a Solid).");
  }
  return shape;
}

// Cache the base (code+params) shape and every intermediate of the last op-chain, so a
// changed/added op only recomputes from where the chains diverge — the big cost for
// stacked fillet/chamfer/extrude on a complex model. Intermediates make live drag
// previews cheap: [prior ops..., tentative op] shares the whole prior chain, so each
// preview tick costs exactly ONE op. importGen invalidates the cache when the imported
// STEP solid changes.
let importGen = 0;
let baseCache: { key: string; shape: any } | null = null;
let opCache: { key: string; ops: WorkerOp[]; shapes: any[] } | null = null; // shapes[i] = base + ops[0..i]
const baseKey = (code: string, params?: Record<string, number>) => `${importGen} ${code} ${JSON.stringify(params ?? {})}`;

/** Build the final shape for (code, params, ops), reusing cached work where possible. */
function buildShape(code: string, params: Record<string, number> | undefined, ops?: WorkerOp[], probeLimit = true): any {
  const key = baseKey(code, params);
  const opsArr = ops ?? [];
  const base = baseCache && baseCache.key === key ? baseCache.shape : (baseCache = { key, shape: runCode(code, params) }).shape;
  // Longest shared prefix with the cached chain → start from its intermediate shape.
  let start = 0;
  let shapes: any[] = [];
  if (opCache && opCache.key === key) {
    const cached = opCache;
    while (start < cached.ops.length && start < opsArr.length && JSON.stringify(cached.ops[start]) === JSON.stringify(opsArr[start])) start++;
    shapes = cached.shapes.slice(0, start);
  }
  let s = start > 0 ? shapes[start - 1] : base;
  for (let i = start; i < opsArr.length; i++) {
    s = applyOneOp(s, opsArr[i], probeLimit);
    shapes.push(s);
  }
  opCache = { key, ops: opsArr.slice(), shapes };
  return s;
}

/** Drop min-z to 0 (sit on the bed), preserving XY — matches the display's Z-only recentre so an
 *  exported STL/STEP sits where the viewer shows it (matters after a gizmo rotate or move).
 *  MUST clone: replicad's translate() deletes its source, and `shape` is the build cache —
 *  without the clone the FIRST export killed the cache and every later export failed with
 *  "This object has been deleted" (a real user hit this exporting STL then STEP). */
function dropToBed(shape: any): any {
  try {
    const bb = shape.boundingBox;
    const [min] = bb.bounds as [number[], number[]];
    return shape.clone().translate([0, 0, -min[2]]);
  } catch {
    return shape; // unusual bbox API? export as-authored
  }
}

function dimsOf(shape: any): { x: number; y: number; z: number } {
  const bb = shape.boundingBox;
  const min = bb?.bounds?.[0] ?? bb?.min ?? [0, 0, 0];
  const max = bb?.bounds?.[1] ?? bb?.max ?? [0, 0, 0];
  const r = (n: number) => Math.round(n * 10) / 10;
  return { x: r(max[0] - min[0]), y: r(max[1] - min[1]), z: r(max[2] - min[2]) };
}

const api: CadWorkerApi = {
  async init() {
    await ensureOC();
    return true;
  },

  /** Load a STEP (exact B-rep) or STL (mesh → faceted B-rep) file as a live solid;
   *  it becomes main()'s third argument. */
  async importShape(file: Blob, kind: "step" | "stl" = "step"): Promise<{ ok: boolean; error?: string }> {
    try {
      await ensureOC();
      const shape = kind === "stl" ? await (replicad as any).importSTL(file) : await (replicad as any).importSTEP(file);
      // Normalize to our convention: centred on XY, sitting on the bed (z=0).
      try {
        const bb = shape.boundingBox;
        const [min, max] = bb.bounds as [number[], number[]];
        importedShape = shape.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]]);
      } catch {
        importedShape = shape; // unusual bbox API? keep as-authored coordinates
      }
      importGen++; // invalidate any cached shape built against the old import
      return { ok: true };
    } catch (e: any) {
      importedShape = null;
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  async clearImport(): Promise<void> {
    importedShape = null;
    importGen++; // invalidate any cached shape built against the cleared import
  },

  async build(code: string, params?: Record<string, number>, ops?: WorkerOp[], opts?: { probeLimit?: boolean; coarse?: boolean }): Promise<WorkerBuildResult> {
    try {
      await ensureOC();
      const shape = buildShape(code, params, ops, opts?.probeLimit !== false);
      // NOTE: no meshEdges() here — the viewer derives its edge overlay from the face mesh
      // itself, so tessellating the B-rep edges on every build was pure wasted time.
      // Live-drag previews mesh coarser (the commit re-meshes at full quality).
      const faces = shape.mesh(opts?.coarse ? MESH_OPTS_COARSE : MESH_OPTS) as FaceMesh;
      const dims = dimsOf(shape);
      return { ok: true, faces, dims };
    } catch (e: any) {
      const err = kernelError(e);
      return {
        ok: false,
        error: {
          name: err.name,
          message: err.message,
          stack: String(e?.stack ?? ""),
        },
      };
    }
  },

  async exportBlob(code: string, format: ReplicadExportFormat, params?: Record<string, number>, ops?: WorkerOp[]): Promise<Blob> {
    await ensureOC();
    try {
      const shape = dropToBed(buildShape(code, params, ops));
      return format === "step"
        ? shape.blobSTEP()
        : shape.blobSTL({ tolerance: 0.01, angularTolerance: 0.1, binary: true });
    } catch (e) {
      throw kernelError(e); // a raw pointer number would otherwise cross comlink verbatim
    }
  },
};

expose(api);
