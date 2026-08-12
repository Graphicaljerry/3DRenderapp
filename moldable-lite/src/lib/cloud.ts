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
import { listProjects, getProject, putProject, deleteProject, CLOUD_WRITER } from "../store/projects";
import { mergeProjects, mergeChanged } from "../store/merge";
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

/** One cheap probe against the auth health endpoint (5 s cap): can THIS machine
    reach the sync service right now? */
async function probeReachable(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`${SUPA_URL}/auth/v1/health`, { signal: ctl.signal, headers: { apikey: SUPA_KEY } });
    clearTimeout(t);
    return r.ok || r.status === 401;
  } catch {
    return false;
  }
}

/** Public probe for UI that wants to warn BEFORE a sign-in attempt fails — the
    sign-in dialog shows the blocked-network explanation up front instead of as
    the aftermath of a dead OAuth hop. */
export function cloudReachable(): Promise<boolean> {
  return probeReachable();
}

/** OAuth navigates the whole tab to the service's URL — when supabase.co is blocked
    (DNS filter, VPN, ad-block shields, some ISP resolvers), that lands the user on a
    dead browser error page (ERR_ADDRESS_UNREACHABLE — a real report). Check first
    and fail with words. */
async function ensureReachable(): Promise<void> {
  if (await probeReachable()) return;
  throw new Error(
    "Your network can't reach the sync service (supabase.co looks blocked or unreachable from here — the service itself is up). Common culprits: DNS filtering, a VPN, or browser shields. Try another network or DNS (e.g. 1.1.1.1), or allow supabase.co, then try again.",
  );
}

/** A failure that means "the wire", not "the account" — callers should keep treating
    the user as signed in and retry later, never present them as signed out. */
export function isNetworkError(e: unknown): boolean {
  return /failed to fetch|fetch failed|load failed|networkerror|network request|abort|timed? ?out|unreachable/i.test(String((e as any)?.message ?? e));
}

/** Device-local memory of who was signed in HERE (never synced). The Supabase session
    can only refresh by reaching the server, so on a network that blocks supabase.co
    the app used to boot as "signed out" even though the user never signed out — while
    their cached models stayed visible (the iPad report). This marker lets the app tell
    "signed out" apart from "signed in, but cut off" and say so honestly. It is cleared
    only by an explicit sign-out or by a REACHABLE server refusing the session. */
const LAST_EMAIL = "moldable_cloud_last_email";

export type CloudSessionState = { email: string | null; offline: boolean };

/** The truth about this device's account, network included:
    - live session               → { email, offline: false }
    - no session, none remembered → { null, offline: false }
    - no session, remembered:
        server unreachable       → { email, offline: true }  (keep everything, retry later)
        server reachable         → one live refresh attempt; still nothing means the
                                   sign-in genuinely ended → marker cleared, signed out. */
export async function cloudSessionState(): Promise<CloudSessionState> {
  const c = await supa();
  const { data } = await c.auth.getSession();
  const live = data?.session?.user?.email ?? null;
  if (live) {
    try { localStorage.setItem(LAST_EMAIL, live); } catch { /* private mode */ }
    return { email: live, offline: false };
  }
  const remembered = localStorage.getItem(LAST_EMAIL);
  if (!remembered) return { email: null, offline: false };
  if (!(await probeReachable())) return { email: remembered, offline: true };
  try {
    const { data: r, error } = await c.auth.refreshSession();
    const em = r?.session?.user?.email ?? null;
    if (em) {
      localStorage.setItem(LAST_EMAIL, em);
      return { email: em, offline: false };
    }
    // The auth client caches a failed refresh for a ~60 s cooldown (and a fetch that
    // died mid-flight reports the same way) — neither is the server's verdict on the
    // ACCOUNT. Stay offline-signed-in; the retry loop wins once the cooldown clears.
    if (error && (error.name === "AuthRetryableFetchError" || isNetworkError(error))) {
      return { email: remembered, offline: true };
    }
  } catch (e) {
    if (isNetworkError(e)) return { email: remembered, offline: true };
  }
  // Only a REACHABLE server with a definitive "no" lands here: the sign-in ended.
  try { localStorage.removeItem(LAST_EMAIL); } catch { /* private mode */ }
  return { email: null, offline: false };
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
  const { data } = c.auth.onAuthStateChange((_e: string, session: any) => {
    const em = session?.user?.email ?? null;
    if (em) try { localStorage.setItem(LAST_EMAIL, em); } catch { /* private mode */ }
    cb(em);
  });
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
  try { localStorage.removeItem(LAST_EMAIL); } catch { /* private mode */ }
}

