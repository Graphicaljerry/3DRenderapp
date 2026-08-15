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

/** Give this account a password. OAuth and magic-link sign-in both hand control to
    another website and expect a redirect back to a web address; a password needs no
    redirect at all, which makes it the only method that survives two situations:
    the desktop app (no web address to return to) and a locked-down network that
    blocks the provider (a work laptop, a VPN, a school). Requires being signed in
    already — the recovery-link flow (cloudResetPassword) is how you get there when
    you have no password yet. */
export async function cloudSetPassword(password: string): Promise<string> {
  const c = await supa();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  return "Password set — you can now sign in with your email and this password on any device or network, including the Mac and Windows apps.";
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

/** The public health URL, exposed so the UI can offer it as a link. Opening it in a
    tab is the one test that settles the argument: if it answers there, the network is
    fine and this app's verdict was wrong. */
export const HEALTH_URL = `${SUPA_URL}/auth/v1/health`;

/** Can this device reach the sync service, and if not — WHICH kind of not?
 *
 *  "slow" and "blocked" are indistinguishable to fetch(), but they are opposite
 *  advice: one is a radio waking up or a busy connection, the other is a DNS filter
 *  or a content blocker. Telling a user on a weak signal that their network is
 *  censored is both wrong and alarming, and it was doing that.
 *
 *  Two changes from the version that cried wolf:
 *  - NO `apikey` header. That header made this a non-simple cross-origin request, so
 *    every probe first had to survive a CORS preflight it never needed — one more way
 *    to "fail" while the service was perfectly up. The endpoint is public, and a 401
 *    already counted as reachable (the server answered, which is the whole question).
 *  - Two tries at 8 s, not one at 5. A first request that has to do DNS + TLS on a
 *    sleeping mobile radio can genuinely miss 5 s. */
export type Reach = "ok" | "slow" | "blocked";

async function probeReach(): Promise<Reach> {
  let lastTimedOut = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(HEALTH_URL, { signal: ctl.signal, cache: "no-store" });
      if (r.ok || r.status === 401) return "ok"; // it answered — that is the question
      lastTimedOut = false;
    } catch {
      lastTimedOut = ctl.signal.aborted;
    } finally {
      clearTimeout(t);
    }
  }
  return lastTimedOut ? "slow" : "blocked";
}

async function probeReachable(): Promise<boolean> {
  return (await probeReach()) === "ok";
}

/** Public probe for UI that wants to warn BEFORE a sign-in attempt fails — the
    sign-in dialog shows the explanation up front instead of as the aftermath of a
    dead OAuth hop. Returns the REASON, so the dialog can word "we couldn't get an
    answer in time" differently from "something is refusing this outright". */
export function cloudReachable(): Promise<Reach> {
  return probeReach();
}

/** OAuth navigates the whole tab to the service's URL — when supabase.co is blocked
    (DNS filter, VPN, ad-block shields, some ISP resolvers), that lands the user on a
    dead browser error page (ERR_ADDRESS_UNREACHABLE — a real report). Check first
    and fail with words. */
async function ensureReachable(): Promise<void> {
  const r = await probeReach();
  if (r === "ok") return;
  throw new Error(reachMessage(r));
}

/** One wording for each verdict, in one place, so the dialog's up-front warning and a
 *  failed attempt can never describe the same fact in two different ways — which is
 *  what stacked two near-identical red boxes on top of each other. */
