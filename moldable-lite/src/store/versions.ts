import type { Project, Version, StoredEngineKind } from "./types";
import { uid } from "../lib/id";

export interface Snapshot {
  engine: StoredEngineKind;
  summary: string;
  code?: string;
  spec?: unknown;
  dims?: { x: number; y: number; z: number };
}

/** Append a version capturing the new state AND advance HEAD to match. Pure. */
export function appendVersion(project: Project, snap: Snapshot): Project {
  const v: Version = {
    id: uid(),
    createdAt: Date.now(),
    summary: snap.summary,
    engine: snap.engine,
    code: snap.code,
    spec: snap.spec,
    dims: snap.dims,
  };
  return {
    ...project,
    engine: snap.engine,
    code: snap.code,
    spec: snap.spec,
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
    spec: t.spec,
    dims: t.dims,
  };
  return {
    ...project,
    engine: t.engine,
    code: t.code,
    spec: t.spec,
    updatedAt: Date.now(),
    versions: [...project.versions, v],
  };
}