type BlobKind = "settings" | "projects" | "tombstones";

/** Device-local record of the sync_blobs `updated_at` this device last wrote or
    merged, per kind. Every cycle asks the server for the stamps alone (one tiny
    SELECT) and only downloads a payload whose stamp it hasn't seen — without this,
    continuous two-way sync would re-download the whole library every 45 s. */
const SEEN_KEY = "moldable_sync_stamp";
function seenStamps(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") ?? {}; } catch { return {}; }
}
function stampSeen(kind: BlobKind, v: string | null): void {
  const s = seenStamps();
  if (v == null) delete s[kind];
  else s[kind] = v;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
/** timestamptz round-trips with different text (Z vs +00:00, µs padding) — compare instants. */
const sameStamp = (a?: string, b?: string) => !!a && !!b && Date.parse(a) === Date.parse(b);

async function fetchStamps(c: any): Promise<Partial<Record<BlobKind, string>>> {
  const { data, error } = await c.from("sync_blobs").select("kind, updated_at");
  if (error) throw new Error(error.message);
  const out: Partial<Record<BlobKind, string>> = {};
  for (const r of data ?? []) out[r.kind as BlobKind] = r.updated_at;
  return out;
}

async function pushBlob(c: any, uid: string, kind: BlobKind, payload: string): Promise<void> {
  const updated_at = new Date().toISOString();
  const { error } = await c.from("sync_blobs").upsert({ user_id: uid, kind, payload, updated_at });
  if (error) throw new Error(error.message);
  stampSeen(kind, updated_at);
}

async function pullBlob(c: any, kind: BlobKind): Promise<string | null> {
  const { data, error } = await c.from("sync_blobs").select("payload").eq("kind", kind).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.payload ?? null;
}

const dec = async (uid: string, blob: string | null) => {
  if (!blob) return null;
  try {
    return await decryptPayload(uid, blob);
  } catch {
    return null; // wrong/legacy key — treat as no cloud data
  }
};

async function currentUid(): Promise<string | null> {
  const c = await supa();
  const { data } = await c.auth.getSession();
  return data?.session?.user?.id ?? null;
}

// ---- Deletion tombstones ----
// Sync is a MERGE now (reconcileRemote): without a record of deletions, a project
// deleted here would ride straight back in from the account blob on the next cycle,
// and one deleted elsewhere would never leave this device. Deleting writes a
// tombstone; tombstones sync as their own tiny blob so every device applies the
// deletion; an edit made AFTER the deletion wins over it.
const TOMB_KEY = "moldable_tombstones_v1";
const TOMB_TTL = 120 * 24 * 3600 * 1000; // after ~4 months every live device has long since applied it
type TombMap = Record<string, number>; // project id → deletedAt (ms)
function loadTombs(): TombMap {
  try {
    const m = JSON.parse(localStorage.getItem(TOMB_KEY) ?? "{}");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}
function saveTombs(m: TombMap): void {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
/** Call at the moment a project is deleted locally. */
export function recordTombstone(id: string): void {
  const m = loadTombs();
  m[id] = Date.now();
  saveTombs(m);
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
// Per inline picture in the synced row. Chat pictures are transcript thumbnails now
// (see chatThumb) rather than the full attached photo, so this admits them instead of
// silently dropping every one — which is what "the photos I uploaded don't show on my
// other computer" was. Still a budget: the row has a server-side statement timeout
// behind it, and an unbounded one is what found that timeout in the first place.
const IMG_BUDGET = 96 * 1024;
function sanitizeProject(p: Project, lean = false): Project {
  const img = (s?: string) => (s && !lean && s.length <= IMG_BUDGET ? s : undefined);
  return {
    ...p,
    glb: undefined,
    importFile: undefined,
    thumb: img(p.thumb),
    chat: p.chat?.map((t) => (t.image || t.images?.length
      ? { ...t, image: img(t.image), images: t.images?.map(img).filter((u): u is string => !!u) }
      : t)),
    // History thumbnails: recent ones ride along (small webp), older ones drop — a
    // long project would otherwise inflate the single-row payload; `lean` drops all.
    versions: p.versions.map((v, i, arr) => ({
      ...v, glb: undefined, importFile: undefined,
      thumb: !lean && v.thumb && v.thumb.length <= 24 * 1024 && i >= arr.length - 30 ? v.thumb : undefined,
    })),
  };
}

/** Two-way reconcile with the account: adopt remote tombstones (applying deletions
    locally), then adopt any remote project newer than this device's copy — meshes
    included. Cheap when nothing changed remotely (one stamp SELECT, no payloads);
    `force` downloads regardless (the sign-in pull). Returns what changed on THIS
    device so the UI can react, plus the merged tombstone map for the push. */
async function reconcileRemote(c: any, uid: string, force = false): Promise<{ adopted: string[]; deleted: string[]; meshes: number; tombs: TombMap }> {
  const stamps = await fetchStamps(c);
  const seen = seenStamps();
  const need = (k: BlobKind) => force || !sameStamp(stamps[k], seen[k]);

  // Tombstones: union by newest deletedAt, then apply. An edit made after the
  // deletion wins — the tombstone drops so the edited copy can sync back everywhere.
  const tombs = loadTombs();
  if (need("tombstones")) {
    const tJson = await dec(uid, await pullBlob(c, "tombstones"));
    if (tJson) {
      try {
        for (const [id, at] of Object.entries(JSON.parse(tJson) as TombMap)) {
          const n = Number(at) || 0;
          if (n > (tombs[id] ?? 0)) tombs[id] = n;
        }
      } catch { /* unreadable remote tombstones — keep local */ }
    }
    stampSeen("tombstones", stamps.tombstones ?? null);
  }
  const now = Date.now();
  for (const [id, at] of Object.entries(tombs)) if (now - at > TOMB_TTL) delete tombs[id];
  const deleted: string[] = [];
  for (const [id, at] of Object.entries(tombs)) {
    const local = await getProject(id);
    if (!local) continue;
    if (local.updatedAt > at) delete tombs[id];
    else {
      await deleteProject(id);
      try { localStorage.removeItem(meshMark(id)); } catch { /* private mode */ }
      deleted.push(id);
    }
  }
  saveTombs(tombs);

  // Projects: merge by updatedAt — the same rules as the sign-in pull, every cycle.
  const adopted: string[] = [];
  let meshes = 0;
  if (need("projects")) {
    const pJson = await dec(uid, await pullBlob(c, "projects"));
    if (pJson) {
      let remote: Project[] = [];
      try {
        const parsed = JSON.parse(pJson);
        if (Array.isArray(parsed)) remote = parsed;
      } catch { /* unreadable remote blob — nothing to adopt */ }
      for (const r of remote) {
        if ((tombs[r.id] ?? 0) >= r.updatedAt) continue; // deleted somewhere — don't resurrect
        const local = await getProject(r.id);
        // Two copies of one project are MERGED, never chosen between. updatedAt used to
        // decide which whole list survived, which meant a copy that had merely been left
        // open — the chat autosave restamps it every few seconds — could delete a day of
        // history it had never seen. mergeProjects unions the versions instead; the most
        // a wrong guess costs now is a longer History panel. See store/merge.ts.
        if (local) {
          const hydrated: Project = {
            ...r,
            versions: r.versions.map((v) => {
              const lv = local.versions.find((x) => x.id === v.id);
              return { ...v, glb: lv?.glb, importFile: lv?.importFile };
            }),
          };
          const next = mergeProjects(local, hydrated);
          const changed = mergeChanged(local, next);
          // The bucket holds the head mesh. Fetch it when this device has NO geometry
          // (a project arriving empty), and — the part that was missing — whenever the
          // bytes it holds are not the bytes the account is advertising.
          //
          // The old test was "do I have any geometry at all", so a device that already
          // held an older mesh for this project never downloaded the new one: History,
          // chat and dimensions all updated, the model on screen did not, and no number
          // of refreshes fixed it because the guard stayed false. Worse, the next push
          // from that device re-advertised the stale hash. Comparing against the marker
          // (the bytes this device knows are in the bucket) is the honest test.
          //
          // Only when the merge actually MOVED head, though: bytes generated here and
          // not yet pushed are the newer ones, and HEAD already says so — overwriting
          // them with the account's older copy would put the wrong mesh under the right
          // version.
          const held = localStorage.getItem(meshMark(r.id));
          const staleMesh = !!r.cloudMesh && held !== r.cloudMesh.hash && next.headId !== local.headId;
          if ((staleMesh || (!next.glb && !next.importFile)) && r.cloudMesh) {
            const m = await fetchMesh(c, uid, r.id, r.cloudMesh.hash);
            if (m) {
              if (r.cloudMesh.src === "glb") next.glb = m; else next.importFile = m;
              next.cloudMesh = r.cloudMesh;
              meshes++;
            }
          }
          if (changed || next.glb !== local.glb || next.importFile !== local.importFile) {
            await putProject(next, CLOUD_WRITER);
            adopted.push(r.id);
          }
          continue;
        }
        const merged: Project = {
          ...r,
          versions: r.versions.map((v) => ({ ...v })),
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
        await putProject(merged, CLOUD_WRITER);
        adopted.push(r.id);
      }
    }
    stampSeen("projects", stamps.projects ?? null);
  }
  return { adopted, deleted, meshes, tombs };
}

/** One sync cycle at a time per device. A boot pull racing a change-triggered push
    interleaves blob writes: the slower (pre-change) cycle lands last and clobbers
    what the newer one uploaded — the probe caught it wiping a fresh deletion
    tombstone with pre-delete state. Cycles queue behind whatever is in flight. */
let syncChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncChain.then(fn, fn);
  syncChain = run.catch(() => {});
  return run;
}

/** One full two-way sync cycle: merge the account's changes IN, then upload this
    device's state. Merging first matters — the projects blob is whole-list, so a
    device pushing without merging replaced the account's library with its own stale
    view, and new projects from other devices vanished until they happened to push
    again ("it's not updated or synced to the latest library", a real report).
    No-op (null) when signed out. */
export function cloudSyncPush(): Promise<{ projects: number; meshes: number; adopted: string[]; deleted: string[] } | null> {
  return serialized(() => cloudSyncPushInner());
}
async function cloudSyncPushInner(): Promise<{ projects: number; meshes: number; adopted: string[]; deleted: string[] } | null> {
  const uid = await currentUid();
  if (!uid) return null;
  const c = await supa();
  await pushBlob(c, uid, "settings", await encryptPayload(uid, JSON.stringify(gatherSettings())));
  const rec = await reconcileRemote(c, uid);
  const all = (await listProjects()).filter((p) => (rec.tombs[p.id] ?? 0) < p.updatedAt);
  // Meshes go FIRST so the JSON that other devices merge already points at blobs
  // that exist in the bucket (never the other way round).
  const { meta, uploaded } = await pushMeshes(c, uid, all);
  const attempt = async (lean: boolean) => {
    const projects = all.map((p) => ({ ...sanitizeProject(p, lean), cloudMesh: meta.get(p.id) }));
    await pushBlob(c, uid, "projects", await encryptPayload(uid, JSON.stringify(projects)));
    return projects.length;
  };
  let projects: number;
  try {
    projects = await attempt(false);
  } catch (e: any) {
    // The server kills oversized upserts mid-statement — retry once without any
    // inline images rather than failing the whole sync.
    if (!/statement timeout|57014/i.test(String(e?.message ?? e))) throw e;
    projects = await attempt(true);
  }
  await pushBlob(c, uid, "tombstones", await encryptPayload(uid, JSON.stringify(rec.tombs)));
  return { projects, meshes: uploaded, adopted: rec.adopted, deleted: rec.deleted };
}

/** Pull the account's data into this device (idempotent — merges projects by
 *  updatedAt, only adopts settings that differ). Returns counts of what changed;
 *  null when signed out. */
export function cloudSyncPull(): Promise<{ settings: number; projects: number; meshes: number } | null> {
  return serialized(() => cloudSyncPullInner());
}
async function cloudSyncPullInner(): Promise<{ settings: number; projects: number; meshes: number } | null> {
  const uid = await currentUid();
  if (!uid) return null;
  const c = await supa();
  let settings = 0;
  const sJson = await dec(uid, await pullBlob(c, "settings"));
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
  const r = await reconcileRemote(c, uid, true);
  return { settings, projects: r.adopted.length, meshes: r.meshes };
}
