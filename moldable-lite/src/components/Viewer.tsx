import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ViewerHandle {
  resetView: () => void;
  /** Render a small, cleanly-framed preview of the current model (no grid/dims/pins). Null if empty. */
  captureThumbnail: () => string | null;
}

export interface PickedPoint {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
}
/** A selected model feature — a face, edge or vertex — with everything an edit needs. */
export interface PickedFeature {
  kind: "face" | "edge" | "vertex";
  label: string;
  cx: number; cy: number; cz: number; // face centre / edge midpoint / vertex
  nx?: number; ny?: number; nz?: number; // face normal
  w?: number; h?: number; // face in-plane size
  ax?: number; ay?: number; az?: number; // edge endpoint A
  bx?: number; by?: number; bz?: number; // edge endpoint B
  len?: number; // edge length
}
export interface ViewerPin { id: string; x: number; y: number; z: number; }

interface Props {
  geometry: THREE.BufferGeometry | null;
  wireframe: boolean;
  showDims: boolean;
  units: "mm" | "in";
  theme: "light" | "dark";
  pins: ViewerPin[];
  selectedPin: string | null;
  pinMode: boolean;
  selectMode: boolean;
  selectKind: "face" | "edge" | "vertex";
  onPickPoint: (p: PickedPoint) => void;
  onPickFeature: (f: PickedFeature) => void;
  onSelectPin: (id: string) => void;
}

const THEME_SCENE = { light: "#f6f7f9", dark: "#101418" } as const;
const THEME_GRID: Record<string, [number, number]> = { light: [0xced2d8, 0xe3e6ea], dark: [0x39414b, 0x232a31] };

// Dimension-label size band, in screen pixels (≈ 12–40 pt).
const LABEL_MIN_PX = 16;
const LABEL_MAX_PX = 53;

interface TriData {
  normals: Float32Array; // per-triangle unit normal
  d: Float32Array; // per-triangle plane offset (normal · vertex)
  count: number;
  pos: THREE.BufferAttribute;
  idx: THREE.BufferAttribute | null;
  adj: Int32Array; // count*3 — neighbouring triangle across each edge (-1 = none)
  vpos: Float32Array; // unique welded vertex positions
  nUnique: number;
  edges: Float32Array; // sharp edges: [ax,ay,az, bx,by,bz] per segment
  edgeCount: number;
}

