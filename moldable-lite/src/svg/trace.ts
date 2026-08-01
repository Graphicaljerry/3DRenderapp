// Bitmap logo → outlines.
//
// An SVG already carries the curves an extrusion needs; a PNG carries pixels, so the
// shape has to be FOUND first. That is what this does: threshold the image to ink /
// no-ink, walk the boundary between the two with marching squares, then simplify the
// staircase of pixel steps into straight runs.
//
// It is honest about what it can and cannot do. Tracing recovers a silhouette, not
// artwork: soft gradients, anti-aliased hairlines and photographs have no single
// boundary to find, so the result would be a noisy blob. The caller gets a quality
// report (`TraceReport`) and shows it BEFORE anything is built, because the cost of
// finding out later is a failed print.
//
// No dependency: potrace-class curve fitting would be prettier, but a 60 KB library for
// a straight-line approximation that a 0.4 mm nozzle cannot resolve anyway is a bad
// trade. Straight segments at ~0.15 px tolerance land well inside one extrusion width.

export interface TracedOutline {
  /** Closed ring in image pixel coordinates, y DOWN (SVG convention). */
  points: [number, number][];
  /** Signed area — positive rings are solid, negative rings are holes punched in them. */
  area: number;
}

export interface TraceReport {
  outlines: TracedOutline[];
  width: number;
  height: number;
  /** Total points after simplification — the number that decides whether this prints. */
  points: number;
  /** Ink coverage 0–1. Near 1 usually means a photo or an inverted image. */
  coverage: number;
  /** How much of the image sits at mid-grey: high = anti-aliased or photographic. */
  softness: number;
  quality: "clean" | "busy" | "unusable";
  notes: string[];
}

/** Points past which an outline stops being a logo and starts being a photo. */
const BUSY_POINTS = 1200;
const MAX_POINTS = 6000;
const MAX_OUTLINES = 400;

/** Otsu's method — pick the threshold that best splits the histogram into two groups.
 *  A fixed 50 % cut turns a mid-grey logo into either nothing or a solid block. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

/** Perpendicular-distance simplification (Douglas–Peucker), iterative. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b <= a + 1) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1, farD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > farD) { farD = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function ringArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return a / 2;
}

/**
 * Trace a bitmap into closed outlines.
 *
 * `alphaFirst`: a PNG with transparency is traced on its ALPHA channel (what the artwork
 * covers), which is almost always what a logo means. Only a fully opaque image falls
 * back to luminance, where the darker side is taken as ink.
 */
