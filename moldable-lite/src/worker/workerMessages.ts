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
  edges: EdgeMesh;
  dims: { x: number; y: number; z: number };
}
export interface WorkerBuildErr {
  ok: false;
  error: { name: string; message: string; stack: string };
}
export type WorkerBuildResult = WorkerBuildOk | WorkerBuildErr;

export type ReplicadExportFormat = "stl" | "step";

// Direct client-side geometry op (fillet/chamfer a picked edge/corner), applied after
// the code builds. Mirrors CadOp in engine/types (kept local so the worker has no deps).
export interface WorkerOp {
  type: "fillet" | "chamfer" | "face-fillet" | "face-chamfer" | "extrude";
  at: [number, number, number];
  size: number;
}

export interface CadWorkerApi {
  init(): Promise<boolean>;
  importShape(file: Blob): Promise<{ ok: boolean; error?: string }>;
  clearImport(): Promise<void>;
  build(code: string, params?: Record<string, number>, ops?: WorkerOp[]): Promise<WorkerBuildResult>;
  exportBlob(code: string, format: ReplicadExportFormat, params?: Record<string, number>, ops?: WorkerOp[]): Promise<Blob>;
}