interface Internals {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  content: THREE.Group;
  mesh: THREE.Mesh | null;
  dims: THREE.Group | null;
  pins: THREE.Group | null;
  material: THREE.MeshStandardMaterial;
  highlight: THREE.Mesh; // translucent overlay for the hovered/selected face
  edgeHi: THREE.Mesh; // solid marker for a hovered/selected edge (a thin cylinder)
  vertHi: THREE.Mesh; // solid marker for a hovered/selected vertex (a small sphere)
  markR: number; // marker radius, scaled to the model
  tri: TriData | null;
  lockedHit: { faceIndex: number; point: THREE.Vector3 } | null; // click-locked feature
  ro: ResizeObserver;
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({ geometry, wireframe, showDims, units, theme, pins, selectedPin, pinMode, selectMode, selectKind, onPickPoint, onPickFeature, onSelectPin }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const st = useRef<Internals | null>(null);
  const cb = useRef({ pinMode, selectMode, selectKind, onPickPoint, onPickFeature, onSelectPin });
  cb.current = { pinMode, selectMode, selectKind, onPickPoint, onPickFeature, onSelectPin };
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);

  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f6f7f9");

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(140, -180, 130);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 15);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 1.05));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(80, -120, 200);
    scene.add(dir);

    const grid = new THREE.GridHelper(300, 30, ...THEME_GRID.light);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);

    const material = new THREE.MeshStandardMaterial({ color: "#c7ccd3", metalness: 0.05, roughness: 0.75 });

    // Blue overlay drawn on top of the hovered / selected face (Blender/Shapr-style).
    const highlight = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x2563eb, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    highlight.visible = false;
    highlight.renderOrder = 2;
    scene.add(highlight);

    // Solid blue markers for edge (thin cylinder) + vertex (small sphere) selection,
    // drawn over the model so they read clearly like a CAD selection.
    const markMat = new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true, opacity: 0.95 });
    const edgeHi = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), markMat);
    const vertHi = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), markMat);
    edgeHi.visible = vertHi.visible = false;
    edgeHi.renderOrder = vertHi.renderOrder = 3;
    scene.add(edgeHi, vertHi);

    let raf = 0;
    const animate = () => {
      controls.update();
      // Keep dimension labels at a constant, readable on-screen size (clamped to
      // a 12–40pt band) regardless of zoom, so they never balloon or vanish.
      const s = st.current;
      const vpH = el.clientHeight || 1;
      const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);
      for (const grp of [s?.dims, s?.pins]) {
        if (!grp) continue;
        for (const o of grp.children) {
          if (!(o as THREE.Sprite).isSprite || !o.userData.dimLabel) continue;
          const d = camera.position.distanceTo(o.position);
          const worldPerPx = (2 * d * tan) / vpH;
          const px = Math.min(o.userData.maxPx ?? LABEL_MAX_PX, Math.max(o.userData.minPx ?? LABEL_MIN_PX, o.userData.baseH / worldPerPx));
          const h = px * worldPerPx;
          o.scale.set(h * o.userData.aspect, h, 1);
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // ---- tap-to-pin: raycast picks on click (pin mode) / double-click (always) ----
    const rc = new THREE.Raycaster();
    const handleTap = (e: { clientX: number; clientY: number }, viaDblClick: boolean) => {
      const s2 = st.current;
      if (!s2) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      if (s2.pins) {
        const hp = rc.intersectObjects(s2.pins.children, false)[0];
        if (hp) {
          cb.current.onSelectPin(String(hp.object.userData.pinId));
          return;
        }
      }
      // Select mode: single click locks the face / edge / vertex under the cursor.
      if (cb.current.selectMode && !viaDblClick) {
        if (!s2.mesh || !s2.tri) return;
        const hit = rc.intersectObject(s2.mesh, false)[0];
        if (!hit || hit.faceIndex == null) return;
        s2.lockedHit = { faceIndex: hit.faceIndex, point: hit.point.clone() };
        const info = showFeature(s2, cb.current.selectKind, hit.faceIndex, hit.point);
        if (info) cb.current.onPickFeature(featureToPayload(info));
        return;
      }
      if (viaDblClick ? cb.current.pinMode : !cb.current.pinMode) return; // dblclick covers non-pin-mode
      if (!s2.mesh) return;
      const hit = rc.intersectObject(s2.mesh, false)[0];
      if (!hit || !hit.face) return;
      const r1p = (n: number) => Math.round(n * 10) / 10;
      cb.current.onPickPoint({
        x: r1p(hit.point.x), y: r1p(hit.point.y), z: r1p(hit.point.z),
        nx: hit.face.normal.x, ny: hit.face.normal.y, nz: hit.face.normal.z,
      });
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const d = downAt;
      downAt = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // it was an orbit drag
      handleTap(e, false);
    };
    const onDbl = (e: MouseEvent) => handleTap(e, true);
    // Hover feedback: highlight a pin the cursor is over (and show a pointer cursor).
    const setHover = (id: string | null) => {
      if (hoveredRef.current === id) return;
      hoveredRef.current = id;
      setHovered(id);
      renderer.domElement.style.cursor = id ? "pointer" : "";
    };
    const onMove = (e: PointerEvent) => {
      const s2 = st.current;
      if (!s2 || downAt) return; // don't fight an orbit drag
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      // Pin hover takes priority.
      if (s2.pins && s2.pins.children.length) {
        const hp = rc.intersectObjects(s2.pins.children, false)[0];
        if (hp) { setHover(String(hp.object.userData.pinId)); return; }
      }
      setHover(null);
      // Face / edge / vertex hover-highlight in select mode.
      if (cb.current.selectMode && s2.mesh && s2.tri) {
        const hit = rc.intersectObject(s2.mesh, false)[0];
        if (hit && hit.faceIndex != null) {
          showFeature(s2, cb.current.selectKind, hit.faceIndex, hit.point);
          renderer.domElement.style.cursor = "crosshair";
          return;
        }
        // Off the model — fall back to the locked feature, if any.
        if (s2.lockedHit) showFeature(s2, cb.current.selectKind, s2.lockedHit.faceIndex, s2.lockedHit.point);
        else { s2.highlight.visible = false; s2.edgeHi.visible = false; s2.vertHi.visible = false; }
        renderer.domElement.style.cursor = "";
      }
    };
    const onLeave = () => setHover(null);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("dblclick", onDbl);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    st.current = { renderer, scene, camera, controls, grid, content, mesh: null, dims: null, pins: null, material, highlight, edgeHi, vertHi, markR: 1, tri: null, lockedHit: null, ro };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("dblclick", onDbl);
      controls.dispose();
      disposeDims(st.current);
      highlight.geometry.dispose();
      (highlight.material as THREE.Material).dispose();
      edgeHi.geometry.dispose();
      vertHi.geometry.dispose();
      markMat.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = null;
    };
  }, []);

  useEffect(() => {
    const s = st.current;
    if (!s) return;
    // Dispose the replaced model's GPU buffers (geometry + its edge overlay) —
    // otherwise every regeneration leaks VRAM until the tab slows down.
    if (s.mesh) {
      const prevEdges = s.mesh.children[0] as THREE.LineSegments | undefined;
      (prevEdges?.geometry as THREE.BufferGeometry | undefined)?.dispose();
      const em = prevEdges?.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(em)) em.forEach((m) => m.dispose());
      else em?.dispose();
      s.mesh.geometry.dispose();
    }
    s.content.clear();
    s.mesh = null;
    // Reset the feature selection whenever the model changes.
    s.tri = null;
    s.lockedHit = null;
    s.highlight.visible = false;
    s.edgeHi.visible = false;
    s.vertHi.visible = false;
    if (!geometry) {
      updateDims(s, showDims, units);
      return;
    }

    const mesh = new THREE.Mesh(geometry, s.material);
    s.content.add(mesh);
    s.tri = buildTriData(geometry);
    geometry.computeBoundingBox();
    const gs = geometry.boundingBox!.getSize(new THREE.Vector3());
    s.markR = Math.min(2, Math.max(0.5, Math.max(gs.x, gs.y, gs.z) * 0.008)); // edge/vertex marker size
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 30),
      new THREE.LineBasicMaterial({ color: "#2a2e35" }),
    );
    mesh.add(edges);
    s.mesh = mesh;
    updateDims(s, showDims, units);
    frameToObject(s);
  }, [geometry]);

  useEffect(() => {
    if (st.current) updateDims(st.current, showDims, units);
  }, [showDims, units]);

  useEffect(() => {
    if (st.current) st.current.material.wireframe = wireframe;
  }, [wireframe]);

  // Leaving select mode clears the highlight + locked feature.
  useEffect(() => {
    const s = st.current;
    if (!s || selectMode) return;
    s.lockedHit = null;
    s.highlight.visible = false;
    s.edgeHi.visible = false;
    s.vertHi.visible = false;
    s.renderer.domElement.style.cursor = "";
  }, [selectMode]);

  // Re-highlight the locked feature when the selection kind (face/edge/vertex) changes.
  useEffect(() => {
    const s = st.current;
    if (s?.lockedHit) showFeature(s, selectKind, s.lockedHit.faceIndex, s.lockedHit.point);
  }, [selectKind]);

  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.scene.background = new THREE.Color(THEME_SCENE[theme]);
    s.scene.remove(s.grid);
    s.grid.geometry.dispose();
    (Array.isArray(s.grid.material) ? s.grid.material : [s.grid.material]).forEach((m) => m.dispose());
    s.grid = new THREE.GridHelper(300, 30, ...THEME_GRID[theme]);
    s.grid.rotation.x = Math.PI / 2;
    s.scene.add(s.grid);
  }, [theme]);

  useEffect(() => {
    const s = st.current;
    if (!s) return;
    if (s.pins) {
      disposeGroup(s.pins);
      s.scene.remove(s.pins);
      s.pins = null;
    }
    if (!pins.length) return;
    const g = new THREE.Group();
    g.renderOrder = 1001;
    pins.forEach((pin, i) => {
      const sel = pin.id === selectedPin;
      const hov = pin.id === hovered;
      // Selected = solid blue; hovered = light blue ring; otherwise the teal default.
      const colors = sel
        ? { fg: "#ffffff", bg: "#2563eb", border: "#ffffff" }
        : hov
          ? { fg: "#1d4ed8", bg: "#dbeafe", border: "#2563eb" }
          : { fg: "#2f7a70", bg: "rgba(255,255,255,0.95)", border: "#2f7a70" };
      const spr = makeLabel(String(i + 1), colors);
      spr.userData.dimLabel = true;
      spr.userData.pinId = pin.id;
      spr.userData.baseH = 8;
      // Grow the active/hovered marker so the highlight is unmistakable.
      spr.userData.minPx = sel || hov ? 27 : 22;
      spr.userData.maxPx = sel || hov ? 34 : 28;
      spr.position.set(pin.x, pin.y, pin.z);
      g.add(spr);
    });
    s.pins = g;
    s.scene.add(g);
  }, [pins, selectedPin, hovered]);

  useImperativeHandle(ref, () => ({
    resetView() {
      if (st.current) frameToObject(st.current);
    },
    captureThumbnail() {
      return st.current ? captureThumbnail(st.current) : null;
    },
  }));

  return <div ref={mount} className="viewerCanvas" />;
});

