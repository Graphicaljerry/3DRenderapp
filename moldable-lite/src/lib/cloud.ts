// Cloud account + automatic sync (Supabase).
// - Auth: email+password, GitHub/Google OAuth, or passwordless magic link.
// - Sync: settings (incl. API keys) + projects auto-sync to the signed-in
//   account — no passphrase, no manual push. Rows are private to the owner via
//   row-level security; payloads are AES-GCM encrypted at rest with a key
//   derived from the account id (defence-in-depth against a raw DB read).
// - Meshes/STEP blobs are too large for the text column, so each project's HEAD
//   mesh syncs as an encrypted object in the private "mesh-sync" Storage bucket
//   (path "<uid>/<project id>.bin", owner-scoped policies). Without this, a mesh
//   project opened on another device had chat + history but no geometry — the
//   real "my Lambo won't open on the Mac" report. Older version snapshots stay
//   on-device; undoing into them on another device explains itself instead.
// - The same Supabase project hosts the relay edge function that unlocks
//   Tripo/Meshy/fal on the hosted site (DEFAULT_RELAY).

import { encryptPayload, decryptPayload, encryptBytes, decryptBytes, gatherSettings, isLocalOnlyKey } from "./backup";
import { listProjects, getProject, putProject } from "../store/projects";
import type { Project } from "../store/types";
import { IS_DESKTOP } from "./desktopUpdate";

export const SUPA_URL = "https://prtpakaxzdmrehpndimy.supabase.co";
const SUPA_KEY = "sb_publishable_S2OH_PP7MxCzk0e14-yIwg_7pvLAw5a"; // publishable by design
export const DEFAULT_RELAY = `${SUPA_URL}/functions/v1/relay`;

/** Where the desktop app keeps its session. The web app uses localStorage, which the
    browser preserves; the Mac/Windows app's WebView storage is not a promise anyone
    makes — WKWebView in particular can hand the app a clean slate — and being asked to
    sign in again every launch is exactly what that looks like. A real file in the app's
    data directory doesn't have that problem. Supabase accepts an async storage
    adapter, so this drops straight in. */
function desktopSessionStorage() {
  const load = import("@tauri-apps/plugin-store").then((m) => m.load("auth.json", { autoSave: true }));
  return {
    async getItem(key: string) {
      try { return (await (await load).get<string>(key)) ?? null; } catch { return null; }
    },
    async setItem(key: string, value: string) {
      try { await (await load).set(key, value); } catch { /* fall back to being signed out */ }
    },
    async removeItem(key: string) {
      try { await (await load).delete(key); } catch { /* nothing to remove */ }
    },
  };
}

let clientP: Promise<any> | null = null;
function supa(): Promise<any> {
  if (!clientP) {
    clientP = import("@supabase/supabase-js").then(({ createClient }) =>
      // PKCE: the safe OAuth/magic-link flow for a static site; the client
      // auto-exchanges the ?code= in the URL when it initializes.
      createClient(SUPA_URL, SUPA_KEY, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true, // a months-old session refreshes instead of expiring
          ...(IS_DESKTOP ? { storage: desktopSessionStorage() } : {}),
        },
      }),
    );
  }
  return clientP;
}

/** Give this account a password, so the desktop app can sign in. OAuth and magic-link
    sign-in both hand control to a browser and expect a redirect back to a web address —
    the desktop app has no such address, so neither can ever complete there. A password
    needs no redirect. Requires being signed in (i.e. do this on the web, once). */
export async function cloudSetPassword(password: string): Promise<string> {
  const c = await supa();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  return "Password set — sign in with your email and this password in the Mac or Windows app.";
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

/** Can THIS machine reach the sync service? OAuth navigates the whole tab to the
    service's URL — when supabase.co is blocked (DNS filter, VPN, ad-block shields,
    some ISP resolvers), that lands the user on a dead browser error page
    (ERR_ADDRESS_UNREACHABLE — a real report). Check first and fail with words. */
async function ensureReachable(): Promise<void> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`${SUPA_URL}/auth/v1/health`, { signal: ctl.signal, headers: { apikey: SUPA_KEY } });
    clearTimeout(t);
    if (!r.ok && r.status !== 401) throw new Error(String(r.status));
  } catch {
    throw new Error(
      "Your network can't reach the sync service (supabase.co looks blocked or unreachable from here — the service itself is up). Common culprits: DNS filtering, a VPN, or browser shields. Try another network or DNS (e.g. 1.1.1.1), or allow supabase.co, then try again.",
    );
  }
}

