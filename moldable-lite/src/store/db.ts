import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Project } from "./types";

const DB_NAME = "moldable";
const DB_VERSION = 1;
const STORE = "projects";

interface MoldableSchema extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { "by-updatedAt": number };
  };
}

let dbPromise: Promise<IDBPDatabase<MoldableSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<MoldableSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MoldableSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("by-updatedAt", "updatedAt");
        }
      },
      blocking() {
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export const STORE_NAME = STORE;
