// "Open in slicer" — three routes, because the browser and the desktop app have
// completely different powers here.
//
// DESKTOP (Tauri): the real one. A Rust command writes the 3MF to a stable path in
// the app's data folder and we hand that path to the OS, which opens whichever slicer
// owns .3mf — the one the user already installed and set as their default. No deep
// link, no security prompt, no guessing at application names. Because the path is
// stable per project, sending an edited model again overwrites the same file, so
// "reload from disk" in the slicer picks up v2 without losing print settings.
//
// WEB, LOCAL DEV: a slicer can only be deep-linked to an http(s) URL, so the 3MF is
// parked on the dev relay (/prox/hold) and the slicer is handed that localhost URL.
// Verified against the slicers' own source (2026-07): Bambu Studio registers
// bambustudioopen:// on macOS and bambustudio://open?file= on Win/Linux, and shows a
// "not from a trusted site — open anyway?" confirm for non-MakerWorld domains
// (v2.1.0+); OrcaSlicer registers orcaslicer://open?file= with no domain allowlist.
// PrusaSlicer registers prusaslicer://open?file= but REJECTS anything that isn't
// printables.com, so it is deliberately not offered as a deep link — it would be a
// button that never works.
//
// WEB, HOSTED: no relay, so the file downloads. Double-clicking it opens whatever
// slicer owns .3mf, which is the same destination by a slower road.

import { downloadBlob } from "./download";
import { IS_DESKTOP } from "./desktopUpdate";

export type SlicerTarget = "bambu" | "orca";

/** How the model reached the slicer, for an honest receipt. */
export type Handoff =
  | { how: "desktop"; path: string; opened: boolean }
  | { how: "deeplink" }
  | { how: "download" };

const isMacLike = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

function deepLink(target: SlicerTarget, fileUrl: string): string {
  const enc = encodeURIComponent(fileUrl);
  if (target === "orca") return `orcaslicer://open?file=${enc}`;
  return isMacLike() ? `bambustudioopen://${enc}` : `bambustudio://open?file=${enc}`;
}

/** Write the file next to the app and let the OS open it. Throws only when the file
    can't be written at all, so the caller can fall back to a download rather than
    leave the user with nothing. */
async function handToDesktopSlicer(blob: Blob, filename: string): Promise<{ path: string; opened: boolean }> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { openPath, revealItemInDir } = await import("@tauri-apps/plugin-opener");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Passing the bytes AS the payload sends them as a raw body; nested in an object
  // they would be JSON-stringified one decimal number at a time. Header values must
  // be ASCII, and the name is a project title the user typed.
  const path = await invoke<string>("stage_for_slicer", bytes, {
    headers: { "x-moldable-name": filename.replace(/[^\x20-\x7E]/g, "-") },
  });
  try {
    await openPath(path);
    return { path, opened: true };
  } catch {
    // Nothing on this machine claims .3mf. The file is real and correct, so show it
    // rather than pretending the hand-off failed.
    await revealItemInDir(path).catch(() => {});
    return { path, opened: false };
  }
}

export async function openInSlicer(target: SlicerTarget, blob: Blob, filename: string): Promise<Handoff> {
  if (IS_DESKTOP) {
    try {
      return { how: "desktop", ...(await handToDesktopSlicer(blob, filename)) };
    } catch {
      /* nowhere to write it — a download still gets them there */
    }
  } else if (import.meta.env.DEV) {
    try {
      const r = await fetch(`/prox/hold?name=${encodeURIComponent(filename)}`, { method: "POST", body: blob });
      if (r.ok) {
        const { url } = (await r.json()) as { url: string };
        window.location.href = deepLink(target, `${window.location.origin}${url}`);
        return { how: "deeplink" };
      }
    } catch {
      /* fall through to download */
    }
  }
  downloadBlob(blob, filename);
  return { how: "download" };
}
