// Desktop-only update notifier. The installed Mac/Windows app is a frozen bundle —
// unlike the web app (a PWA that updates itself), it never changes until the user
// installs a newer build. Every push to main refreshes the rolling "desktop-latest"
// release, whose title carries the build number (the same commit count the status
// bar shows), so the app polls that release and offers the right installer when
// it's ahead of the running build.
//
// TAURI_ENV_PLATFORM is baked in at build time (vite envPrefix) — empty in the web
// build, so all of this is dead code there and the chip never renders.

export const DESKTOP_PLATFORM: string = import.meta.env.TAURI_ENV_PLATFORM ?? "";
export const IS_DESKTOP = DESKTOP_PLATFORM !== "";

const RELEASE_API = "https://api.github.com/repos/Graphicaljerry/3DRenderapp/releases/tags/desktop-latest";

export interface DesktopUpdate {
  version: number; // the newer build number
  url: string; // direct download for THIS platform's installer
}

export async function checkDesktopUpdate(currentBuild: number): Promise<DesktopUpdate | null> {
  if (!IS_DESKTOP || !Number.isFinite(currentBuild)) return null;
  try {
    const r = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null; // rate-limited (60/h unauthenticated) or offline — next poll retries
    const j = await r.json();
    const version = Number(/v(\d+)/.exec(j?.name ?? "")?.[1] ?? 0);
    if (!(version > currentBuild)) return null;
    const want = DESKTOP_PLATFORM === "darwin" ? ".dmg" : "-setup.exe";
    const asset = (j?.assets ?? []).find((a: any) => typeof a?.name === "string" && a.name.endsWith(want));
    return { version, url: asset?.browser_download_url ?? j?.html_url ?? "https://github.com/Graphicaljerry/3DRenderapp/releases" };
  } catch {
    return null;
  }
}

/** Open the installer download in the system browser (Tauri blocks target=_blank). */
export async function openDownload(url: string): Promise<void> {
  try {
    (await import("@tauri-apps/plugin-opener")).openUrl(url);
  } catch {
    window.open(url, "_blank"); // dev/web fallback
  }
}
