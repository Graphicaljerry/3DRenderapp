import type { Backend, Project } from "./types";

async function makeIdbBackend(): Promise<Backend> {
  const { getDB, STORE_NAME } = await import("./db");
  return {
    async put(p) {
      const db = await getDB();
      await db.put(STORE_NAME, p);
    },
    async get(id) {
      const db = await getDB();
      return db.get(STORE_NAME, id);
    },
    async all() {
      const db = await getDB();
      return (await db.getAllFromIndex(STORE_NAME, "by-updatedAt")).reverse();
    },
    async del(id) {
      const db = await getDB();
      await db.delete(STORE_NAME, id);
    },
  };
}

const LS_KEY = "moldable:projects";
function lsRead(): Record<string, Project> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function lsWrite(map: Record<string, Project>) {
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}
function makeLsBackend(): Backend {
  return {
    async put(p) {
      const m = lsRead();
      m[p.id] = p;
      lsWrite(m);
    },
    async get(id) {
      return lsRead()[id];
    },
    async all() {
      return Object.values(lsRead()).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async del(id) {
      const m = lsRead();
      delete m[id];
      lsWrite(m);
    },
  };
}

async function idbUsable(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    const req = indexedDB.open("moldable:probe");
    await new Promise<void>((res, rej) => {
      req.onsuccess = () => {
        req.result.close();
        res();
      };
      req.onerror = () => rej(req.error);
      req.onblocked = () => res();
    });
    indexedDB.deleteDatabase("moldable:probe");
    return true;
  } catch {
    return false;
  }
}

let backendPromise: Promise<Backend> | null = null;
export function getBackend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = (async () => ((await idbUsable()) ? makeIdbBackend() : makeLsBackend()))();
  }
  return backendPromise;
}