// Render a clean, consistent library thumbnail: the model alone on the scene
// background, framed 3/4, with the grid, dimensions and pins hidden — captured
// off-screen so the on-screen view (zoom, labels, angle) is never disturbed.
function captureThumbnail(s: Internals): string | null {
  if (!s.mesh) return null;
  const W = 384, H = 288;
  // Hide chrome for the shot.
  const gridVis = s.grid.visible;
  const dimsVis = s.dims?.visible;
  const pinsVis = s.pins?.visible;
  s.grid.visible = false;
  if (s.dims) s.dims.visible = false;
  if (s.pins) s.pins.visible = false;

  const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
  cam.up.set(0, 0, 1);
  const box = new THREE.Box3().setFromObject(s.mesh);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 1);
  const dist = r / Math.sin((cam.fov * Math.PI) / 180 / 2);
  const dirv = new THREE.Vector3(1, -1.3, 0.9).normalize();
  cam.position.copy(sphere.center.clone().add(dirv.multiplyScalar(dist * 1.05)));
  cam.near = dist / 100;
  cam.far = dist * 100;
  cam.lookAt(sphere.center);
  cam.updateProjectionMatrix();

  const target = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  const prevTarget = s.renderer.getRenderTarget();
  let url: string | null = null;
  try {
    s.renderer.setRenderTarget(target);
    s.renderer.render(s.scene, cam);
    const buf = new Uint8Array(W * H * 4);
    s.renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    // WebGL reads bottom-to-top; flip rows into the top-down 2D canvas.
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    url = cv.toDataURL("image/webp", 0.72);
    if (!url.startsWith("data:image/webp")) url = cv.toDataURL("image/png"); // Safari fallback
  } catch {
    url = null;
  } finally {
    s.renderer.setRenderTarget(prevTarget);
    target.dispose();
    s.grid.visible = gridVis;
    if (s.dims) s.dims.visible = dimsVis!;
    if (s.pins) s.pins.visible = pinsVis!;
  }
  return url;
}

