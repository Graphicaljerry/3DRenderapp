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

/** How many reference pictures one request carries: the front photo plus nine more.
 *  More angles is strictly better context — the far side and the depth stop being
 *  guesswork — and ten right-sized photos is ~4 MB and ~16k vision tokens, which every
 *  routed model takes. Past that the returns flatten and the upload starts to hurt. */
export const MAX_PHOTOS = 10;

/** Refused before decoding. Nothing legitimate arrives this big (a 48 MP HEIC is ~10 MB),
 *  and decoding a 100 MP file to a bitmap is how an iPad tab dies. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** The whole picture payload of one request, encoded. Providers cap the body, not the
 *  count — OpenRouter passes the body straight through to whichever model it routed to,
 *  so the ceiling that matters is the strictest one downstream. */
export const PHOTO_BUDGET_BYTES = 9 * 1024 * 1024;

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

export async function downscaleImage(file: Blob, maxDim = MAX_IMAGE_DIM, forceJpeg = false): Promise<Blob> {
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
    const isPng = file.type === "image/png" && !forceJpeg;
    const oversized = Math.max(width, height) > maxDim;
    // Right-sized and already in a format every provider takes → untouched.
    if (!oversized && !forceJpeg && (isPng || file.type === "image/jpeg" || file.type === "image/webp")) return file;

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
    if (!out || (originalOk && out.size >= file.size && !oversized && !forceJpeg)) return file;
    return out;
  } finally {
    bmp.close();
  }
}

/** Hold a whole set of reference photos under a byte budget, shrinking the SET rather
 *  than the newest arrival: the model reads them as equal observations of one object,
 *  and one mushy photo among nine sharp ones is worse context than ten even ones.
 *
 *  Ten camera photos are already ~4 MB after the attach-time resize and never reach
 *  this. Screenshots do: PNG stays PNG (line art has to stay crisp) and ten of those
 *  can run to tens of megabytes — a body the provider rejects outright, which reads to
 *  the user as "the AI is broken" rather than "that was too much to upload". JPEG at
 *  full resolution is tried before any resolution is given up. */
export async function fitPhotoBudget(blobs: Blob[], budget = PHOTO_BUDGET_BYTES): Promise<Blob[]> {
  const total = (bs: Blob[]) => bs.reduce((n, b) => n + b.size, 0);
  if (blobs.length < 2 || total(blobs) <= budget) return blobs;
  let out = blobs;
  for (const dim of [MAX_IMAGE_DIM, 1280, 1024, 768]) {
    out = await Promise.all(blobs.map((b) => downscaleImage(b, dim, true)));
    if (total(out) <= budget) break;
  }
  return out;
}

/** A transcript-sized picture. The chat kept the FULL attached photo as its thumbnail —
 *  a 1568 px data URL, hundreds of kilobytes — which the sync then dropped on the floor,
 *  because a project row that carries ten of those per message times out on the server.
 *  That is why photos showed up in the chat on the machine you attached them from and
 *  nowhere else. The bubble draws these at 40-120 px and the lightbox a few hundred, so
 *  a few hundred pixels of webp is all the transcript ever needed. */
export async function chatThumb(file: Blob, maxDim = 420): Promise<string | undefined> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return undefined; // undecodable here — the message just carries no picture
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "#fff"; // webp/jpeg have no alpha; a black backdrop would be worse
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    for (const [type, q] of [["image/webp", 0.72], ["image/jpeg", 0.72]] as const) {
      const url = canvas.toDataURL(type, q);
      if (url.startsWith(`data:${type}`)) return url; // a browser without webp returns png here
    }
    return canvas.toDataURL("image/jpeg", 0.6);
  } finally {
    bmp.close();
  }
}