export function traceBitmap(img: ImageData, opts: { tolerance?: number } = {}): TraceReport {
  const { width: w, height: h, data } = img;
  const notes: string[] = [];

  // --- build a binary mask -------------------------------------------------------
  const gray = new Uint8Array(w * h);
  let hasAlpha = false;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 250) hasAlpha = true;
    gray[p] = hasAlpha && data[i + 3] < 250
      ? data[i + 3]
      : (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  // Re-read once we know: alpha art measures coverage, opaque art measures darkness.
  const alphaFirst = hasAlpha;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = alphaFirst ? data[i + 3] : 255 - ((data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8);
  }
  const hist = new Uint32Array(256);
  for (let p = 0; p < gray.length; p++) hist[gray[p]]++;
  const t = otsu(hist, gray.length);
  const ink = new Uint8Array(w * h);
  let inkCount = 0, soft = 0;
  for (let p = 0; p < gray.length; p++) {
    if (gray[p] > t) { ink[p] = 1; inkCount++; }
    if (gray[p] > 60 && gray[p] < 195) soft++;
  }
  const coverage = inkCount / (w * h);
  const softness = soft / (w * h);

  // --- marching squares over the ink mask ----------------------------------------
  // Walk each boundary once: a cell's 4 corners give 16 cases, each with an exit
  // direction. Visited EDGES (not cells) are marked so a ring closes exactly once.
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : ink[y * w + x]);
  const seen = new Uint8Array((w + 1) * (h + 1));
  const outlines: TracedOutline[] = [];
  const tol = opts.tolerance ?? 0.15;
  let truncated = false;

  // Step budgets, not just a loop guard. A noisy image yields hundreds of contours and a
  // pathological one can walk without ever closing; without a GLOBAL cap the two multiply
  // into a page-freezing trace (measured: minutes on a 400 px noise field). Blowing the
  // budget is itself the answer — an image this tangled is not a logo.
  const RING_STEPS = 8 * (w + h) + 4000;
  const TOTAL_STEPS = 600_000;
  let spent = 0;

  for (let y = 0; y <= h && !truncated; y++) {
    for (let x = 0; x <= w; x++) {
      // Start only at a cell whose top-left is a rising edge and that no ring has used.
      const idx = y * (w + 1) + x;
      if (seen[idx]) continue;
      const state = (at(x - 1, y - 1) << 3) | (at(x, y - 1) << 2) | (at(x - 1, y) << 1) | at(x, y);
      if (state === 0 || state === 15) continue;
      // Trace this contour.
      const pts: [number, number][] = [];
      let cx = x, cy = y, guard = 0;
      let prevDir = -1;
      do {
        const i2 = cy * (w + 1) + cx;
        seen[i2] = 1;
        pts.push([cx, cy]);
        const a = at(cx - 1, cy - 1), b = at(cx, cy - 1), c = at(cx - 1, cy), d = at(cx, cy);
        const st = (a << 3) | (b << 2) | (c << 1) | d;
        // 0 = right, 1 = down, 2 = left, 3 = up (screen axes, y down).
        // Each direction is the one that keeps INK ON THE LEFT of travel, which is what
        // makes every ring close and gives solids and holes opposite winding:
        //   right ⇔ TR ink, BR clear   down ⇔ BR ink, BL clear
        //   left  ⇔ BL ink, TL clear   up   ⇔ TL ink, TR clear
        // Saddles (6, 9) have two legal exits; carrying on in the previous direction
        // keeps two diagonally-touching blobs as separate rings instead of fusing them.
        let dir: number;
        switch (st) {
          case 1: case 5: case 13: dir = 1; break;  // down
          case 2: case 3: case 7: dir = 2; break;   // left
          case 4: case 12: case 14: dir = 0; break; // right
          case 8: case 10: case 11: dir = 3; break; // up
          case 6: dir = prevDir === 3 ? 0 : 2; break;
          case 9: dir = prevDir === 0 ? 1 : 3; break;
          default: dir = -1;
        }
        if (dir < 0) break;
        prevDir = dir;
        if (dir === 0) cx++; else if (dir === 1) cy++; else if (dir === 2) cx--; else cy--;
      } while ((cx !== x || cy !== y) && ++guard < RING_STEPS);
      spent += guard;
      if (spent > TOTAL_STEPS) { truncated = true; break; }
      if (pts.length < 8) continue;
      const simple = simplify(pts, tol);
      if (simple.length < 4) continue;
      outlines.push({ points: simple, area: ringArea(simple) });
      if (outlines.length >= MAX_OUTLINES) { truncated = true; break; }
    }
  }

  const points = outlines.reduce((n, o) => n + o.points.length, 0);

  // --- judgement ------------------------------------------------------------------
  let quality: TraceReport["quality"] = "clean";
  if (!outlines.length) {
    quality = "unusable";
    notes.push("Nothing to trace — the image is one flat tone. A logo needs solid dark shapes on a light background (or a transparent PNG).");
  } else if (points > MAX_POINTS || truncated) {
    quality = "unusable";
    notes.push(`Far too detailed to cut cleanly (${truncated ? `${MAX_OUTLINES}+` : points} outlines' worth of edges). This looks like a photo or heavily textured art rather than a logo.`);
  } else if (points > BUSY_POINTS) {
    quality = "busy";
    notes.push(`Very detailed (${points} edge points) — it will build, but fine strokes may not survive a 0.4 mm nozzle. Simplify the art or print it larger.`);
  }
  if (softness > 0.32 && quality !== "unusable") {
    quality = quality === "clean" ? "busy" : quality;
    notes.push("Lots of soft/anti-aliased edges — the outline was guessed at the midpoint. A hard-edged black-and-white image traces far more accurately.");
  }
  if (coverage > 0.86) notes.push("Almost the whole image is ink — if the logo came out inverted, export it as dark-on-light.");
  if (Math.min(w, h) < 200 && quality !== "unusable") notes.push(`Small source (${w}×${h} px) — 600 px or more on the short edge keeps curves smooth.`);

  return { outlines, width: w, height: h, points, coverage, softness, quality, notes };
}

/** Traced rings → an SVG document, so a bitmap logo re-enters the SAME extrude/emboss
 *  path an uploaded vector uses. One code path to the solid, one set of behaviours. */
export function outlinesToSvg(r: TraceReport): string {
  // Even-odd fill: a hole ring inside a solid ring punches through without needing the
  // winding of every ring to be normalised first.
  const d = r.outlines
    .map((o) => `M${o.points.map(([x, y]) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`).join("L")}Z`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}"><path fill="#000" fill-rule="evenodd" d="${d}"/></svg>`;
}

/** Decode a bitmap file to ImageData, downscaling first: tracing a 4000 px photo costs
 *  seconds and yields no detail a printer can hold. */
export async function bitmapToImageData(file: Blob, maxDim = 1024): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable — can't read the image.");
    ctx.drawImage(bmp, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    bmp.close();
  }
}
