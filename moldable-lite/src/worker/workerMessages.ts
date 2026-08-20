// Shapes that cross the worker boundary (structured-cloneable) + the comlink API.

/** What replicad's `shape.mesh()` hands back: boxed JS number arrays. */
export interface RawFaceMesh {
  vertices: number[];
  triangles: number[];
  normals?: number[];
  faceGroups?: { start: number; count: number; faceId: number }[];
}
/** What actually crosses the worker boundary. The boxed arrays above are repacked into
 *  typed arrays IN THE WORKER and their buffers transferred, so the main thread adopts
 *  the memory instead of copying it. Sending RawFaceMesh cost three full copies of every
 *  mesh — structured-clone of a boxed array (the expensive one, ~24 bytes/number), then
 *  Float32BufferAttribute's copy, then three's index conversion — on every build, every
 *  live-drag frame and every direct edit. */
export interface FaceMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
  normals?: Float32Array;
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
  | { type: "fillet" | "chamfer" | "face-fillet" | "face-chamfer" | "extrude"; at: Vec3; size: number; rel?: Vec3; dir?: Vec3; pick?: "edge" | "corner" | "face" }
  | { type: "hole"; at: Vec3; normal: Vec3; diameter: number; depth: number; tag?: string }
  | { type: "screw"; at: Vec3; normal: Vec3; minor: number; major: number; pitch: number; depth: number; countersink: number }
  | { type: "solid"; shape: "box" | "cylinder" | "sphere"; at: Vec3; size: Vec3; cut: boolean; axis?: "x" | "y" | "z" }
  | { type: "translate"; delta: Vec3 }
  | { type: "rotate"; axis: Vec3; angleDeg: number; center: Vec3 }
  | { type: "scale"; factor: number; center: Vec3 }
  | { type: "chamferBottom"; size: number }; // elephant-foot guard: chamfer all bed-plane edges

export interface CadWorkerApi {
  init(): Promise<boolean>;
  importShape(file: Blob, kind?: "step" | "stl"): Promise<{ ok: boolean; error?: string }>;
  clearImport(): Promise<void>;
  build(code: string, params?: Record<string, number>, ops?: WorkerOp[], opts?: { probeLimit?: boolean; coarse?: boolean }): Promise<WorkerBuildResult>;
  exportBlob(code: string, format: ReplicadExportFormat, params?: Record<string, number>, ops?: WorkerOp[]): Promise<Blob>;
}

/** The kernel's message when a compiled program has no top-level main(), and the test for
 *  it. Two callers outside the worker read this error and say something else about it —
 *  the chat, which is talking to someone who wrote no code, and the repair prompt, which
 *  has to tell the model what to send instead. Kept beside the wording so changing the
 *  sentence cannot leave either of them silently matching nothing. */
export const NO_MAIN_ERROR = "Your code must define `function main(replicad, params) { ... }` returning a Shape.";
export const isNoMainError = (msg: string): boolean => /must define `?function main/i.test(msg);