export async function cloudOAuth(provider: "github" | "google"): Promise<void> {
  await ensureReachable(); // fail HERE with an explanation, not on a dead browser page
  const c = await supa();
  const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: appUrl() } });
  if (error) throw new Error(error.message);
  // on success the browser navigates away to the provider
}

export async function cloudMagicLink(email: string): Promise<string> {
  await ensureReachable();
  const c = await supa();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl() } });
  if (error) throw new Error(error.message);
  return `Login link sent to ${email} — open it in THIS browser (check spam; sender mail.app.supabase.io). No password needed.`;
}

/** Forgotten password: emails a link that signs this browser in, after which the
 *  "Set a password" field writes a new one. Deliberately the same recovery path as the
 *  magic link (Supabase's resetPasswordForEmail), so there is no separate reset page to
 *  host and the user lands back in the app already signed in. */
export async function cloudResetPassword(email: string): Promise<string> {
  await ensureReachable();
  const c = await supa();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) throw new Error(error.message);
  return `Reset link sent to ${email} — open it in THIS browser (check spam). It signs you straight in; then set a new password below.`;
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
  await ensureReachable();
  const c = await supa();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data.session
    ? "Account created — you're signed in."
    : `Account created. We emailed a confirmation link to ${email} (check spam — sender is mail.app.supabase.io). Click it, then come back and press Sign in.`;
}

