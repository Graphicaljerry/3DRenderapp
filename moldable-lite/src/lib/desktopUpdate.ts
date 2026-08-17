// Desktop-only updates. The installed Mac/Windows app is a frozen bundle — unlike the
// web app (a PWA that updates itself), it never changes until a newer build is
// installed. Every push to main refreshes the rolling "desktop-latest" release, which
// carries a signed `latest.json`; the app reads it and updates ITSELF in the
// background, then offers a restart. No re-download, no drag-to-Applications, and no
// Gatekeeper prompt — the bytes arrive through the app rather than a browser, so they
// never get the quarantine flag that triggers the "damaged" warning.
//
// Signature checking is enforced by the Rust plugin against the pubkey baked into
// tauri.conf.json, so a tampered release can't install.
//
// TAURI_ENV_PLATFORM is baked in at build time (vite envPrefix) — empty in the web
// build, so all of this is dead code there and nothing ever renders or polls.

export const DESKTOP_PLATFORM: string = import.meta.env.TAURI_ENV_PLATFORM ?? "";
export const IS_DESKTOP = DESKTOP_PLATFORM !== "";

const RELEASE_API = "https://api.github.com/repos/Graphicaljerry/3DRenderapp/releases/tags/desktop-latest";

/** What the status-bar chip is showing. */
export type UpdateState =
  | { phase: "installing"; version: string } // downloading/swapping in the background
  | { phase: "ready"; version: string } // installed — a restart finishes it
  | { phase: "manual"; version: string; url: string }; // no signed artifact (or install failed) — hand over the installer

// One update run for the whole app, with its state remembered: a second subscriber
// (a re-mount, React's double-invoked dev effects) joins the run in progress and is
// replayed the current state instead of kicking off a second download.
const listeners = new Set<(s: UpdateState) => void>();
let last: UpdateState | null = null;
let inflight: Promise<void> | null = null;
const emit = (s: UpdateState) => { last = s; for (const l of listeners) l(s); };

/** Subscribe to update progress (and start a check). Returns an unsubscribe.
    No-ops off the desktop, so the web build never renders or polls anything. */
export function watchDesktopUpdate(currentBuild: number, onState: (s: UpdateState) => void): () => void {
  if (!IS_DESKTOP) return () => {};
  listeners.add(onState);
  if (last) onState(last); // late subscriber catches up
  void checkForUpdate(currentBuild);
  return () => { listeners.delete(onState); };
}

/** Run a check now (the app also calls this on a timer). Deduped. */
export function checkForUpdate(currentBuild: number): Promise<void> {
  if (!IS_DESKTOP) return Promise.resolve();
  if (last?.phase === "ready") return Promise.resolve(); // installed already — waiting on the restart
  if (!inflight) inflight = runDesktopUpdate(currentBuild).finally(() => { inflight = null; });
  return inflight;
}

async function runDesktopUpdate(currentBuild: number): Promise<void> {
  const onState = emit;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const up = await check();
    if (up?.available) {
      onState({ phase: "installing", version: up.version });
      try {
        await up.downloadAndInstall(); // verifies the signature, swaps the bundle in place
        onState({ phase: "ready", version: up.version });
        return;
      } catch (e) {
        // Installed copy isn't writable (e.g. it's still in the DMG), or the download
        // died — fall through to a plain download so the user is never stuck.
        console.warn("desktop update: silent install failed, offering the installer", e);
        const m = await manualUpdate(currentBuild);
        if (m) onState(m);
        return;
      }
    }
    // No signed update advertised. A newer build may still exist (e.g. built before
    // update signing was switched on) — offer the installer rather than going quiet.
    const m = await manualUpdate(currentBuild);
    if (m) onState(m);
  } catch (e) {
    console.warn("desktop update: check failed", e);
    const m = await manualUpdate(currentBuild).catch(() => null);
    if (m) onState(m);
  }
}

/** Release-feed fallback: is a newer build published, and where's this platform's installer? */
async function manualUpdate(currentBuild: number): Promise<Extract<UpdateState, { phase: "manual" }> | null> {
  if (!Number.isFinite(currentBuild)) return null;
  const r = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) return null; // rate-limited (60/h unauthenticated) or offline — the next poll retries
  const j = await r.json();
  const version = Number(/v(\d+)/.exec(j?.name ?? "")?.[1] ?? 0);
  if (!(version > currentBuild)) return null;
  const want = DESKTOP_PLATFORM === "darwin" ? ".dmg" : "-setup.exe";
  const asset = (j?.assets ?? []).find((a: any) => typeof a?.name === "string" && a.name.endsWith(want));
  return {
    phase: "manual",
    version: String(version),
    url: asset?.browser_download_url ?? j?.html_url ?? "https://github.com/Graphicaljerry/3DRenderapp/releases",
  };
}

/** Relaunch into the freshly installed build. */
export async function restartApp(): Promise<void> {
  try {
    await (await import("@tauri-apps/plugin-process")).relaunch();
  } catch (e) {
    console.warn("desktop update: relaunch failed", e);
  }
}

/** Open a download in the system browser (the webview blocks target=_blank). */
export async function openDownload(url: string): Promise<void> {
  try {
    await (await import("@tauri-apps/plugin-opener")).openUrl(url);
  } catch {
    window.open(url, "_blank"); // dev/web fallback
  }
}
