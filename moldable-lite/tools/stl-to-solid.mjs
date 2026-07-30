/* Slice a binary STL into one closed-loop set per printed layer — the same thing a slicer
   shows in preview — and emit the compact string src/launch/meshSolids.ts stores.

   This is how a shape gets into the launchpad animation ACCURATELY. Hand-authored polygons
   can carry a vase (one profile, revolved) but not a 3DBenchy or an articulated dragon:
   those are five or six disconnected islands per layer and no single outline stands in for
   them. Point this at the real mesh instead.

     node tools/stl-to-solid.mjs model.stl 0.60 30 0.003 > out.json

   Arguments after the file are all optional:
     footprint   longest horizontal dimension, in bed units where 1 = the whole bed  (0.60)
     layers      printed layers in the animation; ~50 per unit of height reads well   (26)
     rdpFrac     simplify tolerance as a fraction of the model's longest side         (0.010)
     minAreaFrac drop loops smaller than this fraction of the footprint area          (0.0016)

   Paste the resulting `enc` and `height` into src/launch/meshSolids.ts and reference it from
   SOLIDS with fromLayers(). Binary STL only — re-export from any slicer if yours is ASCII. */
import fs from 'fs';

const FILE    = process.argv[2];
const TARGET  = Number(process.argv[3] ?? 0.60);   // longest footprint dim, in bed units
const LAYERS  = Number(process.argv[4] ?? 26);     // printed layers in the animation
const RDPF    = Number(process.argv[5] ?? 0.010);  // simplify tol, fraction of max dim
const MINA    = Number(process.argv[6] ?? 0.0016); // drop loops below this fraction of the footprint area
const MAXL    = Number(process.argv[7] ?? 40);     // keep at most this many loops per layer, largest first
const ROT     = Number(process.argv[8] ?? 0);      // spin the model on the bed, degrees CCW in bed coords

/* ---------- read ---------- */
const buf = fs.readFileSync(FILE);
const nTri = buf.readUInt32LE(80);
if (84 + nTri * 50 !== buf.length) throw new Error(`not a binary STL (n=${nTri}, len=${buf.length})`);
const V = new Float32Array(nTri * 9);
for (let i = 0; i < nTri; i++) {
  const o = 84 + i * 50 + 12;
  for (let k = 0; k < 9; k++) V[i * 9 + k] = buf.readFloatLE(o + k * 4);
}
let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < V.length; i += 3)
  for (let a = 0; a < 3; a++) { const v = V[i + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }

/* Spin the model on the bed before anything else, so every step downstream sees the final
   orientation. Which way a part faces matters: the isometric view puts +x+y nearest the
   viewer, so a model whose "front" runs along that diagonal reads as facing you. */
if (ROT) {
  const a = (ROT * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  for (let i = 0; i < V.length; i += 3) {
    const dx = V[i] - cx, dy = V[i + 1] - cy;
    V[i] = cx + dx * ca - dy * sa;
    V[i + 1] = cy + dx * sa + dy * ca;
  }
  lo = [Infinity, Infinity, lo[2]]; hi = [-Infinity, -Infinity, hi[2]];
  for (let i = 0; i < V.length; i += 3)
    for (let a2 = 0; a2 < 2; a2++) { const v = V[i + a2]; if (v < lo[a2]) lo[a2] = v; if (v > hi[a2]) hi[a2] = v; }
}
const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
const MAXD = Math.max(size[0], size[1]);
console.error(`tris ${nTri}  bbox ${size.map(s => s.toFixed(2)).join(' x ')}`);

/* ---------- z bins ---------- */
const NBIN = 512, z0 = lo[2], zh = size[2];
const bins = Array.from({ length: NBIN }, () => []);
for (let i = 0; i < nTri; i++) {
  const a = V[i * 9 + 2], b = V[i * 9 + 5], c = V[i * 9 + 8];
  const clamp = v => Math.max(0, Math.min(NBIN - 1, Math.floor(((v - z0) / zh) * NBIN)));
  const b0 = clamp(Math.min(a, b, c)), b1 = clamp(Math.max(a, b, c));
  for (let k = b0; k <= b1; k++) bins[k].push(i);
}

function segmentsAt(z) {
  const bi = Math.max(0, Math.min(NBIN - 1, Math.floor(((z - z0) / zh) * NBIN)));
  const out = [];
  for (const i of bins[bi]) {
    const p = [[V[i*9], V[i*9+1], V[i*9+2]], [V[i*9+3], V[i*9+4], V[i*9+5]], [V[i*9+6], V[i*9+7], V[i*9+8]]];
    const d = [p[0][2] - z, p[1][2] - z, p[2][2] - z];
    if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0)) continue;
    const h = [];
    for (let e = 0; e < 3; e++) {
      const a = p[e], b = p[(e + 1) % 3], da = d[e], db = d[(e + 1) % 3];
      if ((da <= 0 && db > 0) || (db <= 0 && da > 0)) {
        const t = da / (da - db);
        h.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (h.length === 2 && (h[0][0] !== h[1][0] || h[0][1] !== h[1][1])) out.push(h);
  }
  return out;
}

/* ---------- chain into CLOSED loops only ---------- */
const EPS = MAXD * 1e-4;
const key = p => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
function loopsAt(z) {
  const segs = segmentsAt(z);
  const at = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      let l = at.get(k); if (!l) at.set(k, l = []);
      l.push([i, e]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const pts = [segs[s][0], segs[s][1]];
    let cur = segs[s][1], closed = false;
    for (let guard = 0; guard <= segs.length; guard++) {
      if (key(cur) === key(pts[0])) { closed = true; break; }
      let nxt = -1, nend = 0;
      for (const [i, e] of at.get(key(cur)) ?? []) if (!used[i]) { nxt = i; nend = e; break; }
      if (nxt < 0) break;
      used[nxt] = 1;
      cur = segs[nxt][1 - nend];
      pts.push(cur);
    }
    // An open chain means the plane grazed a vertex or the mesh has a crack. Dropping it is
    // right: half a contour drawn as if closed is what produced the chevrons in the first
    // attempt at this. Real features always close.
    if (closed && pts.length >= 4) { pts.pop(); loops.push(pts); }
  }
  return loops;
}

const area = pts => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};

/* ---------- Ramer-Douglas-Peucker on a closed loop ---------- */
function rdp(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  // Split the loop at the point farthest from pts[0] so RDP has two well-conditioned arcs.
  let fi = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) { fd = d; fi = i; }
  }
  keep[fi] = 1;
  const P = i => pts[i % pts.length];         // index n wraps back to the loop's first point
  const rec = (a, b) => {
    if (b - a < 2) return;
    const [ax, ay] = P(a), [bx, by] = P(b);
    const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey);
    let mi = -1, md = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = P(i);
      const d = el > 1e-12
        ? Math.abs((px - ax) * ey - (py - ay) * ex) / el
        : Math.hypot(px - ax, py - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); }
  };
  rec(0, fi); rec(fi, pts.length);
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* ---------- per layer ---------- */
const raw = [];
for (let L = 0; L < LAYERS; L++) {
  // Sample at the MIDDLE of each layer band, never on a cap: a plane exactly on the base or
  // the top face cuts coplanar triangles and yields garbage.
  const z = z0 + zh * ((L + 0.5) / LAYERS);
  raw.push(loopsAt(z));
}

