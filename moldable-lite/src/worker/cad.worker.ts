import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import * as replicad from "replicad";
import { setOC } from "replicad";
import { expose } from "comlink";
import type { CadWorkerApi, WorkerBuildResult, ReplicadExportFormat, FaceMesh, EdgeMesh } from "./workerMessages";

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

// ---- Compile untrusted LLM code at global scope; shadow ambient globals. ----
function runToShape(code: string, params?: Record<string, number>): any {
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
  const out = mainFn(Object.freeze({ ...replicad }), Object.freeze({ ...(params ?? {}) }));
  const shape = out?.shape ?? out;
  if (!shape || typeof shape.mesh !== "function") {
    throw new Error("main() must return a replicad Shape (a Solid).");
  }
  return shape;
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

  async build(code: string, params?: Record<string, number>): Promise<WorkerBuildResult> {
    try {
      await ensureOC();
      const shape = runToShape(code, params);
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

  async exportBlob(code: string, format: ReplicadExportFormat, params?: Record<string, number>): Promise<Blob> {
    await ensureOC();
    const shape = runToShape(code, params);
    return format === "step"
      ? shape.blobSTEP()
      : shape.blobSTL({ tolerance: 0.01, angularTolerance: 0.1, binary: true });
  },
};

expose(api);
