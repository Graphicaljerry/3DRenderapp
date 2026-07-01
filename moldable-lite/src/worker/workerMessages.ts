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

export interface CadWorkerApi {
  init(): Promise<boolean>;
  build(code: string): Promise<WorkerBuildResult>;
  exportBlob(code: string, format: ReplicadExportFormat): Promise<Blob>;
}
