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

/** Apply the user's direct fillet/chamfer ops to a built shape. `containsPoint`
 *  matches every edge through the target point, so an edge midpoint rounds that edge
 *  and a corner vertex rounds all edges meeting there. Each op reports its own error. */
function applyOps(shape: any, ops?: WorkerOp[]): any {
  let s = shape;
  for (const op of ops ?? []) {
    try {
      const filter = (e: any) => e.containsPoint(op.at);
      s = op.type === "fillet" ? s.fillet(op.size, filter) : s.chamfer(op.size, filter);
    } catch (e: any) {
      const kind = op.type === "fillet" ? "Fillet" : "Chamfer";
      throw new Error(`${kind} of ${op.size} mm didn't apply here — try a smaller size or a different edge. (${String(e?.message ?? e)})`);
    }
  }
  return s;
}

// ---- Compile untrusted LLM code at global scope; shadow ambient globals. ----
function runToShape(rawCode: string, params?: Record<string, number>, ops?: WorkerOp[]): any {
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
  return applyOps(shape, ops);
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
      return { ok: true };
    } catch (e: any) {
      importedShape = null;
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  async clearImport(): Promise<void> {
    importedShape = null;
  },

  async build(code: string, params?: Record<string, number>, ops?: WorkerOp[]): Promise<WorkerBuildResult> {
    try {
      await ensureOC();
      const shape = runToShape(code, params, ops);
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
    const shape = runToShape(code, params, ops);
    return format === "step"
      ? shape.blobSTEP()
      : shape.blobSTL({ tolerance: 0.01, angularTolerance: 0.1, binary: true });
  },
};

expose(api);
