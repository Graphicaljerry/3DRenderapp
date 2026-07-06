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
  onPickPoint: (p: PickedPoint) => void;
  onSelectPin: (id: string) => void;
}

const THEME_SCENE = { light: "#f6f7f9", dark: "#101418" } as const;
const THEME_GRID: Record<string, [number, number]> = { light: [0xced2d8, 0xe3e6ea], dark: [0x39414b, 0x232a31] };

// Dimension-label size band, in screen pixels (≈ 12–40 pt).
const LABEL_MIN_PX = 16;
const LABEL_MAX_PX = 53;

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
  ro: ResizeObserver;
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({ geometry, wireframe, showDims, units, theme, pins, selectedPin, pinMode, onPickPoint, onSelectPin }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const st = useRef<Internals | null>(null);
  const cb = useRef({ pinMode, onPickPoint, onSelectPin });
  cb.current = { pinMode, onPickPoint, onSelectPin };
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
      if (!s2.pins || !s2.pins.children.length) { setHover(null); return; }
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      const hp = rc.intersectObjects(s2.pins.children, false)[0];
      setHover(hp ? String(hp.object.userData.pinId) : null);
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

    st.current = { renderer, scene, camera, controls, grid, content, mesh: null, dims: null, pins: null, material, ro };

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
    if (!geometry) {
      updateDims(s, showDims, units);
      return;
    }

    const mesh = new THREE.Mesh(geometry, s.material);
    s.content.add(mesh);
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