export async function cloudSignIn(email: string, password: string): Promise<void> {
  await ensureReachable();
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

// ---- Mesh blob sync (Storage bucket) ----
const MESH_BUCKET = "mesh-sync";
/** localStorage marker: the sha-256 of the mesh bytes THIS device knows are in the
    bucket for a project (set after an upload or a download). Device-local by design —
    isLocalOnlyKey excludes the prefix from settings sync. */
const meshMark = (id: string) => `moldable_meshhash_${id}`;

async function sha256Hex(b: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Upload each project's HEAD mesh (generated glb, or the imported STEP/STL a CAD
    program references) that the bucket doesn't have yet. Returns per-project metadata
    to embed in the synced JSON so other devices know a blob exists to fetch. Encrypted
    with the same account-derived key as the row payloads; a failed upload skips that
    project (the JSON keeps any metadata a previous successful upload published) rather
    than failing the whole sync. */
async function pushMeshes(c: any, uid: string, all: Project[]): Promise<{ meta: Map<string, NonNullable<Project["cloudMesh"]>>; uploaded: number }> {
  const meta = new Map<string, NonNullable<Project["cloudMesh"]>>();
  let uploaded = 0;
  for (const p of all) {
    const blob = p.glb ?? p.importFile;
    if (!blob) continue;
    const src: "glb" | "import" = p.glb ? "glb" : "import";
    try {
      const hash = await sha256Hex(blob);
      if (localStorage.getItem(meshMark(p.id)) !== hash) {
        const enc = await encryptBytes(uid, new Uint8Array(await blob.arrayBuffer()));
        const { error } = await c.storage.from(MESH_BUCKET).upload(`${uid}/${p.id}.bin`, enc, { upsert: true, contentType: "application/octet-stream" });
        if (error) throw new Error(error.message);
        localStorage.setItem(meshMark(p.id), hash);
        uploaded++;
      }
      meta.set(p.id, { hash, src });
    } catch (e) {
      console.warn(`mesh sync: upload failed for ${p.id}`, e); // diagnosable, never fatal
      if (p.cloudMesh) meta.set(p.id, p.cloudMesh); // the bucket still holds the older copy
    }
  }
  // Housekeeping: drop bucket objects for projects that no longer exist.
  try {
    const { data } = await c.storage.from(MESH_BUCKET).list(uid, { limit: 1000 });
    const live = new Set(all.map((p) => `${p.id}.bin`));
    const stale = (data ?? []).map((f: any) => f.name).filter((n: string) => n.endsWith(".bin") && !live.has(n));
    if (stale.length) await c.storage.from(MESH_BUCKET).remove(stale.map((n: string) => `${uid}/${n}`));
  } catch { /* cleanup is best-effort */ }
  return { meta, uploaded };
}

/** Download + decrypt a project's mesh from the bucket; null on any failure (the
    caller keeps whatever it had). Marks the device as holding these bytes. */
async function fetchMesh(c: any, uid: string, id: string, hash: string): Promise<Blob | null> {
  try {
    const { data, error } = await c.storage.from(MESH_BUCKET).download(`${uid}/${id}.bin`);
    if (error || !data) {
      console.warn(`mesh sync: download failed for ${id}`, error);
      return null;
    }
    const plain = await decryptBytes(uid, new Uint8Array(await data.arrayBuffer()));
    localStorage.setItem(meshMark(id), hash);
    return new Blob([plain as BlobPart]);
  } catch (e) {
    console.warn(`mesh sync: download failed for ${id}`, e);
    return null;
  }
}

/** Meshes/STEP blobs never ride in the JSON row — the HEAD blob syncs through the
    Storage bucket instead (cloudSyncPush injects `cloudMesh` pointing at it) and
    version-history blobs stay on-device. Everything else about a project syncs.
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
    // History thumbnails: recent ones ride along (small webp), older ones drop — a
    // long project would otherwise inflate the single-row payload; `lean` drops all.
    versions: p.versions.map((v, i, arr) => ({
      ...v, glb: undefined, importFile: undefined,
      thumb: !lean && v.thumb && v.thumb.length <= 24 * 1024 && i >= arr.length - 30 ? v.thumb : undefined,
    })),
  };
}

/** Upload settings (incl. keys) + projects to the account. No-op when signed out. */
export async function cloudSyncPush(): Promise<{ projects: number; meshes: number } | null> {
  const uid = await currentUid();
  if (!uid) return null;
  await pushBlob("settings", await encryptPayload(uid, JSON.stringify(gatherSettings())));
  const all = await listProjects();
  // Meshes go FIRST so the JSON that other devices merge already points at blobs
  // that exist in the bucket (never the other way round).
  const { meta, uploaded } = await pushMeshes(await supa(), uid, all);
  const attempt = async (lean: boolean) => {
    const projects = all.map((p) => ({ ...sanitizeProject(p, lean), cloudMesh: meta.get(p.id) }));
    await pushBlob("projects", await encryptPayload(uid, JSON.stringify(projects)));
    return projects.length;
  };
  try {
    return { projects: await attempt(false), meshes: uploaded };
  } catch (e: any) {
    // The server kills oversized upserts mid-statement — retry once without any
    // inline images rather than failing the whole sync.
    if (!/statement timeout|57014/i.test(String(e?.message ?? e))) throw e;
    return { projects: await attempt(true), meshes: uploaded };
  }
}

/** Pull the account's data into this device (idempotent — merges projects by
 *  updatedAt, only adopts settings that differ). Returns counts of what changed;
 *  null when signed out. */
export async function cloudSyncPull(): Promise<{ settings: number; projects: number; meshes: number } | null> {
  const uid = await currentUid();
  if (!uid) return null;
  let settings = 0;
  let projects = 0;
  let meshes = 0;
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
      if (k.startsWith("moldable_") && !isLocalOnlyKey(k) && localStorage.getItem(k) !== v) {
        localStorage.setItem(k, v);
        settings++;
      }
    }
  }
  const pJson = await dec(await pullBlob("projects"));
  if (pJson) {
    const c = await supa();
    const remote = JSON.parse(pJson) as Project[];
    for (const r of remote) {
      const local = await getProject(r.id);
      if (local && local.updatedAt >= r.updatedAt) {
        // Local wins on content — but a mesh the bucket holds and this device lacks
        // still restores (the "synced project opens empty on another device" fix).
        if (!local.glb && !local.importFile && r.cloudMesh) {
          const m = await fetchMesh(c, uid, r.id, r.cloudMesh.hash);
          if (m) {
            await putProject(r.cloudMesh.src === "glb" ? { ...local, glb: m, cloudMesh: r.cloudMesh } : { ...local, importFile: m, cloudMesh: r.cloudMesh });
            meshes++;
          }
        }
        continue;
      }
      const merged: Project = {
        ...r,
        glb: local?.glb,
        importFile: local?.importFile,
        versions: r.versions.map((v) => {
          const lv = local?.versions.find((x) => x.id === v.id);
          return { ...v, glb: lv?.glb, importFile: lv?.importFile };
        }),
      };
      // Adopting the remote project: fetch its mesh unless this device already holds
      // exactly those bytes (marker matches AND a blob is actually present).
      if (r.cloudMesh && !(localStorage.getItem(meshMark(r.id)) === r.cloudMesh.hash && (merged.glb || merged.importFile))) {
        const m = await fetchMesh(c, uid, r.id, r.cloudMesh.hash);
        if (m) {
          if (r.cloudMesh.src === "glb") merged.glb = m;
          else merged.importFile = m;
          meshes++;
        }
      }
      await putProject(merged);
      projects++;
    }
  }
  return { settings, projects, meshes };
}
