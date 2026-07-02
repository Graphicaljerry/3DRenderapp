// Cloud account + zero-knowledge sync (Supabase).
// - Auth: email + password (Supabase Auth).
// - Sync: settings and projects are AES-GCM encrypted CLIENT-SIDE with the
//   user's passphrase before upload — the server only ever stores ciphertext.
// - The same Supabase project also hosts the public relay edge function that
//   unlocks Tripo/Meshy/fal on the hosted site (DEFAULT_RELAY).

import { encryptPayload, decryptPayload, gatherSettings } from "./backup";
import { listProjects, getProject, putProject } from "../store/projects";
import type { Project } from "../store/types";

export const SUPA_URL = "https://prtpakaxzdmrehpndimy.supabase.co";
const SUPA_KEY = "sb_publishable_S2OH_PP7MxCzk0e14-yIwg_7pvLAw5a"; // publishable by design
export const DEFAULT_RELAY = `${SUPA_URL}/functions/v1/relay`;

let clientP: Promise<any> | null = null;
function supa(): Promise<any> {
  if (!clientP) {
    clientP = import("@supabase/supabase-js").then(({ createClient }) => createClient(SUPA_URL, SUPA_KEY));
  }
  return clientP;
}

export async function cloudUser(): Promise<{ email: string } | null> {
  const c = await supa();
  const { data } = await c.auth.getSession();
  const email = data?.session?.user?.email;
  return email ? { email } : null;
}

export async function cloudSignUp(email: string, password: string): Promise<string> {
  const c = await supa();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data.session ? "Account created — you're signed in." : "Account created — check your email to confirm, then sign in.";
}

export async function cloudSignIn(email: string, password: string): Promise<void> {
  const c = await supa();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function cloudSignOut(): Promise<void> {
  const c = await supa();
  await c.auth.signOut();
}

async function pushBlob(kind: "settings" | "projects", payload: string): Promise<void> {
  const c = await supa();
  const { data } = await c.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) throw new Error("Sign in first.");
  const { error } = await c.from("sync_blobs").upsert({ user_id: uid, kind, payload, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

async function pullBlob(kind: "settings" | "projects"): Promise<string | null> {
  const c = await supa();
  const { data, error } = await c.from("sync_blobs").select("payload").eq("kind", kind).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.payload ?? null;
}

/** Meshes (Blobs) stay on-device; everything else about a project syncs. */
function sanitizeProject(p: Project): Project {
  return { ...p, glb: undefined, versions: p.versions.map((v) => ({ ...v, glb: undefined })) };
}

export async function cloudPush(passphrase: string): Promise<string> {
  const settings = await encryptPayload(passphrase, JSON.stringify(gatherSettings()));
  await pushBlob("settings", settings);
  const projects = (await listProjects()).map(sanitizeProject);
  await pushBlob("projects", await encryptPayload(passphrase, JSON.stringify(projects)));
  return `Uploaded: settings + ${projects.length} project(s), encrypted.`;
}

export async function cloudPull(passphrase: string): Promise<string> {
  let nSettings = 0;
  const sBlob = await pullBlob("settings");
  if (sBlob) {
    const data = JSON.parse(await decryptPayload(passphrase, sBlob)) as Record<string, string>;
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith("moldable_")) {
        localStorage.setItem(k, v);
        nSettings++;
      }
    }
  }
  let nProjects = 0;
  const pBlob = await pullBlob("projects");
  if (pBlob) {
    const remote = JSON.parse(await decryptPayload(passphrase, pBlob)) as Project[];
    for (const r of remote) {
      const local = await getProject(r.id);
      if (local && local.updatedAt >= r.updatedAt) continue; // local is newer — keep it
      // Preserve any locally-stored meshes when adopting the newer remote copy.
      await putProject({
        ...r,
        glb: local?.glb,
        versions: r.versions.map((v) => ({ ...v, glb: local?.versions.find((x) => x.id === v.id)?.glb })),
      });
      nProjects++;
    }
  }
  if (!sBlob && !pBlob) return "Nothing in the cloud yet — push from your other device first.";
  return `Restored ${nSettings} settings + ${nProjects} project(s) — reloading…`;
}
