import type { Project, StoredEngineKind } from "./types";
import { getBackend } from "./backend";
import { uid } from "../lib/id";

export function newProject(name: string, engine: StoredEngineKind): Project {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now, engine, versions: [], chat: [] };
}

export async function putProject(p: Project): Promise<void> {
  (await getBackend()).put(p);
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
