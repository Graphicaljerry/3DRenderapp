export type StoredEngineKind = "replicad" | "primitive" | "generative";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
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
  spec?: unknown; // primitive spec at this snapshot
  dims?: { x: number; y: number; z: number };
  glb?: Blob; // generative mesh at this snapshot (so it re-renders without re-calling the API)
  genSource?: GenSource;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  engine: StoredEngineKind;
  code?: string; // HEAD replicad source
  spec?: unknown; // HEAD primitive spec
  glb?: Blob; // HEAD generative mesh
  genSource?: GenSource;
  chat?: ChatTurn[];
  versions: Version[]; // append-only, oldest -> newest
}

export interface Backend {
  put(p: Project): Promise<void>;
  get(id: string): Promise<Project | undefined>;
  all(): Promise<Project[]>;
  del(id: string): Promise<void>;
}
