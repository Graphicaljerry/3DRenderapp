import type { Project, StoredEngineKind } from "./types";
import { getBackend } from "./backend";
import { mergeProjects } from "./merge";
import { uid } from "../lib/id";

/** This running copy of the app. Regenerated on every load, deliberately: two tabs of
 *  the same site share one IndexedDB and must not assume each other's writes are their
 *  own. Anything that isn't this value means somebody else has touched the record since
 *  we read it, and the write below merges rather than replaces. */
const INSTANCE = uid();
/** Stamp used by the sync cycle when it writes a copy it pulled from the account. It is
 *  never equal to a live INSTANCE, so the next local save is guaranteed to merge with
 *  what arrived rather than paving over it — the hole that lost a day's work. */
export const CLOUD_WRITER = "cloud";

export function newProject(name: string, engine: StoredEngineKind): Project {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now, engine, versions: [], chat: [] };
}

/** Save a project. If the stored copy was last written by anyone but this instance, the
 *  two are merged first — no caller has to remember to do it, because the callers are
 *  dozens of small "save the change I just made" paths and one of them forgetting is
 *  exactly how history gets deleted. */
export async function putProject(p: Project, writer: string = INSTANCE): Promise<Project> {
  const b = await getBackend();
  let next = p;
  try {
    const existing = await b.get(p.id);
    if (existing && existing.writerId && existing.writerId !== INSTANCE) next = mergeProjects(p, existing);
  } catch { /* read failed (private mode, quota) — saving the change still beats not saving it */ }
  const stored = { ...next, writerId: writer };
  await b.put(stored);
  // Returned so the caller can adopt what was actually written. Without this the merge
  // only survives one save: the caller still holds its pre-merge copy, and its next
  // write — a chat autosave is enough — takes the same-instance fast path and deletes
  // the history that was just rescued.
  return stored;
}

export async function listProjects(): Promise<Project[]> {
  return (await getBackend()).all();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await getBackend()).get(id);
}

export async function deleteProject(id: string): Promise<void> {
  return (await getBackend()).del(id);
}

export async function duplicateProject(id: string): Promise<Project> {
  const b = await getBackend();
  const src = await b.get(id);
  if (!src) throw new Error("Project not found.");
  const now = Date.now();
  const copy: Project = { ...structuredClone(src), id: uid(), name: `${src.name} (copy)`, createdAt: now, updatedAt: now };
  await b.put(copy);
  return copy;
}
