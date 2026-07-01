export type StoredEngineKind = "replicad" | "primitive";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}

export interface Version {
  id: string;
  createdAt: number;
  summary: string;
  engine: StoredEngineKind;
  code?: string; // replicad source at this snapshot
  spec?: unknown; // primitive spec at this snapshot
  dims?: { x: number; y: number; z: number };
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  engine: StoredEngineKind;
  code?: string; // HEAD replicad source
  spec?: unknown; // HEAD primitive spec
  chat?: ChatTurn[];
  versions: Version[]; // append-only, oldest -> newest
}

export interface Backend {
  put(p: Project): Promise<void>;
  get(id: string): Promise<Project | undefined>;
  all(): Promise<Project[]>;
  del(id: string): Promise<void>;
}