/* ---------- normalise to bed units ---------- */
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const ls of raw) for (const l of ls) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
const S = Math.max(x1 - x0, y1 - y0) / TARGET;
const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
const HEIGHT = zh / S;
const footArea = ((x1 - x0) / S) * ((y1 - y0) / S);
const tol = (MAXD * RDPF) / S;

let kept = 0, dropped = 0, pts = 0, capped = 0;
const layers = raw.map(ls => {
  const out = [];
  for (let l of ls) {
    l = l.map(([x, y]) => [0.5 + (x - mx) / S, 0.5 + (y - my) / S]);
    if (Math.abs(area(l)) < footArea * MINA) { dropped++; continue; }
    const s = rdp(l, tol);
    if (s.length < 3) { dropped++; continue; }
    out.push(s); kept++; pts += s.length;
  }
  // Biggest first: the nozzle rides loop 0, and it should ride the part's outline.
  out.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  if (out.length > MAXL) { capped += out.length - MAXL; out.length = MAXL; }
  return out;
});
if (capped) console.error(`capped ${capped} loops at ${MAXL}/layer`);

// A model that tapers to nothing (a skull's horns, a rocket's tip) can end in layers whose
// every loop fell under minAreaFrac. Drawing those is a visible pause at the end of the
// print, so trim them and shorten the solid to match.
while (layers.length > 1 && layers[layers.length - 1].length === 0) layers.pop();
const height = HEIGHT * (layers.length / LAYERS);

console.error(`footprint ${((x1-x0)/S).toFixed(3)} x ${((y1-y0)/S).toFixed(3)}  height ${height.toFixed(3)}`);
console.error(`loops kept ${kept} (dropped ${dropped})  points ${pts}  avg ${(pts/Math.max(kept,1)).toFixed(1)}/loop`);
console.error(`loops per layer: ${layers.map(l => l.length).join(',')}`);

const q = v => Math.round(v * 1000);
const enc = layers.map(ls => ls.map(l => l.map(([x, y]) => `${q(x)},${q(y)}`).join(',')).join(';')).join('|');
console.error(`encoded ${enc.length} chars`);
process.stdout.write(JSON.stringify({ height: +height.toFixed(4), layers: layers.length, enc }));
