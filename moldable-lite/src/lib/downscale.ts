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
