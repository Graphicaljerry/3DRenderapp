// "Open in slicer" — verified against the slicers' own source (2026-07):
// - Bambu Studio registers bambustudioopen:// on macOS and bambustudio://open?file= on
//   Win/Linux. It only fetches http(s) URLs; non-MakerWorld domains show a
//   "not from a trusted site — open anyway?" confirm (v2.1.0+).
// - OrcaSlicer registers orcaslicer://open?file= with NO domain allowlist.
// - A browser Blob can't be deep-linked, so locally we park the 3MF on the dev
//   relay (/prox/hold) and hand the slicer that localhost URL. On a static host
//   there's no relay → download fallback (double-click opens via .3mf association).

import { downloadBlob } from "./download";

export type SlicerTarget = "bambu" | "orca";

const isMacLike = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

function deepLink(target: SlicerTarget, fileUrl: string): string {
  const enc = encodeURIComponent(fileUrl);
  if (target === "orca") return `orcaslicer://open?file=${enc}`;
  return isMacLike() ? `bambustudioopen://${enc}` : `bambustudio://open?file=${enc}`;
}

/** Returns how the model was delivered: "deeplink" (slicer launched) or "download" (fallback). */
export async function openInSlicer(target: SlicerTarget, blob: Blob, filename: string): Promise<"deeplink" | "download"> {
  // The hold route only exists on the local dev relay.
  if (import.meta.env.DEV) {
    try {
      const r = await fetch(`/prox/hold?name=${encodeURIComponent(filename)}`, { method: "POST", body: blob });
      if (r.ok) {
        const { url } = (await r.json()) as { url: string };
        window.location.href = deepLink(target, `${window.location.origin}${url}`);
        return "deeplink";
      }
    } catch {
      /* fall through to download */
    }
  }
  downloadBlob(blob, filename);
  return "download";
}
