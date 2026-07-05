import type * as THREE from "three";
import type { ModelSpec } from "../cad/spec";

export type EngineKind = "replicad" | "primitive" | "generative";
export type ExportFormat = "stl" | "3mf" | "step" | "obj";

// What we hand the engine to build. `code`/`spec` come from the LLM; `gen` is a
// generative-mesh request (photo and/or text) routed to a 3D provider.
export type BuildInput =
  | { kind: "code"; code: string; params?: Record<string, number> }
  | { kind: "spec"; spec: ModelSpec }
  | { kind: "gen"; image?: Blob; prompt?: string; provider: string; model: string };

export interface EngineResult {
  kind: EngineKind;
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  source: BuildInput;
  supportsStep: boolean;
  glb?: Blob; // present for generative results (for persistence + re-render)
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