export function reachMessage(r: Reach): string {
  return r === "slow"
    ? "The sync service didn't answer in time — twice. That is usually a weak or busy connection rather than anything blocking it, so it is worth simply trying again in a moment."
    : "Something on this network is refusing to reach the sync service. A DNS filter, a VPN, or a Safari/Chrome content blocker are the usual causes — supabase.co appears on some ad-blocking lists. Open the health link below in a new tab: if it answers there, this was a false alarm and signing in will work.";
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

/** The provider's OWN host, which the tab is about to be navigated to. `no-cors` gives
 *  an opaque response we can't read — but reachable-vs-dead is the whole question, and
 *  a network failure still throws. 4 s cap so the check never becomes the delay. */
async function providerReachable(host: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    await fetch(host, { mode: "no-cors", signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

export async function cloudOAuth(provider: "github" | "google"): Promise<void> {
  await ensureReachable(); // fail HERE with an explanation, not on a dead browser page
  // ensureReachable only proves SUPABASE is reachable. OAuth then navigates the whole
  // tab to github.com / accounts.google.com, and a work network commonly blocks one
  // without the other — which stranded the user on a dead browser page with no way back
  // and no idea why ("github isn't letting me", reported on a work machine). Check the
  // host we are actually about to hand the tab to.
  const host = provider === "github" ? "https://github.com/favicon.ico" : "https://accounts.google.com/favicon.ico";
  if (!(await providerReachable(host))) {
    const name = provider === "github" ? "GitHub" : "Google";
    throw new Error(
      `This network can't reach ${name}, so that sign-in would leave you on a dead page. Use your email and password below instead — if you've never set one, "Email me a link to set a password" works on any network.`,
    );
  }
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

/** How many projects this device is holding — the number the sign-out confirmation
 *  has to be able to say out loud before it erases them. */
export async function deviceProjectCount(): Promise<number> {
  return (await listProjects()).length;
}

/** Erase this device's copy of the library: every project, plus the local bookkeeping
 *  that only means anything next to those projects (which mesh bytes are held, which
 *  sync stamps were seen, which project was last open, pending tombstones).
 *
 *  Jerry's rule, and the reason this exists: an account whose models stay browsable
 *  after you sign out is not an account, it is a shared folder — on a work machine the
 *  next person sees the library. Signing out therefore takes the copy with it.
 *
 *  Settings and API keys are deliberately NOT touched: they are this browser's setup,
 *  not the account's work, and wiping them would mean re-entering keys after every
 *  sign-out. Callers must push to the account BEFORE calling this — see signOutAndWipe,
 *  which is the only path a person can reach. */
export async function wipeDevice(): Promise<number> {
  const all = await listProjects();
  for (const p of all) {
    await deleteProject(p.id);
    try { localStorage.removeItem(meshMark(p.id)); } catch { /* private mode */ }
  }
  for (const k of [SEEN_KEY, TOMB_KEY, "moldable_last_project"]) {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  }
  // Second pass. The open project is still live in the UI while this runs, and a save
  // that was already in flight (the chat autosave restamps every few seconds) lands
  // AFTER the delete and puts the row back — a wipe that leaves the one model you had
  // open is worse than no wipe, because it looks like it worked. Callers reload
  // immediately on top of this; between them nothing survives.
  for (const p of await listProjects()) await deleteProject(p.id);
  return all.length;
}

export type SignOutResult = { wiped: number; synced: boolean; reason?: string };

/** Sign out, taking this device's library with it — the whole point — but never
 *  before the account has a copy. The upload is attempted first and its failure is
 *  reported rather than swallowed: erasing work that only existed here, because the
 *  network happened to be down, is the one outcome this must not produce.
 *  `force` is the caller's answer once the user has been told and chosen anyway. */
/** The entire sign-out decision, in ONE place, because the app has two buttons for it —
 *  Settings → Sync, and the account menu — and a second copy that forgets to clear the
 *  device is precisely the bug this was written to fix. The UI passes in how to ask and
 *  how to report; the rules live here. Returns true when the device was cleared, which
 *  is the caller's cue to reload rather than unpick the open project by hand. */
export async function runSignOut(
  ask: (question: string) => boolean,
  say: (message: string, isError?: boolean) => void,
): Promise<boolean> {
  const n = await deviceProjectCount();
  const models = `${n} model${n === 1 ? "" : "s"}`;
  if (!ask(n === 0
    ? "Sign out of this computer?"
    : `Sign out and remove ${models} from this computer?\n\nThey stay in your account — signing back in brings them all back. Anything not yet uploaded is uploaded first.`)) {
    say("");
    return false;
  }
  say("Uploading anything new, then clearing this computer…");
  let r = await signOutAndWipe();
  if (!r.synced) {
    if (!ask(`${r.reason}\n\nSign out and remove ${models} anyway? Anything that never reached your account is gone for good.`)) {
      say(`Still signed in — nothing was removed. ${r.reason}`, true);
      return false;
    }
    r = await signOutAndWipe(true);
  }
  say(n === 0 ? "Signed out." : `Signed out — ${r.wiped} model${r.wiped === 1 ? "" : "s"} removed from this computer.`);
  return true;
}

export async function signOutAndWipe(force = false): Promise<SignOutResult> {
  let synced = false;
  let reason: string | undefined;
  try {
    synced = (await cloudSyncPush()) != null;
    if (!synced) reason = "You're already signed out, so this device's copy was never uploaded.";
  } catch (e) {
    reason = isNetworkError(e)
      ? "This device couldn't reach your account, so anything changed since the last sync isn't uploaded yet."
      : `The upload failed: ${String((e as any)?.message ?? e)}`;
  }
  if (!synced && !force) return { wiped: 0, synced, reason };
  const wiped = await wipeDevice();
  await cloudSignOut();
  return { wiped, synced, reason };
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
