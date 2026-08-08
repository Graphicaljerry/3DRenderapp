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
  thumb?: string; // mini canvas capture (data URL) of the model as it looked when this version landed
  /** Split-to-fit-bed metadata: the merged mesh concatenates the pieces in order, so
   *  [vertex count, colour, dims] per piece is enough to reconstruct the per-piece
   *  export list after undo/redo/reopen without re-running the CSG. */
  splitPieces?: { n: number; color: string; dims: { x: number; y: number; z: number }; plate?: number }[];
  /** Surface pattern/texture live at this snapshot. The treatment is a SPEC — the
   *  displaced mesh recomputes from it — so undo/redo/restore replay the exact surface
   *  each version had, and applying one is itself an undoable step. Absent = plain. */
  surfFx?: { pattern: SurfFxSnap | null; texture: SurfFxSnap | null };
  /** Logo layers standing on the model at this snapshot. Same trick as `texts`: what
   *  is stored is the OUTLINE the solid was extruded from, not the solid, so a reload
   *  rebuilds the identical mesh from a few kilobytes of path data. */
  logos?: LogoLayerSnap[];
  /** Per-object fill colour at this snapshot, so recolouring a layer is a step you can
   *  take back like any other. Absent on versions recorded before colours were tracked;
   *  those restore whatever is already on screen rather than clearing it. */
  partColors?: Record<string, string>;
  /** Text layers standing on the model at this snapshot. Stored as SPECS, not meshes:
   *  the words plus a pose rebuild the same solid exactly, which is why a text layer
   *  can survive a reload and take part in undo at all. Absent = no text. */
  texts?: TextLayerSnap[];
}

/** One placed text layer, storable. The spec half mirrors TextSpec — declared
 *  structurally because the store must not import engine or text types. */
export interface TextLayerSnap {
  id: string;
  spec: { text: string; family: string; custom?: boolean; size: number; depth: number; bevel: number; spacing: number; roll: number; wrap?: boolean };
  at: [number, number, number];
  quat: [number, number, number, number];
  /** Uniform scale from the gizmo; absent means 1. */
  scale?: number;
  /** Radius of the wall the solid is wrapped around, mm. Absent = flat, which is what a
   *  flat face reports — so only text on a curved body carries it. */
  bend?: number;
}

/** One placed logo layer, storable. `svg` is the outline source — the file as uploaded
 *  when it was an SVG, or the traced outline when it was a PNG/JPG — so the rebuild
 *  never re-runs the tracer and can never come back looking different. */
export interface LogoLayerSnap {
  id: string;
  name: string;
  svg: string;
  sizeMm: number;
  heightMm: number;
  at?: [number, number, number];
  quat?: [number, number, number, number];
  scale?: number;
}

/** One surface treatment, storable: which pattern, its pitch, its relief (negative =
 *  carved). Structural twin of the engine's SurfFxSlot — the store must not import
 *  engine types. */
export interface SurfFxSnap { kind: string; scale: number; depth: number }

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
  cloudMesh?: { hash: string; src: "glb" | "import" }; // the account's Storage bucket holds the HEAD mesh (sha-256 of the raw bytes) — other devices fetch it on pull
  meshXform?: number[]; // HEAD baked mesh transform (see Version.meshXform)
  importFile?: Blob; // HEAD imported STEP/STL (the `imported` arg for the code)
  importKind?: "step" | "stl"; // HEAD import parser kind (see Version.importKind)
  thumb?: string; // small rendered preview of the current model (webp/png data URL), refreshed on each change
  thumbV?: number; // thumbnail style version — the library regenerates thumbs older than the current look
  folder?: string; // library folder name (flat, user-defined); unset = unfiled
  pins?: Pin[]; // spatial notes / AI-edit markers on the model
  plates?: { count: number; of: Record<string, number>; names?: Record<number, string> }; // build plates: how many, which object prints where, user labels
  partColors?: Record<string, string>; // per-object fill colour (objectId → hex): "model" + attachment ids. Exported as filament slots so Bambu/Orca pre-assign each part.
  facePaint?: { count: number; b64: string }; // per-face MMU paint on the model: base64 of a per-triangle palette-index Uint8Array (count guards against a reshaped mesh). Exported as 3MF paint_color.
  genSource?: GenSource;
  chat?: ChatTurn[];
  versions: Version[]; // append-only, oldest -> newest
  headId?: string; // which version the HEAD (live) fields mirror; enables undo/redo over `versions`
  /** Which running copy of the app last wrote this record. Not an identity or a device —
   *  just "was it me". A second tab, a second browser, or the sync cycle writing a copy
   *  it pulled down all leave a different mark here, and that is the signal to MERGE the
   *  two histories instead of overwriting one with the other. See store/merge.ts. */
  writerId?: string;
}

export interface Backend {
  put(p: Project): Promise<void>;
  get(id: string): Promise<Project | undefined>;
  all(): Promise<Project[]>;
  del(id: string): Promise<void>;
}
