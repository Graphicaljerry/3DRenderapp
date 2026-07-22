import type { CadOp } from "../engine/types";

export type StoredEngineKind = "replicad" | "primitive" | "generative";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  image?: string; // reference-photo thumbnail (data URL)
}

export interface Pin {
  id: string;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  text: string;
}

export interface GenSource {
  provider: string;
  model: string;
  prompt?: string;
}

export interface Version {
  id: string;
  createdAt: number;
  summary: string;
  engine: StoredEngineKind;
  code?: string; // replicad source at this snapshot
  params?: Record<string, number>; // slider overrides applied to the code
  ops?: CadOp[]; // direct fillet/chamfer ops applied on top of the code
  spec?: unknown; // primitive spec at this snapshot
  dims?: { x: number; y: number; z: number };
  glb?: Blob; // generative mesh at this snapshot (so it re-renders without re-calling the API)
  meshXform?: number[]; // baked transform (Matrix4 elements) applied over glb on load — scale/rotate survive reopen without re-encoding the textured glb
  importFile?: Blob; // imported STEP/STL the code's `imported` argument refers to
  importKind?: "step" | "stl"; // how importFile parses — STL-as-CAD imports must NOT be re-read as STEP on undo/reopen
  genSource?: GenSource;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  engine: StoredEngineKind;
  code?: string; // HEAD replicad source
  params?: Record<string, number>; // HEAD slider overrides
  ops?: CadOp[]; // HEAD direct fillet/chamfer ops
  spec?: unknown; // HEAD primitive spec
  glb?: Blob; // HEAD generative mesh
  meshXform?: number[]; // HEAD baked mesh transform (see Version.meshXform)
  importFile?: Blob; // HEAD imported STEP/STL (the `imported` arg for the code)
  importKind?: "step" | "stl"; // HEAD import parser kind (see Version.importKind)
  thumb?: string; // small rendered preview of the current model (webp/png data URL), refreshed on each change
  thumbV?: number; // thumbnail style version — the library regenerates thumbs older than the current look
  folder?: string; // library folder name (flat, user-defined); unset = unfiled
  pins?: Pin[]; // spatial notes / AI-edit markers on the model
  plates?: { count: number; of: Record<string, number>; names?: Record<number, string> }; // build plates: how many, which object prints where, user labels
  genSource?: GenSource;
  chat?: ChatTurn[];
  versions: Version[]; // append-only, oldest -> newest
  headId?: string; // which version the HEAD (live) fields mirror; enables undo/redo over `versions`
}

export interface Backend {
  put(p: Project): Promise<void>;
  get(id: string): Promise<Project | undefined>;
  all(): Promise<Project[]>;
  del(id: string): Promise<void>;
}
