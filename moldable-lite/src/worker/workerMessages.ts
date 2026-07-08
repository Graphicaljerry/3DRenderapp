// Shapes that cross the worker boundary (structured-cloneable) + the comlink API.

export interface FaceMesh {
  vertices: number[];
  triangles: number[];
  normals?: number[];
  faceGroups?: { start: number; count: number; faceId: number }[];
}
export interface EdgeMesh {
  lines: number[];
  edgeGroups?: { start: number; count: number; edgeId: number }[];
}

export interface WorkerBuildOk {
  ok: true;
  faces: FaceMesh;
  dims: { x: number; y: number; z: number };
}
export interface WorkerBuildErr {
  ok: false;
  error: { name: string; message: string; stack: string };
}
export type WorkerBuildResult = WorkerBuildOk | WorkerBuildErr;

export type ReplicadExportFormat = "stl" | "step";

// Direct client-side geometry ops applied after the code builds. Mirrors CadOp in
// engine/types (kept local so the worker has no deps). Point-anchored fillet/chamfer/extrude
// plus whole-body transforms translate/rotate/scale authored by the gizmo.
type Vec3 = [number, number, number];
export type WorkerOp =
  | { type: "fillet" | "chamfer" | "face-fillet" | "face-chamfer" | "extrude"; at: Vec3; size: number }
  | { type: "translate"; delta: Vec3 }
  | { type: "rotate"; axis: Vec3; angleDeg: number; center: Vec3 }
  | { type: "scale"; factor: number; center: Vec3 };

export interface CadWorkerApi {
  init(): Promise<boolean>;
  importShape(file: Blob, kind?: "step" | "stl"): Promise<{ ok: boolean; error?: string }>;
  clearImport(): Promise<void>;
  build(code: string, params?: Record<string, number>, ops?: WorkerOp[], opts?: { probeLimit?: boolean; coarse?: boolean }): Promise<WorkerBuildResult>;
  exportBlob(code: string, format: ReplicadExportFormat, params?: Record<string, number>, ops?: WorkerOp[]): Promise<Blob>;
}