// ---- feature selection (face / edge / vertex) ------------------------------

type FeatureInfo =
  | { kind: "face"; center: THREE.Vector3; normal: THREE.Vector3; w: number; h: number }
  | { kind: "edge"; a: THREE.Vector3; b: THREE.Vector3; mid: THREE.Vector3; len: number }
  | { kind: "vertex"; pos: THREE.Vector3 };

/** Precompute triangle normals, welded-vertex adjacency, unique vertices, and the
    model's sharp edges — everything hover-selection needs. */
function buildTriData(geo: THREE.BufferGeometry): TriData {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const idx = geo.index;
  const count = idx ? idx.count / 3 : pos.count / 3;
  const corner = (c: number) => (idx ? idx.getX(c) : c);

  // Weld coincident vertices (quantise to 1 µm) → stable ids for adjacency.
  const vidOf = new Map<string, number>();
  const vid = new Uint32Array(count * 3);
  const vpos: number[] = [];
  const vv = new THREE.Vector3();
  for (let c = 0; c < count * 3; c++) {
    vv.fromBufferAttribute(pos, corner(c));
    const key = `${Math.round(vv.x * 1000)}_${Math.round(vv.y * 1000)}_${Math.round(vv.z * 1000)}`;
    let id = vidOf.get(key);
    if (id === undefined) { id = vpos.length / 3; vidOf.set(key, id); vpos.push(vv.x, vv.y, vv.z); }
    vid[c] = id;
  }
  const nUnique = vpos.length / 3;

  // Per-triangle normal + plane offset.
  const normals = new Float32Array(count * 3);
  const d = new Float32Array(count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < count; t++) {
    a.fromBufferAttribute(pos, corner(t * 3));
    b.fromBufferAttribute(pos, corner(t * 3 + 1));
    c3.fromBufferAttribute(pos, corner(t * 3 + 2));
    ab.subVectors(b, a); ac.subVectors(c3, a); n.crossVectors(ab, ac).normalize();
    normals[t * 3] = n.x; normals[t * 3 + 1] = n.y; normals[t * 3 + 2] = n.z;
    d[t] = n.dot(a);
  }

  // Edge → triangle adjacency (welded) + sharp edges (crease > 30° or boundary).
  const adj = new Int32Array(count * 3).fill(-1);
  const edgeMap = new Map<string, { t: number; e: number }>();
  const sharp: number[] = [];
  const seg = (v0: number, v1: number) => sharp.push(vpos[v0 * 3], vpos[v0 * 3 + 1], vpos[v0 * 3 + 2], vpos[v1 * 3], vpos[v1 * 3 + 1], vpos[v1 * 3 + 2]);
  const COS30 = Math.cos((30 * Math.PI) / 180);
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const va = vid[t * 3 + e], vb = vid[t * 3 + ((e + 1) % 3)];
      const key = va < vb ? `${va}_${vb}` : `${vb}_${va}`;
      const prev = edgeMap.get(key);
      if (prev === undefined) {
        edgeMap.set(key, { t, e });
      } else {
        adj[t * 3 + e] = prev.t;
        adj[prev.t * 3 + prev.e] = t;
        const dot = normals[t * 3] * normals[prev.t * 3] + normals[t * 3 + 1] * normals[prev.t * 3 + 1] + normals[t * 3 + 2] * normals[prev.t * 3 + 2];
        if (dot < COS30) seg(va, vb); // crease
        edgeMap.delete(key);
      }
    }
  }
  for (const { t, e } of edgeMap.values()) seg(vid[t * 3 + e], vid[t * 3 + ((e + 1) % 3)]); // boundary edges

  return { normals, d, count, pos, idx, adj, vpos: new Float32Array(vpos), nUnique, edges: new Float32Array(sharp), edgeCount: sharp.length / 6 };
}

