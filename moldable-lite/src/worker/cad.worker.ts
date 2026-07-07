import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import * as replicad from "replicad";
import { setOC } from "replicad";
import { expose } from "comlink";
import type { CadWorkerApi, WorkerBuildResult, ReplicadExportFormat, FaceMesh, EdgeMesh, WorkerOp } from "./workerMessages";

// ---- OCCT boot. locateFile MUST return the ?url import so emscripten fetches the hashed wasm. ----
let ocReady: Promise<void> | null = null;
function ensureOC(): Promise<void> {
  if (!ocReady) {
    ocReady = (async () => {
      const OC = await opencascade({ locateFile: () => opencascadeWasm });
      setOC(OC);
    })();
  }
  return ocReady;
}

const MESH_OPTS = { tolerance: 0.05, angularTolerance: 0.3 };

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

/** Apply ONE direct op to a shape — all local, no AI.
 *  edge/corner: fillet/chamfer every edge through the point.
 *  face-fillet/chamfer: round/bevel all edges bounding the face at the point.
 *  extrude: push the face out (+) or in (−) by the distance. */
function applyOneOp(shape: any, op: WorkerOp): any {
  const R: any = replicad;
  try {
    // Whole-body rigid transforms (gizmo). Cheap gp_Trsf, no re-triangulation.
    if (op.type === "translate") return shape.translate(op.delta);
    if (op.type === "rotate") return shape.rotate(op.angleDeg, op.center, op.axis); // angle in DEGREES
    if (op.type === "scale") return shape.scale(op.factor, op.center); // uniform only
    if (op.type === "fillet" || op.type === "chamfer") {
      const filter = (e: any) => e.withinDistance(PICK_TOL, op.at);
      return op.type === "fillet" ? shape.fillet(op.size, filter) : shape.chamfer(op.size, filter);
    }
    // Faces: exact hit first (flat faces land dead-on); fall back to nearest within tolerance
    // so a point on a curved face still resolves. unique:true keeps it to a single face.
    const findFace = () =>
      new R.FaceFinder().containsPoint(op.at).find(shape, { unique: true }) ||
      new R.FaceFinder().withinDistance(PICK_TOL, op.at).find(shape, { unique: true });
    const face = findFace();
    if (!face) throw new Error("couldn't resolve the face at that point");
    if (op.type === "extrude") {
      // Extrude the face (holes preserved) along its outward normal by the distance;
      // positive fuses (push out), negative cuts (pull in).
      const vec = face.normalAt(op.at).normalized().multiply(op.size);
      const prism = R.basicFaceExtrusion(face, vec);
      return op.size >= 0 ? shape.fuse(prism) : shape.cut(prism);
    }
    const inFace = (e: any) => e.inPlane(R.makePlaneFromFace(face));
    return op.type === "face-fillet" ? shape.fillet(op.size, inFace) : shape.chamfer(op.size, inFace);
  } catch (e: any) {
    const detail = String(e?.message ?? e);
    let label: string;
    switch (op.type) {
      case "translate": label = "Move"; break;
      case "rotate": label = `Rotate of ${op.angleDeg}°`; break;
      case "scale": label = `Scale ×${op.factor}`; break;
      case "extrude": label = `Extrude of ${op.size} mm`; break;
      default: label = `${op.type.includes("chamfer") ? "Chamfer" : "Fillet"} of ${op.size} mm`;
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
  const out = mainFn(Object.freeze({ ...replicad }), Object.freeze({ ...(params ?? {}) }), importedShape ?? undefined);
  const shape = out?.shape ?? out;
  if (!shape || typeof shape.mesh !== "function") {
    throw new Error("main() must return a replicad Shape (a Solid).");
  }
  return shape;
}

// Cache the base (code+params) shape and the last op-chain result, so applying one
// more direct op doesn't re-run the whole program + every prior op each time — the big
// cost for stacked fillet/chamfer/extrude on a complex model. importGen invalidates the
// cache when the imported STEP solid changes.
let importGen = 0;
let baseCache: { key: string; shape: any } | null = null;
let opCache: { key: string; ops: WorkerOp[]; shape: any } | null = null;
const baseKey = (code: string, params?: Record<string, number>) => `${importGen} ${code} ${JSON.stringify(params ?? {})}`;
const isPrefix = (a: WorkerOp[], b: WorkerOp[]) => a.length <= b.length && a.every((op, i) => JSON.stringify(op) === JSON.stringify(b[i]));

/** Build the final shape for (code, params, ops), reusing cached work where possible. */
function buildShape(code: string, params: Record<string, number> | undefined, ops?: WorkerOp[]): any {
  const key = baseKey(code, params);
  const opsArr = ops ?? [];
  // Fast path: same program + the op-chain only GREW → apply just the new ops.
  if (opCache && opCache.key === key && isPrefix(opCache.ops, opsArr)) {
    let s = opCache.shape;
    for (let i = opCache.ops.length; i < opsArr.length; i++) s = applyOneOp(s, opsArr[i]);
    opCache = { key, ops: opsArr.slice(), shape: s };
    return s;
  }
  // Otherwise reuse the base shape if the program is unchanged; only re-run code if needed.
  const base = baseCache && baseCache.key === key ? baseCache.shape : (baseCache = { key, shape: runCode(code, params) }).shape;
  let s = base;
  for (const op of opsArr) s = applyOneOp(s, op);
  opCache = { key, ops: opsArr.slice(), shape: s };
  return s;
}

/** Centre on XY and drop min-z to 0 — the same normalize the display does, so an exported
 *  STL/STEP sits on the bed matching the viewer (matters after a gizmo rotate reorients it). */
function dropToBed(shape: any): any {
  try {
    const bb = shape.boundingBox;
    const [min, max] = bb.bounds as [number[], number[]];
    return shape.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]]);
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

  /** Load a STEP file as a live solid; it becomes main()'s third argument. */
  async importShape(file: Blob): Promise<{ ok: boolean; error?: string }> {
    try {
      await ensureOC();
      const shape = await (replicad as any).importSTEP(file);
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

  async build(code: string, params?: Record<string, number>, ops?: WorkerOp[]): Promise<WorkerBuildResult> {
    try {
      await ensureOC();
      const shape = buildShape(code, params, ops);
      const faces = shape.mesh(MESH_OPTS) as FaceMesh;
      const edges = shape.meshEdges(MESH_OPTS) as EdgeMesh;
      const dims = dimsOf(shape);
      return { ok: true, faces, edges, dims };
    } catch (e: any) {
      return {
        ok: false,
        error: {
          name: e?.name ?? "Error",
          message: String(e?.message ?? e),
          stack: String(e?.stack ?? ""),
        },
      };
    }
  },

  async exportBlob(code: string, format: ReplicadExportFormat, params?: Record<string, number>, ops?: WorkerOp[]): Promise<Blob> {
    await ensureOC();
    const shape = dropToBed(buildShape(code, params, ops));
    return format === "step"
      ? shape.blobSTEP()
      : shape.blobSTL({ tolerance: 0.01, angularTolerance: 0.1, binary: true });
  },
};

expose(api);
