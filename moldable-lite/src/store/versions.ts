import type { Project, Version, StoredEngineKind, GenSource } from "./types";
import { uid } from "../lib/id";

export interface Snapshot {
  engine: StoredEngineKind;
  summary: string;
  code?: string;
  params?: Record<string, number>;
  spec?: unknown;
  dims?: { x: number; y: number; z: number };
  glb?: Blob;
  genSource?: GenSource;
}

/** Append a version capturing the new state AND advance HEAD to match. Pure. */
export function appendVersion(project: Project, snap: Snapshot): Project {
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    summary: snap.summary,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    spec: snap.spec,
    dims: snap.dims,
    glb: snap.glb,
    genSource: snap.genSource,
  };
  return {
    ...project,
    engine: snap.engine,
    code: snap.code,
    params: snap.params,
    spec: snap.spec,
    glb: snap.glb,
    genSource: snap.genSource,
    updatedAt: Date.now(),
    versions: [...project.versions, v],
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
    spec: t.spec,
    dims: t.dims,
    glb: t.glb,
    genSource: t.genSource,
  };
  return {
    ...project,
    engine: t.engine,
    code: t.code,
    params: t.params,
    spec: t.spec,
    glb: t.glb,
    genSource: t.genSource,
    updatedAt: Date.now(),
    versions: [...project.versions, v],
  };
}
