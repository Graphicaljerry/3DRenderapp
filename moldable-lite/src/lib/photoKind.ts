// Is this attached picture a drawing or a photograph?
//
// It matters because the two are read differently. A sketch carries INTENT and written
// numbers — its outlines are the part's edges and a handwritten "40mm" is a given, not an
// estimate. A photograph carries proportions, which have to be estimated. The CAD system
// prompt already says both of those things (prompts.ts); until now it had to work out
// which picture was which on its own, and the strip called whatever landed first "Front"
// whether it was a photo of a bracket or a dimensioned drawing on graph paper.
//
// Decided here, on the pixels, rather than by asking a vision model: it has to be instant,
// it has to work with no key and no network, and a wrong answer costs one click to fix.
//
// The shape of the test is stroke thinness. Brightness alone does not separate the two —
// the photograph the app's own advice asks for is a part on a plain white background, so it
// is as bright and as colourless as a page. What separates them is what the DARK pixels are
// doing: in a drawing they are strokes, so nearly every one of them sits against the page,
// while an object's dark pixels are the inside of a shape and mostly sit against each other.
// That measurement survives the things that break the easier ones — a vignette from a phone
// camera, uneven desk light, a drawing that has been shaded.

/** What the strip shows on a thumbnail and what the request calls the picture. */
export type PhotoKind = "sketch" | "photo";

const SIDE = 96; // enough to resolve strokes, small enough to be free

/** Rec. 709 luma, 0–1. */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** How far from grey, 0–1 (HSV saturation). */
function chroma(r: number, g: number, b: number): number {
  const hi = Math.max(r, g, b);
  return hi === 0 ? 0 : (hi - Math.min(r, g, b)) / hi;
}

/** The measurements the verdict is made from — returned so the probe can assert on the
 *  numbers rather than only on the label. */
export type PhotoStats = {
  /** Fraction of the picture that is page-bright. */
  page: number;
  /** Fraction that is dark enough to be a mark. */
  mark: number;
  /** Fraction of mark pixels touching a page-bright one — 1 means every mark is a stroke edge. */
  stroke: number;
  /** Fraction carrying real colour. */
  colour: number;
};

export function classify(stats: PhotoStats): PhotoKind {
  const { page, mark, stroke, colour } = stats;
  // Colour settles it first: a coloured picture is a photograph, whatever its tones say.
  // Pencil, blue ballpoint and whiteboard marker all sit well under this.
  if (colour > 0.12) return "photo";
  // Nothing dark enough to be a line means nothing was drawn — a pale part on pale paper,
  // not a blank sheet somebody attached on purpose.
  if (mark < 0.004) return "photo";
  // A picture with no page left in it is a photograph that fills the frame. Low, because
  // a phone camera's vignette eats the corners of a sheet of paper.
  if (page < 0.2) return "photo";
  return stroke >= 0.55 ? "sketch" : "photo";
}

/** Measure a picture. Exported for the probe; `photoKind` is what the app calls. */
export function measure(px: Uint8ClampedArray, w: number, h: number): PhotoStats {
  const n = w * h;
  const band = new Uint8Array(n); // 0 mark · 1 neither · 2 page
  let page = 0;
  let mark = 0;
  let colour = 0;
  for (let i = 0; i < n; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const l = luma(r, g, b);
    // Chroma is unstable at both ends — a near-white pixel and a near-black one report
    // wild saturation off a couple of levels of noise — so only the midrange votes on
    // colour. That midrange is exactly where an object's own colour would be.
    if (l > 0.12 && l < 0.94 && chroma(r, g, b) > 0.25) colour++;
    // The mark band reaches well above true black: a 2H pencil line is grey to begin with,
    // and shrinking the picture to 96px blends every stroke with the page it sits on.
    if (l >= 0.82) {
      band[i] = 2;
      page++;
    } else if (l > 0.62) {
      band[i] = 1;
    } else {
      mark++;
    }
  }
  let edged = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (band[i] !== 0) continue;
      const touchesPage =
        (x > 0 && band[i - 1] === 2) ||
        (x < w - 1 && band[i + 1] === 2) ||
        (y > 0 && band[i - w] === 2) ||
        (y < h - 1 && band[i + w] === 2);
      if (touchesPage) edged++;
    }
  }
  return { page: page / n, mark: mark / n, stroke: mark ? edged / mark : 0, colour: colour / n };
}

/** Read a picture and say what it is. Falls back to "photo" on anything undecodable —
 *  the label is then simply the one the app used to assume, and nothing else changes. */
export async function photoKind(file: Blob): Promise<PhotoKind> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return "photo"; // HEIC on Chrome and friends: undecodable here, unreadable either way
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIDE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "photo";
    // Squashed to a square rather than letterboxed: bars of fill colour would count as
    // paper on a wide photo and swing the very fraction being measured.
    ctx.drawImage(bmp, 0, 0, SIDE, SIDE);
    return classify(measure(ctx.getImageData(0, 0, SIDE, SIDE).data, SIDE, SIDE));
  } finally {
    bmp.close();
  }
}
