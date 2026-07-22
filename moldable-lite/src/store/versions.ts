import type { Project, Version, StoredEngineKind, GenSource } from "./types";
import type { CadOp } from "../engine/types";
import { uid } from "../lib/id";

export interface Snapshot {
  engine: StoredEngineKind;
  summary: string;
  code?: string;
  params?: Record<string, number>;
  ops?: CadOp[];
  importFile?: Blob;
  importKind?: "step" | "stl";
  spec?: unknown;
  dims?: { x: number; y: number; z: number };
  glb?: Blob;
  meshXform?: number[];
  genSource?: GenSource;
}

/** Append a version capturing the new state AND advance HEAD to match. Pure.
 *  If HEAD isn't the newest version (i.e. the user undid and is now making a NEW edit),
 *  the "redo" branch after HEAD is discarded — the new edit becomes the fresh tip, so a
 *  later undo steps straight back to it instead of walking through stale future states. */
export function appendVersion(project: Project, snap: Snapshot): Project {
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    summary: snap.summary,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    ops: snap.ops,
    importFile: snap.importFile,
    importKind: snap.importKind,
    spec: snap.spec,
    dims: snap.dims,
    glb: snap.glb,
    meshXform: snap.meshXform,
    genSource: snap.genSource,
  };
  const kept = project.versions.slice(0, headIndex(project) + 1); // drop any redo branch past HEAD
  return {
    ...project,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    ops: snap.ops,
    importFile: snap.importFile,
    importKind: snap.importKind,
    spec: snap.spec,
    glb: snap.glb,
    meshXform: snap.meshXform,
    genSource: snap.genSource,
    updatedAt: Date.now(),
    versions: [...kept, v],
    headId: v.id,
  };
}

/** Set a past snapshot as HEAD; records the restore as a new append-only version. Pure. */
export function restoreVersion(project: Project, versionId: string): Project {
  const t = project.versions.find((v) => v.id === versionId);
  if (!t) throw new Error("Version not found.");
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    summary: `Restored “${t.summary}”`,
    engine: t.engine,
    code: t.code,
    params: t.params,
    ops: t.ops,
    importFile: t.importFile,
    importKind: t.importKind,
    spec: t.spec,
    dims: t.dims,
    glb: t.glb,
    meshXform: t.meshXform,
    genSource: t.genSource,
  };
  return {
    ...project,
    engine: t.engine,
    code: t.code,
    params: t.params,
    ops: t.ops,
    importFile: t.importFile,
    importKind: t.importKind,
    spec: t.spec,
    glb: t.glb,
    meshXform: t.meshXform,
    genSource: t.genSource,
    updatedAt: Date.now(),
    versions: [...project.versions, v],
    headId: v.id,
  };
}

/** Index of the live HEAD within `versions` (defaults to the newest). */
export function headIndex(project: Project): number {
  if (project.headId) {
    const i = project.versions.findIndex((v) => v.id === project.headId);
    if (i >= 0) return i;
  }
  return project.versions.length - 1;
}

/** Move HEAD to an existing version WITHOUT appending (undo/redo). The live
 *  fields mirror that version; `versions` is untouched so redo stays available. Pure. */
export function navigateHead(project: Project, versionId: string): Project {
  const t = project.versions.find((v) => v.id === versionId);
  if (!t) throw new Error("Version not found.");
  return {
    ...project,
    engine: t.engine,
    code: t.code,
    params: t.params,
    ops: t.ops,
    importFile: t.importFile,
    importKind: t.importKind,
    spec: t.spec,
    glb: t.glb,
    meshXform: t.meshXform,
    genSource: t.genSource,
    updatedAt: Date.now(),
    headId: t.id,
  };
}
