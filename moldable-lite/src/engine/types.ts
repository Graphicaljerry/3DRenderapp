import type * as THREE from "three";
import type { ModelSpec } from "../cad/spec";

export type EngineKind = "replicad" | "primitive" | "generative";
export type ExportFormat = "stl" | "3mf" | "step" | "obj";

// A direct, client-side geometry op the user applies to a picked edge/corner —
// computed by replicad in the worker with NO LLM/API call. `at` is the target point
// (an edge's midpoint, or a corner's vertex): fillet/chamfer hits every edge through it.
export interface CadOp {
  type: "fillet" | "chamfer";
  at: [number, number, number];
  size: number; // fillet radius / chamfer size, mm
}

// What we hand the engine to build. `code`/`spec` come from the LLM; `gen` is a
// generative-mesh request (photo and/or text) routed to a 3D provider.
export type BuildInput =
  | { kind: "code"; code: string; params?: Record<string, number>; ops?: CadOp[] }
  | { kind: "spec"; spec: ModelSpec }
  | { kind: "gen"; image?: Blob; views?: MultiViews; prompt?: string; provider: string; model: string };

/** Extra reference angles (the primary photo is the "front") — used by multi-view engines. */
export interface MultiViews {
  left?: Blob;
  back?: Blob;
  right?: Blob;
}

export interface EngineResult {
  kind: EngineKind;
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  source: BuildInput;
  supportsStep: boolean;
  glb?: Blob; // present for generative results (for persistence + re-render)
  recenter?: [number, number, number]; // display was shifted by this from the engine's own coords
}

export interface Engine {
  readonly kind: EngineKind;
  readonly ready: boolean;
  build(input: BuildInput): Promise<EngineResult>;
  canExport(format: ExportFormat): boolean;
  export(result: EngineResult, format: ExportFormat): Promise<Blob>;
  /** CAD engines only: load a STEP file as the live `imported` solid (null clears). */
  setImport?(file: Blob | null): Promise<void>;
}
