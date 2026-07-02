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
    clientP = import("@supabase/supabase-js").then(({ createClient }) =>
      // PKCE: the safe OAuth/magic-link flow for a static site; the client
      // auto-exchanges the ?code= in the URL when it initializes.
      createClient(SUPA_URL, SUPA_KEY, { auth: { flowType: "pkce" } }),
    );
  }
  return clientP;
}

/** The exact page URL OAuth/magic links must return to (works on Pages + localhost). */
function appUrl(): string {
  return window.location.origin + window.location.pathname;
}

/** True when the page URL carries an auth return (OAuth code / magic link). */
export function hasAuthReturn(): boolean {
  return /[?&#](code|access_token|error_description)=/.test(window.location.search + window.location.hash);
}

/** Initialize the client to complete an auth return, then clean the URL. */
export async function completeAuthReturn(): Promise<{ email: string } | null> {
  const u = await cloudUser(); // initializing the client performs the code exchange
  window.history.replaceState(null, "", appUrl());
  return u;
}

export async function cloudOAuth(provider: "github" | "google"): Promise<void> {
  const c = await supa();
  const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: appUrl() } });
  if (error) throw new Error(error.message);
  // on success the browser navigates away to the provider
}

export async function cloudMagicLink(email: string): Promise<string> {
  const c = await supa();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl() } });
  if (error) throw new Error(error.message);
  return `Login link sent to ${email} — open it in THIS browser (check spam; sender mail.app.supabase.io). No password needed.`;
}

/** Subscribe to sign-in/out; returns an unsubscribe function. */
export async function onAuthChange(cb: (email: string | null) => void): Promise<() => void> {
  const c = await supa();
  const { data } = c.auth.onAuthStateChange((_e: string, session: any) => cb(session?.user?.email ?? null));
  return () => data.subscription.unsubscribe();
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
  return data.session
    ? "Account created — you're signed in."
    : `Account created. We emailed a confirmation link to ${email} (check spam — sender is mail.app.supabase.io). Click it, then come back and press Sign in.`;
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