/** Flood-fill the connected smooth region (flat OR curved) around a triangle,
    crossing shared edges only where the crease stays gentle — stops at sharp edges. */
function smoothRegion(tri: TriData, start: number): number[] {
  const COS = Math.cos((33 * Math.PI) / 180);
  const seen = new Uint8Array(tri.count);
  const out: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const t = stack.pop()!;
    out.push(t);
    const tx = tri.normals[t * 3], ty = tri.normals[t * 3 + 1], tz = tri.normals[t * 3 + 2];
    for (let e = 0; e < 3; e++) {
      const nb = tri.adj[t * 3 + e];
      if (nb < 0 || seen[nb]) continue;
      const dot = tx * tri.normals[nb * 3] + ty * tri.normals[nb * 3 + 1] + tz * tri.normals[nb * 3 + 2];
      if (dot > COS) { seen[nb] = 1; stack.push(nb); }
    }
  }
  return out;
}

function nearestVertex(tri: TriData, p: THREE.Vector3): THREE.Vector3 {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < tri.nUnique; i++) {
    const dx = tri.vpos[i * 3] - p.x, dy = tri.vpos[i * 3 + 1] - p.y, dz = tri.vpos[i * 3 + 2] - p.z;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return new THREE.Vector3(tri.vpos[best * 3], tri.vpos[best * 3 + 1], tri.vpos[best * 3 + 2]);
}

