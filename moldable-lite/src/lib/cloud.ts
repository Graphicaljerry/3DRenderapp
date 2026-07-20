// Cloud account + automatic sync (Supabase).
// - Auth: email+password, GitHub/Google OAuth, or passwordless magic link.
// - Sync: settings (incl. API keys) + projects auto-sync to the signed-in
//   account — no passphrase, no manual push. Rows are private to the owner via
//   row-level security; payloads are AES-GCM encrypted at rest with a key
//   derived from the account id (defence-in-depth against a raw DB read).
//   Meshes/STEP blobs stay on-device (too large for a text column).
// - The same Supabase project hosts the relay edge function that unlocks
//   Tripo/Meshy/fal on the hosted site (DEFAULT_RELAY).

import { encryptPayload, decryptPayload, gatherSettings, LOCAL_ONLY_KEYS } from "./backup";
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

async function currentUid(): Promise<string | null> {
  const c = await supa();
  const { data } = await c.auth.getSession();
  return data?.session?.user?.id ?? null;
}

/** Meshes/STEP blobs stay on-device; everything else about a project syncs.
    Inline data-URL images get a size budget: model thumbnails (~10-30 KB) pass,
    full camera photos / marked screenshots in chat (often multi-MB) do not —
    unbounded images inflated the single-row payload past the server's statement
    timeout ("canceling statement due to statement timeout", a real user report).
    `lean` drops images entirely — the last-resort retry when even the trimmed
    payload times out; code, chats and settings always survive. */
const IMG_BUDGET = 64 * 1024;
function sanitizeProject(p: Project, lean = false): Project {
  const img = (s?: string) => (s && !lean && s.length <= IMG_BUDGET ? s : undefined);
  return {
    ...p,
    glb: undefined,
    importFile: undefined,
    thumb: img(p.thumb),
    chat: p.chat?.map((t) => (t.image ? { ...t, image: img(t.image) } : t)),
    versions: p.versions.map((v) => ({ ...v, glb: undefined, importFile: undefined })),
  };
}

/** Upload settings (incl. keys) + projects to the account. No-op when signed out. */
export async function cloudSyncPush(): Promise<{ projects: number } | null> {
  const uid = await currentUid();
  if (!uid) return null;
  await pushBlob("settings", await encryptPayload(uid, JSON.stringify(gatherSettings())));
  const all = await listProjects();
  const attempt = async (lean: boolean) => {
    const projects = all.map((p) => sanitizeProject(p, lean));
    await pushBlob("projects", await encryptPayload(uid, JSON.stringify(projects)));
    return projects.length;
  };
  try {
    return { projects: await attempt(false) };
  } catch (e: any) {
    // The server kills oversized upserts mid-statement — retry once without any
    // inline images rather than failing the whole sync.
    if (!/statement timeout|57014/i.test(String(e?.message ?? e))) throw e;
    return { projects: await attempt(true) };
  }
}

/** Pull the account's data into this device (idempotent — merges projects by
 *  updatedAt, only adopts settings that differ). Returns counts of what changed;
 *  null when signed out. */
export async function cloudSyncPull(): Promise<{ settings: number; projects: number } | null> {
  const uid = await currentUid();
  if (!uid) return null;
  let settings = 0;
  let projects = 0;
  const dec = async (blob: string | null) => {
    if (!blob) return null;
    try {
      return await decryptPayload(uid, blob);
    } catch {
      return null; // wrong/legacy key — treat as no cloud data
    }
  };
  const sJson = await dec(await pullBlob("settings"));
  if (sJson) {
    const data = JSON.parse(sJson) as Record<string, string>;
    for (const [k, v] of Object.entries(data)) {
      // Never adopt device-local keys — adopting a stale cloud copy of a
      // per-sync-changing key (moldable_last_sync) would keep flagging a change
      // and reload forever. (Legacy blobs may still contain them.)
      if (k.startsWith("moldable_") && !LOCAL_ONLY_KEYS.has(k) && localStorage.getItem(k) !== v) {
        localStorage.setItem(k, v);
        settings++;
      }
    }
  }
  const pJson = await dec(await pullBlob("projects"));
  if (pJson) {
    const remote = JSON.parse(pJson) as Project[];
    for (const r of remote) {
      const local = await getProject(r.id);
      if (local && local.updatedAt >= r.updatedAt) continue; // local is newer/equal
      await putProject({
        ...r,
        glb: local?.glb,
        importFile: local?.importFile,
        versions: r.versions.map((v) => {
          const lv = local?.versions.find((x) => x.id === v.id);
          return { ...v, glb: lv?.glb, importFile: lv?.importFile };
        }),
      });
      projects++;
    }
  }
  return { settings, projects };
}
