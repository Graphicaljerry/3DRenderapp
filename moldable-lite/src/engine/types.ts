import type * as THREE from "three";
import type { ModelSpec } from "../cad/spec";

export type EngineKind = "replicad" | "primitive" | "generative";
export type ExportFormat = "stl" | "3mf" | "step" | "obj";

// A direct, client-side geometry op the user applies with NO LLM/API call — computed by
// replicad in the worker. Two families:
//  • point-anchored (fillet/chamfer/extrude): `at` is a point ON the target edge/corner/face.
//  • whole-body transforms (translate/rotate/scale): rigid moves of the entire solid, authored
//    by the transform gizmo. These preview instantly in three.js and commit as one op.
export type Vec3 = [number, number, number];

/** Point-anchored op on a picked edge/corner/face. */
export interface PointOp {
  type: "fillet" | "chamfer" | "face-fillet" | "face-chamfer" | "extrude";
  at: Vec3;
  size: number; // fillet radius / chamfer size / extrude distance (signed: +out, -in), mm
}
/** Drill a round hole into a face: at a point ON the face, along −normal.
 *  depth 0 = through everything; otherwise a flat-bottom pocket that deep. */
export interface HoleOp {
  type: "hole";
  at: Vec3;
  normal: Vec3; // face outward normal at the point (carried from the pick — no re-finding)
  diameter: number;
  depth: number;
}
/** Move the whole solid by a vector (engine coords; recenter-invariant). */
export interface TranslateOp {
  type: "translate";
  delta: Vec3;
}
/** Rotate the whole solid `angleDeg` degrees about an axis through `center` (engine coords). */
export interface RotateOp {
  type: "rotate";
  axis: Vec3;
  angleDeg: number;
  center: Vec3;
}
/** Uniformly scale the whole solid by `factor` about `center` (engine coords). */
export interface ScaleOp {
  type: "scale";
  factor: number;
  center: Vec3;
}
/** Elephant-foot guard: chamfer every edge lying in the bottom (bed) plane. */
export interface ChamferBottomOp {
  type: "chamferBottom";
  size: number; // chamfer distance, mm (0.2–0.5 typical)
}
export type CadOp = PointOp | HoleOp | TranslateOp | RotateOp | ScaleOp | ChamferBottomOp;

// What we hand the engine to build. `code`/`spec` come from the LLM; `gen` is a
// generative-mesh request (photo and/or text) routed to a 3D provider.
export type BuildInput =
  | { kind: "code"; code: string; params?: Record<string, number>; ops?: CadOp[]; preview?: boolean } // preview: live-drag rebuild — skip limit probing
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
  texture?: THREE.Texture; // baked color texture (AI meshes ship painted) — display only
  meshXform?: number[]; // cumulative baked transform (Matrix4, column-major) replayed over `glb` on reopen — keeps scale/rotate while the textured glb stays original
  recenter?: [number, number, number]; // display was shifted by this from the engine's own coords
}

export interface Engine {
  readonly kind: EngineKind;
  readonly ready: boolean;
  build(input: BuildInput): Promise<EngineResult>;
  canExport(format: ExportFormat): boolean;
  export(result: EngineResult, format: ExportFormat): Promise<Blob>;
  /** CAD engines only: load a STEP file as the live `imported` solid (null clears). */
  setImport?(file: Blob | null, kind?: "step" | "stl"): Promise<void>;
}