function nearestEdge(tri: TriData, p: THREE.Vector3): { a: THREE.Vector3; b: THREE.Vector3 } | null {
  if (!tri.edgeCount) return null;
  let best = -1, bestD = Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3(), proj = new THREE.Vector3();
  for (let i = 0; i < tri.edgeCount; i++) {
    a.set(tri.edges[i * 6], tri.edges[i * 6 + 1], tri.edges[i * 6 + 2]);
    b.set(tri.edges[i * 6 + 3], tri.edges[i * 6 + 4], tri.edges[i * 6 + 5]);
    ab.subVectors(b, a); ap.subVectors(p, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    proj.copy(a).addScaledVector(ab, t);
    const dd = proj.distanceToSquared(p);
    if (dd < bestD) { bestD = dd; best = i; }
  }
  if (best < 0) return null;
  return {
    a: new THREE.Vector3(tri.edges[best * 6], tri.edges[best * 6 + 1], tri.edges[best * 6 + 2]),
    b: new THREE.Vector3(tri.edges[best * 6 + 3], tri.edges[best * 6 + 4], tri.edges[best * 6 + 5]),
  };
}

/** Highlight the face/edge/vertex under the cursor and return its metrics. */
function showFeature(s: Internals, kind: "face" | "edge" | "vertex", faceIndex: number, hit: THREE.Vector3): FeatureInfo | null {
  if (!s.tri) return null;
  s.highlight.visible = false; s.edgeHi.visible = false; s.vertHi.visible = false;

  if (kind === "face") {
    const tris = smoothRegion(s.tri, faceIndex);
    if (!tris.length) return null;
    const { pos, idx } = s.tri;
    const positions = new Float32Array(tris.length * 9);
    const v = new THREE.Vector3();
    const bbox = new THREE.Box3();
    let p = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(pos, vi);
        positions[p++] = v.x; positions[p++] = v.y; positions[p++] = v.z;
        bbox.expandByPoint(v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    s.highlight.geometry.dispose();
    s.highlight.geometry = geo;
    s.highlight.visible = true;
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const normal = new THREE.Vector3(s.tri.normals[faceIndex * 3], s.tri.normals[faceIndex * 3 + 1], s.tri.normals[faceIndex * 3 + 2]);
    const dims = [size.x, size.y, size.z];
    const axis = Math.abs(normal.x) > 0.9 ? 0 : Math.abs(normal.y) > 0.9 ? 1 : Math.abs(normal.z) > 0.9 ? 2 : -1;
    let w: number, h: number;
    if (axis >= 0) { const rest = dims.filter((_, i) => i !== axis); w = rest[0]; h = rest[1]; }
    else { const sorted = [...dims].sort((x, y) => y - x); w = sorted[0]; h = sorted[1]; }
    return { kind: "face", center, normal, w, h };
  }

  if (kind === "edge") {
    const e = nearestEdge(s.tri, hit);
    if (!e) return null;
    const dir = new THREE.Vector3().subVectors(e.b, e.a);
    const len = dir.length();
    if (len < 1e-6) return null;
    dir.divideScalar(len);
    const mid = new THREE.Vector3().addVectors(e.a, e.b).multiplyScalar(0.5);
    s.edgeHi.position.copy(mid);
    s.edgeHi.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    s.edgeHi.scale.set(s.markR, len, s.markR);
    s.edgeHi.visible = true;
    return { kind: "edge", a: e.a, b: e.b, mid, len };
  }

  const nv = nearestVertex(s.tri, hit);
  s.vertHi.position.copy(nv);
  s.vertHi.scale.setScalar(s.markR * 1.8);
  s.vertHi.visible = true;
  return { kind: "vertex", pos: nv };
}

/** Map an internal FeatureInfo to the rounded, serialisable payload the app edits with. */
function featureToPayload(info: FeatureInfo): PickedFeature {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (info.kind === "face") {
    return {
      kind: "face", label: `${faceLabel(info.normal)} face`,
      cx: r(info.center.x), cy: r(info.center.y), cz: r(info.center.z),
      nx: r(info.normal.x), ny: r(info.normal.y), nz: r(info.normal.z),
      w: r(info.w), h: r(info.h),
    };
  }
  if (info.kind === "edge") {
    return {
      kind: "edge", label: "edge",
      cx: r(info.mid.x), cy: r(info.mid.y), cz: r(info.mid.z),
      ax: r(info.a.x), ay: r(info.a.y), az: r(info.a.z),
      bx: r(info.b.x), by: r(info.b.y), bz: r(info.b.z),
      len: r(info.len),
    };
  }
  return { kind: "vertex", label: "corner", cx: r(info.pos.x), cy: r(info.pos.y), cz: r(info.pos.z) };
}

/** Human name for a face from its outward normal (Z-up). */
function faceLabel(n: THREE.Vector3): string {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (az >= ax && az >= ay) return n.z > 0 ? "top" : "bottom";
  if (ay >= ax) return n.y > 0 ? "back" : "front";
  return n.x > 0 ? "right" : "left";
}

function frameToObject(s: Internals) {
  if (!s.mesh) return;
  const box = new THREE.Box3().setFromObject(s.mesh);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const r = Math.max(sphere.radius, 1);
  const dist = r / Math.sin((s.camera.fov * Math.PI) / 180 / 2);
  const dirv = new THREE.Vector3(1, -1.3, 0.9).normalize();
  s.camera.position.copy(center.clone().add(dirv.multiplyScalar(dist * 1.15)));
  s.camera.near = dist / 100;
  s.camera.far = dist * 100;
  s.camera.updateProjectionMatrix();
  s.controls.target.copy(center);
  s.controls.update();
}

// ---- dimension annotations (W × D × H) -------------------------------------

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const any = o as THREE.Mesh & THREE.Sprite;
    (any.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
    const mat = any.material as THREE.Material | THREE.Material[] | undefined;
    const kill = (m: THREE.Material) => {
      (m as THREE.SpriteMaterial).map?.dispose?.();
      m.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(kill);
    else if (mat) kill(mat);
  });
}

function disposeDims(s: Internals | null) {
  if (!s?.dims) return;
  disposeGroup(s.dims);
  s.scene.remove(s.dims);
  s.dims = null;
}

function updateDims(s: Internals, show: boolean, units: "mm" | "in") {
  disposeDims(s);
  if (!show || !s.mesh) return;
  s.dims = buildDimensions(s.mesh.geometry, units);
  s.scene.add(s.dims);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Format a millimetre length in the chosen unit for a label. */
function fmtLen(mm: number, units: "mm" | "in"): string {
  return units === "in" ? `${(mm / 25.4).toFixed(2)}″` : `${r1(mm)} mm`;
}

function buildDimensions(geometry: THREE.BufferGeometry, units: "mm" | "in"): THREE.Group {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  const size = new THREE.Vector3();
  b.getSize(size);
  const g = new THREE.Group();
  g.renderOrder = 999;
  const maxD = Math.max(size.x, size.y, size.z, 1);
  const off = Math.max(maxD * 0.09, 4); // how far annotations sit outside the model
  const tick = off * 0.45;
  const line = 0x33566b; // slate-teal, reads on light bg and through the model
  const label = 0x14181c;

  // faint bounding box so the extents are legible even head-on
  const boxEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({ color: 0x9aa2ac, transparent: true, opacity: 0.45, depthTest: false }),
  );
  const center = new THREE.Vector3();
  b.getCenter(center);
  boxEdges.position.copy(center);
  boxEdges.renderOrder = 998;
  g.add(boxEdges);

  // Width — along X, drawn in front of the model (y = min − off), on the floor
  addDim(
    g,
    new THREE.Vector3(b.min.x, b.min.y - off, b.min.z),
    new THREE.Vector3(b.max.x, b.min.y - off, b.min.z),
    new THREE.Vector3(0, -1, 0),
    tick,
    line,
    label,
    fmtLen(size.x, units),
    maxD,
  );
  // Depth — along Y, drawn to the right (x = max + off), on the floor
  addDim(
    g,
    new THREE.Vector3(b.max.x + off, b.min.y, b.min.z),
    new THREE.Vector3(b.max.x + off, b.max.y, b.min.z),
    new THREE.Vector3(1, 0, 0),
    tick,
    line,
    label,
    fmtLen(size.y, units),
    maxD,
  );
  // Height — along Z, drawn at the front-left vertical corner
  addDim(
    g,
    new THREE.Vector3(b.min.x - off, b.min.y - off, b.min.z),
    new THREE.Vector3(b.min.x - off, b.min.y - off, b.max.z),
    new THREE.Vector3(-1, -1, 0).normalize(),
    tick,
    line,
    label,
    fmtLen(size.z, units),
    maxD,
  );
  return g;
}

/** One dimension: a main line p1→p2, perpendicular end ticks, and a label. */
function addDim(
  g: THREE.Group,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  out: THREE.Vector3,
  tick: number,
  lineColor: number,
  labelColor: number,
  text: string,
  modelSize: number,
) {
  const mat = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.95, depthTest: false });
  const seg = (pts: THREE.Vector3[]) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    l.renderOrder = 999;
    g.add(l);
  };
  seg([p1, p2]);
  const t = out.clone().multiplyScalar(tick / 2);
  seg([p1.clone().sub(t), p1.clone().add(t)]);
  seg([p2.clone().sub(t), p2.clone().add(t)]);

  const mid = p1.clone().add(p2).multiplyScalar(0.5).add(out.clone().multiplyScalar(tick * 1.1));
  const hex = `#${labelColor.toString(16).padStart(6, "0")}`;
  const sprite = makeLabel(text, { fg: hex, bg: "rgba(255,255,255,0.94)", border: hex });
  // baseH is the "natural" world height; the render loop rescales it each frame
  // to hold a constant on-screen pixel size (clamped), so labels stay small.
  sprite.userData.dimLabel = true;
  sprite.userData.baseH = modelSize * 0.05;
  const h = modelSize * 0.05;
  sprite.scale.set(h * sprite.userData.aspect, h, 1);
  sprite.position.copy(mid);
  g.add(sprite);
}

function makeLabel(text: string, colors: { fg: string; bg: string; border: string }): THREE.Sprite {
  const fontSize = 52;
  const padX = 20;
  const padY = 12;
  const canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const w = Math.max(Math.ceil(ctx.measureText(text).width), fontSize * 0.7);
  canvas.width = w + padX * 2;
  canvas.height = fontSize + padY * 2;
  ctx = canvas.getContext("2d")!; // resizing resets the context
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;

  // rounded pill background
  const rad = canvas.height / 2;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, canvas.width - 3, canvas.height - 3, rad);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 1000;
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
