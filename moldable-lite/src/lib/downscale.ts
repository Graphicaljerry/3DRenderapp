// Downscale-before-encode: every vision API resizes what it receives (Anthropic past
// ~1568px on the long edge, OpenAI/Gemini into their own tiles), so pixels beyond that
// ceiling are pure upload weight and token cost — a 12MP phone photo bills several
// times what the model actually looks at. Resizing at ATTACH time makes the preview,
// the chip, and every request downstream use the same slimmed blob.
//
// Format policy: PNG stays PNG (sketch line art stays crisp, transparency survives);
// everything else re-encodes as JPEG 0.9 over a white fill — canvas alpha turns BLACK
// in a JPEG without the fill. A HEIC that the browser can decode (Safari) comes out as
// JPEG, which quietly FIXES iPhone photos for providers that reject HEIC; where the
// browser can't decode it (Chrome), the original passes through untouched and the
// attach-point advice still applies.

export const MAX_IMAGE_DIM = 1568; // Anthropic's ceiling; comfortably ≥ everyone's tiles

/** A square profile photo as a small data URL. Centre-crops to a square (the disc is
 *  round, so the corners were never going to show), then ALWAYS re-encodes — a tiny
 *  but multi-megabyte PNG would otherwise pass straight through and this string is
 *  bound for localStorage, which the settings sync carries wholesale. */
export async function squareAvatar(file: Blob, size = 160): Promise<string | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null; // a format this browser can't decode — the caller says so out loud
  }
  try {
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // JPEG fallback has no alpha; a black disc would be worse
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    for (const [type, q] of [["image/webp", 0.82], ["image/jpeg", 0.82]] as const) {
      const url = canvas.toDataURL(type, q);
      if (url.startsWith(`data:${type}`)) return url; // a browser without webp returns png here
    }
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    bmp.close();
  }
}

export async function downscaleImage(file: Blob, maxDim = MAX_IMAGE_DIM): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    // from-image: bake the EXIF rotation in — a resized photo that loses its
    // orientation tag would come out sideways.
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // undecodable here (HEIC on Chrome, exotic formats) — send as-is
  }
  try {
    const { width, height } = bmp;
    const isPng = file.type === "image/png";
    const oversized = Math.max(width, height) > maxDim;
    // Right-sized and already in a format every provider takes → untouched.
    if (!oversized && (isPng || file.type === "image/jpeg" || file.type === "image/webp")) return file;

    const scale = oversized ? maxDim / Math.max(width, height) : 1;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    if (!isPng) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", 0.9),
    );
    // A re-encode that GREW (tiny PNGs do this) helps nobody — keep the original,
    // unless the original was a format (HEIC…) providers reject.
    const originalOk = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!out || (originalOk && out.size >= file.size && !oversized)) return file;
    return out;
  } finally {
    bmp.close();
  }
}
