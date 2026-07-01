import type * as THREE from "three";
import type { ModelSpec } from "../cad/spec";

export type EngineKind = "replicad" | "primitive";
export type ExportFormat = "stl" | "3mf" | "step" | "obj";

// What the LLM produced and we hand the engine to build.
export type BuildInput =
  | { kind: "code"; code: string }
  | { kind: "spec"; spec: ModelSpec };

export interface EngineResult {
  kind: EngineKind;
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  source: BuildInput;
  supportsStep: boolean;
}

export interface Engine {
  readonly kind: EngineKind;
  readonly ready: boolean;
  build(input: BuildInput): Promise<EngineResult>;
  canExport(format: ExportFormat): boolean;
  export(result: EngineResult, format: ExportFormat): Promise<Blob>;
}
