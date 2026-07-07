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
  importFile?: Blob; // imported STEP the code's `imported` argument refers to
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
  importFile?: Blob; // HEAD imported STEP (the `imported` arg for the code)
  thumb?: string; // small rendered preview of the current model (webp/png data URL), refreshed on each change
  pins?: Pin[]; // spatial notes / AI-edit markers on the model
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
