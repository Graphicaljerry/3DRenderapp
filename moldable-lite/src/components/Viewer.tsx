import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** A point-to-point measurement on the model (display coords). */
export type Measurement = { id: string; a: [number, number, number]; b: [number, number, number] };

/** Whole-body transform gizmo modes. "off" hides the gizmo (Select tool is in charge). */
export type TransformMode = "off" | "move" | "rotate" | "scale";
/** Payload emitted on gizmo release — App maps `center` to engine coords (+recenter). */
export type TransformCommit =
  | { kind: "translate"; delta: [number, number, number] }
  | { kind: "rotate"; axis: [number, number, number]; angleDeg: number; center: [number, number, number] }
  | { kind: "scale"; factor: number; center: [number, number, number] };

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
  curved?: boolean; // face: a curved surface (not a flat plane)
  closed?: boolean; // edge: a closed loop (e.g. a rim), no distinct ends
  at?: [number, number, number]; // full-precision on-edge / vertex point for direct fillet/chamfer targeting
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
  selectMode: boolean;
  selectKind: SelectKind;
  boxSelectionActive: boolean; // App still holds a box-selected face set → keep the overlay
  transformMode: TransformMode; // whole-body gizmo: off / rotate / scale
  measureMode: boolean; // click two points to measure the distance between them
  measurePending: [number, number, number] | null; // the first clicked point, awaiting the second
  measurements: Measurement[]; // committed point-to-point measurements to render
  pushArrow: { center: [number, number, number]; normal: [number, number, number]; kind: "extrude" | "fillet" } | null; // selected face → drag-to-extrude, edge/corner → drag-to-round
  onPickPoint: (p: PickedPoint) => void;
  onPickFeature: (f: PickedFeature) => void;
  onPickFaces: (faces: PickedFeature[]) => void;
  onSelectPin: (id: string) => void;
  onTransformCommit: (c: TransformCommit) => void;
  onMeasurePoint: (p: [number, number, number]) => void;
  onPushPull: (distance: number) => void;
  // Fires as the drag moves (snapped). `solid` is the closed prism (display coords) for the
  // Manifold boolean live preview — present only for extrude drags with a captured cap.
  onPushPullLive: (distance: number, solid?: Float32Array | null) => void;
}

// The Select tool's modes. "point" drops a surface marker (the old Pin); the rest
// pick a face / edge / corner. One tool, one segmented control.
export type SelectKind = "face" | "edge" | "vertex" | "point";

const THEME_SCENE = { light: "#f6f7f9", dark: "#101418" } as const;
const THEME_GRID: Record<string, [number, number]> = { light: [0xced2d8, 0xe3e6ea], dark: [0x39414b, 0x232a31] };

// Dimension-label size band, in screen pixels (≈ 12–40 pt).
const LABEL_MIN_PX = 16;
const LABEL_MAX_PX = 53;

interface EdgeChain {
  segs: number[]; // sharp-segment indices making up this physical edge
  ax: number; ay: number; az: number; // one end (or centroid if closed)
  bx: number; by: number; bz: number; // other end
  cx: number; cy: number; cz: number; // representative point
  len: number; // total length along the edge
  closed: boolean; // a loop (e.g. a cylinder rim) has no distinct ends
}

interface TriData {
  normals: Float32Array; // per-triangle unit normal
  d: Float32Array; // per-triangle plane offset (normal · vertex)
  degen: Uint8Array; // 1 = zero-area triangle (normal unreliable)
  count: number;
  pos: THREE.BufferAttribute;
  idx: THREE.BufferAttribute | null;
  adj: Int32Array; // count*3 — neighbouring triangle across each edge (-1 = none)
  vpos: Float32Array; // unique welded vertex positions
  nUnique: number;
  edges: Float32Array; // sharp-edge segments: [ax,ay,az, bx,by,bz] per segment
  edgeCount: number;
  edgeChainId: Int32Array; // per sharp segment → physical-edge (chain) index
  chains: EdgeChain[]; // physical edges (subdivided/curved segments chained)
  faceId: Int32Array | null; // per-triangle replicad B-rep face id (null for plain meshes)
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
  multiHi: THREE.Mesh; // overlay for a box-selected SET of faces
  edgeHi: THREE.Mesh; // solid marker for a hovered/selected edge (a thin cylinder)
  vertHi: THREE.Mesh; // solid marker for a hovered/selected vertex (a small sphere)
  markR: number; // marker radius, scaled to the model
  tri: TriData | null;
  lockedHit: { faceIndex: number; point: THREE.Vector3 } | null; // click-locked feature
  selCache: { key: string; info: FeatureInfo; region: Uint8Array | null } | null; // hover perf guard
  box: { sx: number; sy: number; div: HTMLDivElement; pointerId: number } | null; // in-progress marquee (scoped to its pointer)
  ro: ResizeObserver;
  tc: TransformControls; // whole-body move/rotate/scale gizmo
  pivot: THREE.Group | null; // when transforming: a group at the model centre the gizmo drives
  transforming: boolean; // a gizmo drag is in progress (freezes orbit + select picking)
  measures: THREE.Group; // point-to-point measurement lines + labels
  pushArrow: THREE.Group; // drag-to-extrude handle on a selected flat face (shaft + cone + grab)
  pushGrab: THREE.Mesh; // invisible fat cylinder used to raycast/grab the arrow
  ghost: THREE.Mesh; // translucent live preview of the extruded volume during a push-pull drag
  pushDrag: { start: THREE.Vector3; n: THREE.Vector3; plane: THREE.Plane; base: number; cap: Float32Array; bnd: Float32Array; size: number; pointerId: number } | null; // active push-pull drag (scoped to its pointer)
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({ geometry, wireframe, showDims, units, theme, pins, selectedPin, selectMode, selectKind, boxSelectionActive, transformMode, measureMode, measurePending, measurements, pushArrow, onPickPoint, onPickFeature, onPickFaces, onSelectPin, onTransformCommit, onMeasurePoint, onPushPull, onPushPullLive }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const st = useRef<Internals | null>(null);
  const cb = useRef({ selectMode, selectKind, transformMode, measureMode, units, onPickPoint, onPickFeature, onPickFaces, onSelectPin, onTransformCommit, onMeasurePoint, onPushPull, onPushPullLive });
  cb.current = { selectMode, selectKind, transformMode, measureMode, units, onPickPoint, onPickFeature, onPickFaces, onSelectPin, onTransformCommit, onMeasurePoint, onPushPull, onPushPullLive };
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

    const measures = new THREE.Group(); // point-to-point measurement annotations
    scene.add(measures);

    // Push-pull handle: an arrow (shaft + cone) drawn along a selected flat face's normal;
    // drag it to extrude the face. Local +Y is the normal; oriented/positioned per prop.
    const pushArrow = new THREE.Group();
    const pushMat = new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true, opacity: 0.95 });
    const pushShaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), pushMat);
    const pushCone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), pushMat);
    const pushGrab = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshBasicMaterial({ visible: false }));
    pushArrow.add(pushShaft, pushCone, pushGrab);
    pushArrow.visible = false;
    pushArrow.renderOrder = 6;
    pushShaft.renderOrder = pushCone.renderOrder = 6;
    scene.add(pushArrow);

    // Translucent live preview of the volume being added/removed while dragging the push-pull arrow.
    const ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    ghost.visible = false;
    ghost.renderOrder = 3;
    scene.add(ghost);

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

    // Teal overlay for a box-selected SET of faces (distinct from the blue single-hover).
    const multiHi = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x0d9488, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    multiHi.visible = false;
    multiHi.renderOrder = 2;
    scene.add(multiHi);

    // Whole-body transform gizmo (rotate/scale). Attached to a pivot at the model centre
    // (see enterTransform) so rotation spins in place rather than swinging about the bed origin.
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSpace("world");
    tc.setSize(0.9);
    tc.setRotationSnap(THREE.MathUtils.degToRad(15));
    tc.setScaleSnap(0.05);
    scene.add(tc.getHelper());
    tc.addEventListener("dragging-changed", (e: any) => {
      const s = st.current;
      if (!s) return;
      controls.enabled = !e.value;
      s.transforming = e.value;
      if (!e.value) commitTransform(s, cb.current.onTransformCommit); // released → emit one op
    });
    // Keep the scale PREVIEW uniform (replicad scale is uniform only) so what you drag is what
    // you get — collapse any per-axis handle drag to a single factor live.
    tc.addEventListener("objectChange", () => {
      const s = st.current;
      if (!s || !s.pivot || tc.getMode() !== "scale") return;
      const c = [s.pivot.scale.x, s.pivot.scale.y, s.pivot.scale.z];
      let f = 1, md = 0;
      for (const v of c) { const d = Math.abs(Math.log(Math.max(1e-3, Math.abs(v)))); if (d > md) { md = d; f = Math.abs(v); } }
      f = Math.max(0.05, f);
      s.pivot.scale.set(f, f, f);
    });

    let raf = 0;
    const animate = () => {
      controls.update();
      // Keep dimension labels at a constant, readable on-screen size (clamped to
      // a 12–40pt band) regardless of zoom, so they never balloon or vanish.
      const s = st.current;
      const vpH = el.clientHeight || 1;
      const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);
      for (const grp of [s?.dims, s?.pins, s?.measures, s?.pushArrow]) {
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

    // ---- tap picks: a pin marker, a face/edge/vertex (select mode), or a new pin
    // (pin mode). A plain click with neither mode on does nothing — pins only ever
    // drop while Pin mode is active, so they can't scatter across the model. ----
    const rc = new THREE.Raycaster();
    const handleTap = (e: { clientX: number; clientY: number }) => {
      const s2 = st.current;
      if (!s2) return;
      if (cb.current.transformMode !== "off" || s2.transforming) return; // gizmo owns the pointer
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rc.setFromCamera(ndc, camera);
      if (s2.pins && !cb.current.measureMode) {
        const hp = rc.intersectObjects(s2.pins.children, false)[0];
        if (hp) {
          cb.current.onSelectPin(String(hp.object.userData.pinId));
          return;
        }
      }
      // Measure tool: click a surface point; App pairs two clicks into a measurement.
      if (cb.current.measureMode) {
        if (!s2.mesh) return;
        const hit = rc.intersectObject(s2.mesh, false)[0];
        if (!hit) return;
        cb.current.onMeasurePoint([hit.point.x, hit.point.y, hit.point.z]);
        return;
      }
      if (!cb.current.selectMode || !s2.mesh) return; // nothing picks unless the Select tool is on
      // Point mode drops a surface marker (the old Pin); the others lock a feature.
      if (cb.current.selectKind === "point") {
        const hit = rc.intersectObject(s2.mesh, false)[0];
        if (!hit || !hit.face) return;
        const r1p = (n: number) => Math.round(n * 10) / 10;
        cb.current.onPickPoint({
          x: r1p(hit.point.x), y: r1p(hit.point.y), z: r1p(hit.point.z),
          nx: hit.face.normal.x, ny: hit.face.normal.y, nz: hit.face.normal.z,
        });
        return;
      }
      if (!ensureTri(s2)) return; // builds the pick map on first click after an edit
      const hit = rc.intersectObject(s2.mesh, false)[0];
      if (!hit || hit.faceIndex == null) return;
      s2.lockedHit = { faceIndex: hit.faceIndex, point: hit.point.clone() };
      const info = showFeature(s2, cb.current.selectKind, hit.faceIndex, hit.point);
      if (info) cb.current.onPickFeature(featureToPayload(info));
    };
    // Shift while the Select tool is on (and not Point mode) arms a marquee: orbit is
    // paused so a left-drag draws a selection box instead of rotating the view.
    const boxArmable = () => cb.current.selectMode && cb.current.selectKind !== "point";
    const onShiftKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      // A custom drag owns OrbitControls (it's disabled for the drag's duration). Never let a
      // stray Shift press/release re-enable orbit mid-drag — that let a gizmo/push-pull drag
      // resume orbiting on release. The drag itself restores controls when it ends.
      const s2 = st.current;
      if (s2 && (s2.pushDrag || s2.transforming)) return;
      const armed = e.type === "keydown" && boxArmable();
      controls.enabled = !armed;
      renderer.domElement.style.cursor = armed ? "crosshair" : "";
      if (!armed && st.current?.box) cancelBox(); // released mid-drag → drop the marquee
    };
    const cancelBox = () => {
      const s2 = st.current;
      if (!s2?.box) return;
      try { renderer.domElement.releasePointerCapture?.(s2.box.pointerId); } catch { /* capture already lost */ }
      s2.box.div.remove();
      s2.box = null;
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const s2 = st.current;
      // A drag already owns the pointer (push-pull, marquee, or the gizmo) — ignore any second
      // pointer's down so an iPad palm can't start or hijack a competing drag mid-gesture.
      if (s2 && (s2.pushDrag || s2.box || s2.transforming)) return;
      downAt = { x: e.clientX, y: e.clientY };
      // Push-pull: grabbing the face arrow starts a normal-constrained drag (extrude).
      if (s2 && s2.pushArrow.visible && cb.current.selectMode && cb.current.selectKind !== "point" && s2.mesh) {
        const rect = renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        rc.setFromCamera(ndc, camera);
        s2.pushArrow.updateMatrixWorld(true);
        if (rc.intersectObject(s2.pushGrab, false)[0]) {
          const ud = s2.pushArrow.userData as { center: [number, number, number]; normal: [number, number, number]; dist: number };
          const center = new THREE.Vector3(...ud.center);
          const n = new THREE.Vector3(...ud.normal).normalize();
          const camDir = camera.getWorldDirection(new THREE.Vector3());
          const planeN = camDir.clone().projectOnPlane(n).negate();
          // Reject a drag whose axis points nearly at the camera: the projected plane is so
          // glancing that a few pixels of pointer motion become tens of millimetres (the
          // "Fillet of 150 mm" mystery on iPad). ~10° of separation is the working minimum.
          if (planeN.lengthSq() < 0.03) { downAt = null; return; }
          planeN.normalize();
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeN, center);
          const hit0 = new THREE.Vector3();
          const base = rc.ray.intersectPlane(plane, hit0) ? hit0.sub(center).dot(n) : 0; // so the drag starts at 0
          // Capture the selected face's triangles + boundary once, for the live ghost prism.
          // Only extrude gets a ghost — a fillet's rounded volume can't be cheaply previewed.
          const isExtrude = s2.pushArrow.userData.kind !== "fillet";
          const capAttr = isExtrude ? (s2.highlight.geometry.getAttribute("position") as THREE.BufferAttribute | undefined) : undefined;
          const cap = capAttr ? (capAttr.array as Float32Array).slice() : new Float32Array();
          const bnd = cap.length ? faceBoundary(cap) : new Float32Array();
          s2.pushDrag = { start: center, n, plane, base, cap, bnd, size: modelSizeOf(s2), pointerId: e.pointerId };
          controls.enabled = false;
          // Pen/touch: without preventDefault Safari treats the drag as a scroll gesture and
          // starves us of pointermove events — the classic "Apple Pencil barely drags" failure.
          e.preventDefault();
          try { renderer.domElement.setPointerCapture?.(e.pointerId); } catch { /* capture unsupported */ }
          downAt = null;
          return;
        }
      }
      if (s2 && s2.mesh && e.shiftKey && boxArmable()) {
        const rect = renderer.domElement.getBoundingClientRect();
        const div = document.createElement("div");
        div.className = "marquee";
        div.style.left = `${e.clientX - rect.left}px`;
        div.style.top = `${e.clientY - rect.top}px`;
        el.appendChild(div);
        s2.box = { sx: e.clientX, sy: e.clientY, div, pointerId: e.pointerId };
        // Capture the pointer so a marquee released outside the canvas still lands its pointerup
        // here (and no second touch can grow/commit this box).
        try { renderer.domElement.setPointerCapture?.(e.pointerId); } catch { /* capture unsupported */ }
      }
    };
    const onUp = (e: PointerEvent) => {
      const s2 = st.current;
      // Only the pointer that OWNS an active drag may end it — ignore a second touch's up
      // (an iPad palm resting while the Pencil drags) so it can't commit a stray value.
      if (s2?.pushDrag && e.pointerId !== s2.pushDrag.pointerId) return;
      if (s2?.box && e.pointerId !== s2.box.pointerId) return;
      const d = downAt;
      downAt = null;
      // End a push-pull drag → commit the extrude distance as one op.
      if (s2?.pushDrag) {
        try { renderer.domElement.releasePointerCapture?.(e.pointerId); } catch { /* capture already lost */ }
        controls.enabled = true;
        const ud = s2.pushArrow.userData as { center: [number, number, number]; normal: [number, number, number]; dist: number; kind: "extrude" | "fillet" };
        const dist = ud.dist ?? 0;
        s2.pushDrag = null;
        ud.dist = 0;
        s2.ghost.visible = false; // the real solid replaces the preview on commit
        s2.ghost.geometry.dispose();
        s2.ghost.geometry = new THREE.BufferGeometry();
        layoutPushArrow(s2, ud.center, ud.normal, 0, cb.current.units, ud.kind); // rest the arrow (commit may fail)
        cb.current.onPushPull(dist); // ≈0 means "drag ended, nothing to commit" — App restores any live preview
        return;
      }
      if (s2?.box) {
        const { sx, sy } = s2.box;
        cancelBox();
        // A real drag (not a stray shift-click) → select the faces inside the box.
        if (Math.hypot(e.clientX - sx, e.clientY - sy) > 4) {
          const faces = selectFacesInBox(s2, camera, renderer, sx, sy, e.clientX, e.clientY);
          cb.current.onPickFaces(faces);
        }
        return;
      }
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // it was an orbit drag
      handleTap(e);
    };
    // Hover feedback: highlight a pin the cursor is over (and show a pointer cursor).
    const setHover = (id: string | null) => {
      if (hoveredRef.current === id) return;
      hoveredRef.current = id;
      setHovered(id);
      renderer.domElement.style.cursor = id ? "pointer" : "";
    };
    const onMove = (e: PointerEvent) => {
      const s2 = st.current;
      // Push-pull drag: project the pointer onto the drag plane and read the along-normal distance.
      if (s2?.pushDrag) {
        if (e.pointerId !== s2.pushDrag.pointerId) return; // only the grabbing pointer drives the drag
        e.preventDefault(); // keep Safari from reinterpreting a pen/touch drag mid-gesture
        const rect = renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        rc.setFromCamera(ndc, camera);
        const hit = new THREE.Vector3();
        if (rc.ray.intersectPlane(s2.pushDrag.plane, hit)) {
          const ud = s2.pushArrow.userData as { center: [number, number, number]; normal: [number, number, number]; dist: number; kind: "extrude" | "fillet" };
          let dist = hit.sub(s2.pushDrag.start).dot(s2.pushDrag.n) - s2.pushDrag.base;
          dist = Math.round(dist * 2) / 2; // snap to 0.5 mm
          // Clamp to sane bounds for the part so a glancing projection can never run away.
          if (ud.kind === "fillet") dist = Math.min(Math.max(0, dist), s2.pushDrag.size * 0.5);
          else dist = Math.max(-s2.pushDrag.size * 2, Math.min(s2.pushDrag.size * 2, dist));
          if (dist === ud.dist) return; // snapped value unchanged → skip the label/ghost rebuild (pen fires fast)
          ud.dist = dist;
          layoutPushArrow(s2, ud.center, ud.normal, dist, cb.current.units, ud.kind);
          const pdd = s2.pushDrag;
          const solid = ud.kind !== "fillet" && pdd.cap.length && Math.abs(dist) > 1e-3
            ? buildSolidPrism(pdd.cap, pdd.bnd, [pdd.n.x, pdd.n.y, pdd.n.z], dist)
            : null;
          cb.current.onPushPullLive(dist, solid); // mm box sync + boolean live preview
          // Live prism preview grows/shrinks with the drag — the face appears to extrude in real time.
          const pd = s2.pushDrag;
          if (pd.cap.length && Math.abs(dist) > 1e-3) {
            const pos = buildGhost(pd.cap, pd.bnd, [pd.n.x, pd.n.y, pd.n.z], dist);
            s2.ghost.geometry.dispose();
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            s2.ghost.geometry = g;
            (s2.ghost.material as THREE.MeshBasicMaterial).color.set(dist >= 0 ? 0x2563eb : 0xdc2626); // add=blue, cut=red
            s2.ghost.visible = true;
          } else {
            s2.ghost.visible = false;
          }
        }
        return;
      }
      // Growing a marquee: resize the box div and skip hover work.
      if (s2?.box) {
        if (e.pointerId !== s2.box.pointerId) return; // only the pointer that opened the box grows it
        const rect = renderer.domElement.getBoundingClientRect();
        const x0 = Math.min(s2.box.sx, e.clientX) - rect.left, y0 = Math.min(s2.box.sy, e.clientY) - rect.top;
        s2.box.div.style.left = `${x0}px`;
        s2.box.div.style.top = `${y0}px`;
        s2.box.div.style.width = `${Math.abs(e.clientX - s2.box.sx)}px`;
        s2.box.div.style.height = `${Math.abs(e.clientY - s2.box.sy)}px`;
        return;
      }
      if (!s2 || downAt) return; // don't fight an orbit drag
      if (cb.current.transformMode !== "off" || s2.transforming) return; // gizmo mode: no hover-pick
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
      if (!cb.current.selectMode || !s2.mesh) return;
      // Point mode: just a crosshair over the model (click to drop a marker).
      if (cb.current.selectKind === "point") {
        const hit = rc.intersectObject(s2.mesh, false)[0];
        renderer.domElement.style.cursor = hit ? "crosshair" : "";
        return;
      }
      // Face / edge / vertex hover-highlight. ensureTri builds the pick map on first hover
      // after an edit (kept off the per-edit critical path so model swaps feel instant).
      if (ensureTri(s2)) {
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
    // Safari fires pointercancel for system gestures (palm rejection, Scribble); without this
    // a pen drag can die mid-way and leave the drag armed with orbit frozen.
    const onCancelPtr = (e: PointerEvent) => {
      const s2 = st.current;
      // A cancel from a pointer that doesn't own the active drag (a palm's palm-rejection while
      // the Pencil drags) must leave the owning drag untouched.
      if (s2?.pushDrag && e.pointerId !== s2.pushDrag.pointerId) return;
      if (s2?.box && e.pointerId !== s2.box.pointerId) return;
      downAt = null;
      if (s2?.pushDrag) {
        try { renderer.domElement.releasePointerCapture?.(e.pointerId); } catch { /* already lost */ }
        controls.enabled = true;
        const ud = s2.pushArrow.userData as { center: [number, number, number]; normal: [number, number, number]; dist: number; kind: "extrude" | "fillet" };
        s2.pushDrag = null;
        ud.dist = 0;
        s2.ghost.visible = false;
        s2.ghost.geometry.dispose();
        s2.ghost.geometry = new THREE.BufferGeometry();
        layoutPushArrow(s2, ud.center, ud.normal, 0, cb.current.units, ud.kind);
        cb.current.onPushPull(0); // cancelled — App restores any live preview, commits nothing
        return;
      }
      cancelBox();
    };
    // Belt-and-braces: OrbitControls sets this too, but our custom drags depend on it —
    // without it iPadOS steals pen/touch drags for scrolling.
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointercancel", onCancelPtr);
    window.addEventListener("keydown", onShiftKey);
    window.addEventListener("keyup", onShiftKey);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    st.current = { renderer, scene, camera, controls, grid, content, mesh: null, dims: null, pins: null, material, highlight, multiHi, edgeHi, vertHi, markR: 1, tri: null, lockedHit: null, selCache: null, box: null, ro, tc, pivot: null, transforming: false, measures, pushArrow, pushGrab, ghost, pushDrag: null };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointercancel", onCancelPtr);
      window.removeEventListener("keydown", onShiftKey);
      window.removeEventListener("keyup", onShiftKey);
      controls.dispose();
      tc.detach();
      // three r169's TransformControls.dispose() calls this.traverse(), which the class no
      // longer has (it stopped extending Object3D; fixed upstream in later releases). Calling
      // it throws and takes the whole app down on unmount — which StrictMode's dev
      // mount→cleanup→mount cycle hits on EVERY load. Do the same work by hand instead:
      // drop the pointer listeners, then dispose the gizmo helper's GPU resources.
      tc.disconnect();
      const tcHelper = tc.getHelper();
      scene.remove(tcHelper);
      tcHelper.traverse((child) => {
        const c = child as THREE.Mesh;
        (c.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
        const m = c.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose?.();
      });
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      disposeDims(st.current);
      highlight.geometry.dispose();
      (highlight.material as THREE.Material).dispose();
      multiHi.geometry.dispose();
      (multiHi.material as THREE.Material).dispose();
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
    // Only auto-frame the camera the FIRST time a model appears — on later updates
    // (fillet, extrude, an AI edit, a param tweak) keep the user's current view/angle
    // instead of snapping back to default. "Reset view" re-frames on demand.
    const hadMesh = !!s.mesh;
    // A gizmo may be attached to a pivot holding the current mesh — detach and drop the pivot
    // before we dispose/replace the mesh (content.clear() below removes the pivot too).
    s.tc.detach();
    s.pivot = null;
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
    s.selCache = null;
    s.highlight.visible = false;
    s.highlight.geometry.dispose();
    s.highlight.geometry = new THREE.BufferGeometry();
    s.multiHi.visible = false;
    s.multiHi.geometry.dispose();
    s.multiHi.geometry = new THREE.BufferGeometry();
    s.edgeHi.visible = false;
    s.vertHi.visible = false;
    if (!geometry) {
      updateDims(s, showDims, units);
      return;
    }

    // Colour-coded split pieces bake a per-vertex "color"; honour it (white base so
    // the colours aren't tinted). Plain models fall back to the neutral grey.
    const hasColor = !!geometry.getAttribute("color");
    s.material.vertexColors = hasColor;
    s.material.color.set(hasColor ? "#ffffff" : "#c7ccd3");
    s.material.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, s.material);
    s.content.add(mesh);
    // NOTE: s.tri (the welded adjacency map for face/edge picking) is built lazily on the
    // first hover/box-select in select mode — see ensureTri. Building it here would run a
    // heavy weld pass on the main thread on EVERY edit, stalling the orbit for ~1s even
    // when the user never picks anything. Deferring it makes edits feel real-time.
    geometry.computeBoundingBox();
    const gs = geometry.boundingBox!.getSize(new THREE.Vector3());
    s.markR = Math.min(2, Math.max(0.5, Math.max(gs.x, gs.y, gs.z) * 0.008)); // edge/vertex marker size
    // The crease-edge overlay is a main-thread EdgesGeometry pass — heavy on dense
    // models. Live-drag preview geometry (userData.preview) skips it: many swaps per
    // second, and the drag reads fine shaded-only. The commit re-adds it.
    if (!geometry.userData.preview) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 30),
        new THREE.LineBasicMaterial({ color: "#2a2e35" }),
      );
      mesh.add(edges);
    }
    s.mesh = mesh;
    updateDims(s, showDims, units);
    if (!hadMesh) frameToObject(s); // keep the current camera on edits; frame only on first load
    if (cb.current.transformMode !== "off") enterTransform(s, cb.current.transformMode); // re-arm gizmo on the new mesh
  }, [geometry]);

  // Toggle the transform gizmo on/off and switch rotate↔scale.
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    if (transformMode === "off") {
      exitTransform(s);
      updateDims(s, showDims, units); // restore dimension lines hidden during transform
    } else {
      enterTransform(s, transformMode);
    }
  }, [transformMode]);

  // Render point-to-point measurements (lines + distance labels) and the pending anchor.
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    for (const o of [...s.measures.children]) {
      s.measures.remove(o);
      const a = o as any;
      a.geometry?.dispose?.();
      const mat = a.material;
      if (Array.isArray(mat)) mat.forEach((m: any) => { m.map?.dispose?.(); m.dispose?.(); });
      else { mat?.map?.dispose?.(); mat?.dispose?.(); }
    }
    if (!measurements.length && !measurePending) return;
    let modelSize = 40;
    if (s.mesh) { s.mesh.geometry.computeBoundingBox(); const sz = s.mesh.geometry.boundingBox!.getSize(new THREE.Vector3()); modelSize = Math.max(sz.x, sz.y, sz.z) || 40; }
    const markR = Math.max(0.4, modelSize * 0.012);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x0d9488, transparent: true, opacity: 0.95, depthTest: false });
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x0d9488, depthTest: false, transparent: true });
    const addDot = (p: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(markR, 12, 8), dotMat);
      m.position.set(p[0], p[1], p[2]); m.renderOrder = 5; s.measures.add(m);
    };
    for (const meas of measurements) {
      const a = new THREE.Vector3(...meas.a), b = new THREE.Vector3(...meas.b);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat);
      line.renderOrder = 5; s.measures.add(line);
      addDot(meas.a); addDot(meas.b);
      const label = makeLabel(fmtDist(a.distanceTo(b), units), { fg: "#0f766e", bg: "rgba(255,255,255,0.94)", border: "#0d9488" });
      label.position.copy(a.clone().add(b).multiplyScalar(0.5));
      label.userData.dimLabel = true; label.userData.baseH = modelSize * 0.05;
      s.measures.add(label);
    }
    if (measurePending) addDot(measurePending);
  }, [measurements, measurePending, units, geometry]);

  // Show/position the drag handle on the selected face (extrude) or edge/corner (fillet); null → hide.
  useEffect(() => {
    const s = st.current;
    if (!s || s.pushDrag) return; // don't disturb an active drag
    if (!pushArrow) { s.pushArrow.visible = false; return; }
    s.pushArrow.userData.center = pushArrow.center;
    s.pushArrow.userData.normal = pushArrow.normal;
    s.pushArrow.userData.kind = pushArrow.kind;
    s.pushArrow.userData.dist = 0;
    layoutPushArrow(s, pushArrow.center, pushArrow.normal, 0, units, pushArrow.kind);
  }, [pushArrow, units, geometry]);

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
    s.multiHi.visible = false;
    s.edgeHi.visible = false;
    s.vertHi.visible = false;
    s.controls.enabled = true;
    s.renderer.domElement.style.cursor = "";
  }, [selectMode]);

  // When the app drops the box-selected face set, hide its overlay.
  useEffect(() => {
    const s = st.current;
    if (s && !boxSelectionActive) s.multiHi.visible = false;
  }, [boxSelectionActive]);

  // Re-highlight the locked feature when the selection kind (face/edge/vertex) changes,
  // and re-emit it so the app's edit panel switches to the new kind in sync. Point mode
  // has no feature highlight, so just clear the overlays.
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.multiHi.visible = false; // a box-selected set belongs to one mode; switching clears it
    if (selectKind === "point") {
      s.highlight.visible = false; s.edgeHi.visible = false; s.vertHi.visible = false;
      return;
    }
    if (s.lockedHit) {
      const info = showFeature(s, selectKind, s.lockedHit.faceIndex, s.lockedHit.point);
      if (info) cb.current.onPickFeature(featureToPayload(info));
    }
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
  | { kind: "face"; center: THREE.Vector3; normal: THREE.Vector3; w: number; h: number; curved: boolean; onFace: THREE.Vector3 }
  | { kind: "edge"; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; len: number; closed: boolean }
  | { kind: "vertex"; pos: THREE.Vector3 };

/** Precompute triangle normals, welded-vertex adjacency, unique vertices, and the
    model's sharp edges — everything hover-selection needs. */
/** Build the pick-adjacency map on demand (first hover/box-select after an edit) and
 *  cache it on the state. Keeps the heavy weld pass off the per-edit critical path. */
function ensureTri(s: Internals): TriData | null {
  if (!s.tri && s.mesh) s.tri = buildTriData(s.mesh.geometry as THREE.BufferGeometry);
  return s.tri;
}

function buildTriData(geo: THREE.BufferGeometry): TriData {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const idx = geo.index;
  const count = idx ? idx.count / 3 : pos.count / 3;
  const corner = (c: number) => (idx ? idx.getX(c) : c);

  // Per-triangle B-rep face id from replicad's faceGroups (preserved by syncFaces on
  // userData). Present for CAD models — lets face-select grab the exact face and stop
  // at fillets. null for plain meshes (STL/GLB), where we fall back to the flood-fill.
  let faceId: Int32Array | null = null;
  const groups = geo.userData?.faceGroups as { start: number; count: number; faceId: number }[] | undefined;
  if (groups && groups.length) {
    faceId = new Int32Array(count).fill(-1);
    for (const g of groups) {
      const t0 = Math.floor(g.start / 3), t1 = Math.min(count, Math.floor((g.start + g.count) / 3));
      for (let t = t0; t < t1; t++) faceId[t] = g.faceId;
    }
  }

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

  // Per-triangle normal + plane offset. Zero-area triangles are flagged so their
  // unreliable (zero) normals never create false creases or block flood-fill.
  const normals = new Float32Array(count * 3);
  const d = new Float32Array(count);
  const degen = new Uint8Array(count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < count; t++) {
    a.fromBufferAttribute(pos, corner(t * 3));
    b.fromBufferAttribute(pos, corner(t * 3 + 1));
    c3.fromBufferAttribute(pos, corner(t * 3 + 2));
    ab.subVectors(b, a); ac.subVectors(c3, a); n.crossVectors(ab, ac);
    const area = n.length();
    if (area < 1e-9) { degen[t] = 1; continue; } // leave normal 0, d 0
    n.divideScalar(area);
    normals[t * 3] = n.x; normals[t * 3 + 1] = n.y; normals[t * 3 + 2] = n.z;
    d[t] = n.dot(a);
  }

  // Edge → triangle adjacency (welded) with occurrence counting (handles >2-triangle
  // non-manifold edges gracefully), plus sharp edges (crease > 30° / boundary / non-manifold).
  const adj = new Int32Array(count * 3).fill(-1);
  const rec = new Map<string, { va: number; vb: number; t: number; e: number; count: number; sharp: boolean }>();
  const COS30 = Math.cos((30 * Math.PI) / 180);
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const va = vid[t * 3 + e], vb = vid[t * 3 + ((e + 1) % 3)];
      const key = va < vb ? `${va}_${vb}` : `${vb}_${va}`;
      const r = rec.get(key);
      if (r === undefined) {
        rec.set(key, { va, vb, t, e, count: 1, sharp: false });
      } else {
        r.count++;
        if (r.count === 2) {
          adj[t * 3 + e] = r.t;
          adj[r.t * 3 + r.e] = t;
          if (!degen[t] && !degen[r.t]) {
            const dot = normals[t * 3] * normals[r.t * 3] + normals[t * 3 + 1] * normals[r.t * 3 + 1] + normals[t * 3 + 2] * normals[r.t * 3 + 2];
            if (dot < COS30) r.sharp = true;
          }
        }
      }
    }
  }
  // One segment per physical edge: boundary (count 1), non-manifold (count ≥ 3), or crease.
  const segVa: number[] = [], segVb: number[] = [];
  for (const r of rec.values()) {
    if (r.count === 1 || r.count >= 3 || r.sharp) { segVa.push(r.va); segVb.push(r.vb); }
  }
  const edgeCount = segVa.length;
  const edges = new Float32Array(edgeCount * 6);
  for (let i = 0; i < edgeCount; i++) {
    const va = segVa[i], vb = segVb[i];
    edges.set([vpos[va * 3], vpos[va * 3 + 1], vpos[va * 3 + 2], vpos[vb * 3], vpos[vb * 3 + 1], vpos[vb * 3 + 2]], i * 6);
  }

  // Chain sharp segments into physical edges: walk across vertices of degree 2 so a
  // subdivided straight edge OR a curved rim reads as ONE edge; stop at junctions.
  const vseg = new Map<number, number[]>();
  const push = (v: number, i: number) => { const l = vseg.get(v); if (l) l.push(i); else vseg.set(v, [i]); };
  for (let i = 0; i < edgeCount; i++) { push(segVa[i], i); push(segVb[i], i); }
  const edgeChainId = new Int32Array(edgeCount).fill(-1);
  const chains: EdgeChain[] = [];
  for (let start = 0; start < edgeCount; start++) {
    if (edgeChainId[start] >= 0) continue;
    const cid = chains.length;
    const segs: number[] = [];
    const stack = [start];
    edgeChainId[start] = cid;
    while (stack.length) {
      const si = stack.pop()!;
      segs.push(si);
      for (const v of [segVa[si], segVb[si]]) {
        const list = vseg.get(v)!;
        if (list.length !== 2) continue; // junction — don't merge across
        for (const nb of list) if (edgeChainId[nb] < 0) { edgeChainId[nb] = cid; stack.push(nb); }
      }
    }
    // metrics: length, ends (vertices used once), centroid
    const vcount = new Map<number, number>();
    let len = 0;
    const cen = new THREE.Vector3();
    for (const si of segs) {
      vcount.set(segVa[si], (vcount.get(segVa[si]) ?? 0) + 1);
      vcount.set(segVb[si], (vcount.get(segVb[si]) ?? 0) + 1);
      len += Math.hypot(edges[si * 6 + 3] - edges[si * 6], edges[si * 6 + 4] - edges[si * 6 + 1], edges[si * 6 + 5] - edges[si * 6 + 2]);
      cen.add(new THREE.Vector3(edges[si * 6], edges[si * 6 + 1], edges[si * 6 + 2]));
      cen.add(new THREE.Vector3(edges[si * 6 + 3], edges[si * 6 + 4], edges[si * 6 + 5]));
    }
    cen.multiplyScalar(1 / (segs.length * 2));
    const ends = [...vcount.entries()].filter(([, c]) => c === 1).map(([v]) => v);
    const closed = ends.length < 2;
    const pv = (v: number) => new THREE.Vector3(vpos[v * 3], vpos[v * 3 + 1], vpos[v * 3 + 2]);
    const A = closed ? cen : pv(ends[0]);
    const B = closed ? cen : pv(ends[1]);
    // Representative point: the start of the chain's median segment. OCCT samples edge
    // vertices ON the true curve, so this point lies exactly on the physical edge (unlike
    // a chord midpoint or centroid) — which makes it a reliable target for fillet/chamfer.
    const midSeg = segs[Math.floor(segs.length / 2)];
    const C = new THREE.Vector3(edges[midSeg * 6], edges[midSeg * 6 + 1], edges[midSeg * 6 + 2]);
    chains.push({ segs, ax: A.x, ay: A.y, az: A.z, bx: B.x, by: B.y, bz: B.z, cx: C.x, cy: C.y, cz: C.z, len, closed });
  }

  return { normals, d, degen, count, pos, idx, adj, vpos: new Float32Array(vpos), nUnique, edges, edgeCount, edgeChainId, chains, faceId };
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
    if (tri.degen[t]) continue; // a sliver's normal is unreliable — don't grow from it
    const tx = tri.normals[t * 3], ty = tri.normals[t * 3 + 1], tz = tri.normals[t * 3 + 2];
    for (let e = 0; e < 3; e++) {
      const nb = tri.adj[t * 3 + e];
      if (nb < 0 || seen[nb] || tri.degen[nb]) continue;
      const dot = tx * tri.normals[nb * 3] + ty * tri.normals[nb * 3 + 1] + tz * tri.normals[nb * 3 + 2];
      if (dot > COS) { seen[nb] = 1; stack.push(nb); }
    }
  }
  return out;
}

/** Triangles making up the face at `seed`. For CAD models we group by the exact
 *  replicad B-rep face id, so a flat face is selected cleanly and stops at its fillets;
 *  meshes without face ids fall back to the dihedral flood-fill. */
function faceRegion(tri: TriData, seed: number): number[] {
  const fid = tri.faceId;
  if (fid && fid[seed] >= 0) {
    const target = fid[seed];
    const out: number[] = [];
    for (let t = 0; t < tri.count; t++) if (fid[t] === target) out.push(t);
    if (out.length) return out;
  }
  return smoothRegion(tri, seed);
}

function nearestVertexId(tri: TriData, p: THREE.Vector3): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < tri.nUnique; i++) {
    const dx = tri.vpos[i * 3] - p.x, dy = tri.vpos[i * 3 + 1] - p.y, dz = tri.vpos[i * 3 + 2] - p.z;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return best;
}

/** Index of the physical edge (chain) whose nearest tessellation segment is closest to p. */
function nearestEdgeChainId(tri: TriData, p: THREE.Vector3): number {
  if (!tri.edgeCount) return -1;
  let best = -1, bestD = Infinity;
  const a = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3(), proj = new THREE.Vector3();
  for (let i = 0; i < tri.edgeCount; i++) {
    a.set(tri.edges[i * 6], tri.edges[i * 6 + 1], tri.edges[i * 6 + 2]);
    ab.set(tri.edges[i * 6 + 3] - a.x, tri.edges[i * 6 + 4] - a.y, tri.edges[i * 6 + 5] - a.z);
    ap.subVectors(p, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    proj.copy(a).addScaledVector(ab, t);
    const dd = proj.distanceToSquared(p);
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return best < 0 ? -1 : tri.edgeChainId[best];
}

/** Metrics + a triangle-soup position buffer for one smooth face region, given a
 *  representative triangle `rep` (used for the outward normal + curved test). */
function faceRegionInfo(tri: TriData, tris: number[], rep: number): { info: FeatureInfo; positions: Float32Array } {
  const { pos, idx } = tri;
  const positions = new Float32Array(tris.length * 9);
  const v = new THREE.Vector3();
  const bbox = new THREE.Box3();
  let p = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k);
      positions[p++] = v.x; positions[p++] = v.y; positions[p++] = v.z;
      bbox.expandByPoint(v);
    }
  }
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const normal = new THREE.Vector3(tri.normals[rep * 3], tri.normals[rep * 3 + 1], tri.normals[rep * 3 + 2]);
  const COS18 = Math.cos((18 * Math.PI) / 180);
  let curved = false;
  for (const t of tris) {
    if (tri.degen[t]) continue;
    if (normal.x * tri.normals[t * 3] + normal.y * tri.normals[t * 3 + 1] + normal.z * tri.normals[t * 3 + 2] < COS18) { curved = true; break; }
  }
  const dims = [size.x, size.y, size.z];
  const axis = Math.abs(normal.x) > 0.9 ? 0 : Math.abs(normal.y) > 0.9 ? 1 : Math.abs(normal.z) > 0.9 ? 2 : -1;
  let w: number, h: number;
  if (axis >= 0 && !curved) { const rest = dims.filter((_, i) => i !== axis); w = rest[0]; h = rest[1]; }
  else { const sorted = [...dims].sort((x, y) => y - x); w = sorted[0]; h = sorted[1]; }
  // A point guaranteed ON the face (the representative triangle's centroid) — the bbox
  // centre can fall off an L-shaped face, but a triangle centroid never does. Used to
  // resolve the exact face for direct extrude/fillet ops.
  const onFace = new THREE.Vector3();
  for (let k = 0; k < 3; k++) onFace.add(new THREE.Vector3().fromBufferAttribute(tri.pos, tri.idx ? tri.idx.getX(rep * 3 + k) : rep * 3 + k));
  onFace.multiplyScalar(1 / 3);
  return { info: { kind: "face", center, normal, w, h, curved, onFace }, positions };
}

/** Marquee face selection: every smooth face with a visible triangle whose centroid
 *  falls inside the screen rectangle. Highlights them in the multi-select overlay and
 *  returns one payload per distinct face. */
function selectFacesInBox(
  s: Internals, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer,
  sx: number, sy: number, ex: number, ey: number,
): PickedFeature[] {
  const tri = ensureTri(s), mesh = s.mesh;
  if (!tri || !mesh) return [];
  const rect = renderer.domElement.getBoundingClientRect();
  const minX = Math.min(sx, ex) - rect.left, maxX = Math.max(sx, ex) - rect.left;
  const minY = Math.min(sy, ey) - rect.top, maxY = Math.max(sy, ey) - rect.top;
  const { pos, idx, count } = tri;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3(), proj = new THREE.Vector3();
  const rc = new THREE.Raycaster();
  const occlude = count <= 20000; // skip the per-triangle visibility raycast on very dense meshes
  const seen = new Uint8Array(count);
  const faces: PickedFeature[] = [];
  const chunks: Float32Array[] = [];
  let total = 0;
  for (let t = 0; t < count; t++) {
    if (tri.degen[t] || seen[t]) continue;
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    proj.copy(cen).project(camera);
    if (proj.z < -1 || proj.z > 1) continue;
    const px = (proj.x * 0.5 + 0.5) * rect.width, py = (-proj.y * 0.5 + 0.5) * rect.height;
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    if (occlude) {
      rc.setFromCamera(new THREE.Vector2(proj.x, proj.y), camera);
      const hit = rc.intersectObject(mesh, false)[0];
      if (!hit || hit.faceIndex !== t) continue; // behind another face → not visible
    }
    const region = faceRegion(tri, t);
    for (const rt of region) seen[rt] = 1;
    const { info, positions } = faceRegionInfo(tri, region, t);
    faces.push(featureToPayload(info));
    chunks.push(positions);
    total += positions.length;
  }
  // Build (or clear) the combined multi-select overlay.
  s.multiHi.geometry.dispose();
  if (total) {
    const merged = new Float32Array(total);
    let o = 0;
    for (const ch of chunks) { merged.set(ch, o); o += ch.length; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
    s.multiHi.geometry = geo;
    s.multiHi.visible = true;
  } else {
    s.multiHi.geometry = new THREE.BufferGeometry();
    s.multiHi.visible = false;
  }
  return faces;
}

/** Highlight the face/edge/vertex under the cursor and return its metrics. Caches
    the last resolved target so a hover that stays on it rebuilds nothing. */
function showFeature(s: Internals, kind: "face" | "edge" | "vertex", faceIndex: number, hit: THREE.Vector3): FeatureInfo | null {
  const tri = ensureTri(s);
  if (!tri) return null;
  const showOnly = (m: THREE.Mesh) => { s.highlight.visible = m === s.highlight; s.edgeHi.visible = m === s.edgeHi; s.vertHi.visible = m === s.vertHi; };

  if (kind === "face") {
    // Fast path: cursor still inside the cached region → nothing to rebuild.
    if (s.selCache?.region && s.selCache.info.kind === "face" && s.selCache.region[faceIndex]) {
      showOnly(s.highlight);
      return s.selCache.info;
    }
    const tris = faceRegion(tri, faceIndex);
    if (!tris.length) return null;
    const { info, positions } = faceRegionInfo(tri, tris, faceIndex);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    s.highlight.geometry.dispose();
    s.highlight.geometry = geo;
    const region = new Uint8Array(tri.count);
    for (const t of tris) region[t] = 1;
    s.selCache = { key: `face:${faceIndex}`, info, region };
    showOnly(s.highlight);
    return info;
  }

  if (kind === "edge") {
    const chainId = nearestEdgeChainId(tri, hit);
    if (chainId < 0) return null;
    if (s.selCache?.key === `edge:${chainId}` && s.selCache.info.kind === "edge") { showOnly(s.edgeHi); return s.selCache.info; }
    const ch = tri.chains[chainId];
    // Highlight the WHOLE physical edge (a thin tube along every segment, not one chord).
    // A real edge has no width, so keep the tube slim — just enough to read as a line.
    const er = Math.max(0.1, s.markR * 0.32);
    const parts: THREE.BufferGeometry[] = [];
    const yA = new THREE.Vector3(0, 1, 0);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), dir = new THREE.Vector3(), mid = new THREE.Vector3(), q = new THREE.Quaternion(), mtx = new THREE.Matrix4(), scl = new THREE.Vector3();
    for (const si of ch.segs) {
      A.set(tri.edges[si * 6], tri.edges[si * 6 + 1], tri.edges[si * 6 + 2]);
      B.set(tri.edges[si * 6 + 3], tri.edges[si * 6 + 4], tri.edges[si * 6 + 5]);
      dir.subVectors(B, A);
      const L = dir.length();
      if (L < 1e-6) continue;
      dir.divideScalar(L);
      mid.addVectors(A, B).multiplyScalar(0.5);
      q.setFromUnitVectors(yA, dir);
      scl.set(er, L, er);
      mtx.compose(mid, q, scl);
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
      cyl.applyMatrix4(mtx);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", cyl.getAttribute("position"));
      if (cyl.index) pg.setIndex(cyl.index);
      parts.push(pg);
    }
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    s.edgeHi.geometry.dispose();
    s.edgeHi.geometry = merged;
    s.edgeHi.position.set(0, 0, 0);
    s.edgeHi.quaternion.identity();
    s.edgeHi.scale.set(1, 1, 1);
    const info: FeatureInfo = {
      kind: "edge",
      a: new THREE.Vector3(ch.ax, ch.ay, ch.az),
      b: new THREE.Vector3(ch.bx, ch.by, ch.bz),
      c: new THREE.Vector3(ch.cx, ch.cy, ch.cz),
      len: ch.len, closed: ch.closed,
    };
    s.selCache = { key: `edge:${chainId}`, info, region: null };
    showOnly(s.edgeHi);
    return info;
  }

  const vId = nearestVertexId(tri, hit);
  if (s.selCache?.key === `vertex:${vId}` && s.selCache.info.kind === "vertex") { showOnly(s.vertHi); return s.selCache.info; }
  const nv = new THREE.Vector3(tri.vpos[vId * 3], tri.vpos[vId * 3 + 1], tri.vpos[vId * 3 + 2]);
  s.vertHi.position.copy(nv);
  s.vertHi.scale.setScalar(s.markR * 1.8);
  const info: FeatureInfo = { kind: "vertex", pos: nv };
  s.selCache = { key: `vertex:${vId}`, info, region: null };
  showOnly(s.vertHi);
  return info;
}

/** Map an internal FeatureInfo to the rounded, serialisable payload the app edits with. */
function featureToPayload(info: FeatureInfo): PickedFeature {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (info.kind === "face") {
    return {
      kind: "face", label: info.curved ? "curved surface" : `${faceLabel(info.normal)} face`, curved: info.curved,
      cx: r(info.center.x), cy: r(info.center.y), cz: r(info.center.z),
      nx: r(info.normal.x), ny: r(info.normal.y), nz: r(info.normal.z),
      w: r(info.w), h: r(info.h),
      at: [info.onFace.x, info.onFace.y, info.onFace.z], // full-precision point on the face
    };
  }
  if (info.kind === "edge") {
    return {
      kind: "edge", label: info.closed ? "edge loop" : "edge", closed: info.closed,
      cx: r(info.c.x), cy: r(info.c.y), cz: r(info.c.z),
      ax: r(info.a.x), ay: r(info.a.y), az: r(info.a.z),
      bx: r(info.b.x), by: r(info.b.y), bz: r(info.b.z),
      len: r(info.len),
      at: [info.c.x, info.c.y, info.c.z], // full precision, exactly on the edge
    };
  }
  return { kind: "vertex", label: "corner", cx: r(info.pos.x), cy: r(info.pos.y), cz: r(info.pos.z), at: [info.pos.x, info.pos.y, info.pos.z] };
}

/** Human name for a face from its outward normal (Z-up). */
function faceLabel(n: THREE.Vector3): string {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (az >= ax && az >= ay) return n.z > 0 ? "top" : "bottom";
  if (ay >= ax) return n.y > 0 ? "back" : "front";
  return n.x > 0 ? "right" : "left";
}

// ---- Whole-body transform gizmo (rotate/scale) ----
// The gizmo drives a pivot Group placed at the model's centre; the mesh is reparented under
// it so a rotation spins the part in place (not about the bed origin). On release we read the
// pivot's transform, emit ONE parametric op, and let the worker rebuild replace the preview.

/** Attach the gizmo: build a pivot at the model centre, reparent the mesh under it. */
function enterTransform(s: Internals, mode: "move" | "rotate" | "scale") {
  if (!s.mesh) { s.tc.detach(); return; }
  if (s.pivot) exitTransform(s); // tear down any prior pivot first
  s.mesh.geometry.computeBoundingBox();
  const center = s.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()); // mesh sits at content origin
  const pivot = new THREE.Group();
  pivot.position.copy(center);
  pivot.userData.center0 = center.clone(); // remember the start so a Move can read its delta
  s.content.add(pivot);
  s.content.remove(s.mesh);
  pivot.add(s.mesh);
  s.mesh.position.copy(center.clone().negate()); // keep the mesh visually put
  s.pivot = pivot;
  s.tc.setMode(mode === "move" ? "translate" : mode === "scale" ? "scale" : "rotate");
  s.tc.attach(pivot);
  if (s.dims) s.dims.visible = false; // dimension lines don't follow the pivot — hide while transforming
}

/** Detach the gizmo and put the mesh back under content with an identity transform. */
function exitTransform(s: Internals) {
  s.tc.detach();
  const pivot = s.pivot;
  if (pivot) {
    if (s.mesh && s.mesh.parent === pivot) {
      pivot.remove(s.mesh);
      s.mesh.position.set(0, 0, 0);
      s.mesh.quaternion.identity();
      s.mesh.scale.set(1, 1, 1);
      s.content.add(s.mesh);
    }
    s.content.remove(pivot);
  }
  s.pivot = null;
}

/** Read the pivot's net transform and emit one rotate/scale op (display coords; App adds recenter). */
function commitTransform(s: Internals, emit: (c: TransformCommit) => void) {
  const pivot = s.pivot;
  if (!pivot) return;
  const mode = s.tc.getMode();
  if (mode === "translate") {
    const c0 = (pivot.userData.center0 as THREE.Vector3) ?? pivot.position;
    const d = pivot.position.clone().sub(c0);
    if (d.lengthSq() < 1e-6) return; // no meaningful move
    emit({ kind: "translate", delta: [d.x, d.y, d.z] });
    return;
  }
  const c0 = (pivot.userData.center0 as THREE.Vector3) ?? pivot.position;
  const center: [number, number, number] = [c0.x, c0.y, c0.z];
  if (mode === "scale") {
    // replicad scale is UNIFORM only, so map any handle (even a per-axis one) to a single factor:
    // take the component that moved most from 1, and clamp positive (never flip/degenerate).
    const comps = [pivot.scale.x, pivot.scale.y, pivot.scale.z];
    let factor = 1, maxDev = 0;
    for (const v of comps) {
      const dev = Math.abs(Math.log(Math.max(1e-3, Math.abs(v))));
      if (dev > maxDev) { maxDev = dev; factor = Math.abs(v); }
    }
    factor = Math.max(0.05, factor); // never zero/negative
    if (Math.abs(factor - 1) < 1e-3) return; // no meaningful change
    emit({ kind: "scale", factor, center });
  } else {
    const q = pivot.quaternion.clone().normalize();
    const vlen = Math.hypot(q.x, q.y, q.z);
    const angle = 2 * Math.atan2(vlen, q.w); // radians, signed with axis
    if (angle < 1e-4) return;
    const axis: [number, number, number] = vlen > 1e-8 ? [q.x / vlen, q.y / vlen, q.z / vlen] : [0, 0, 1];
    emit({ kind: "rotate", axis, angleDeg: (angle * 180) / Math.PI, center });
  }
}

// ---- Push-pull handle (drag a flat face along its normal to extrude) ----

/** Boundary edges of a triangle soup (the selected face) as [ax,ay,az,bx,by,bz,…] — an edge
 *  shared by two triangles is interior; those touched once bound the face. Computed once per drag. */
export function faceBoundary(cap: Float32Array): Float32Array {
  const key = (i: number) => {
    const x = Math.round(cap[i] * 100), y = Math.round(cap[i + 1] * 100), z = Math.round(cap[i + 2] * 100);
    return `${x}_${y}_${z}`;
  };
  const seen = new Map<string, { i: number; j: number; n: number }>();
  const tris = cap.length / 9;
  for (let t = 0; t < tris; t++) {
    const c = [t * 9, t * 9 + 3, t * 9 + 6];
    for (let e = 0; e < 3; e++) {
      const a = c[e], b = c[(e + 1) % 3];
      const ka = key(a), kb = key(b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = seen.get(ek);
      if (rec) rec.n++;
      else seen.set(ek, { i: a, j: b, n: 1 });
    }
  }
  const out: number[] = [];
  for (const { i, j, n } of seen.values()) {
    if (n === 1) out.push(cap[i], cap[i + 1], cap[i + 2], cap[j], cap[j + 1], cap[j + 2]);
  }
  return new Float32Array(out);
}

/** Closed prism solid for the boolean live preview: the ghost's offset cap + walls, plus a
 *  reversed bottom cap sealing the original face. Winding: the cap comes from the model's
 *  outward-facing triangles, and each boundary edge keeps its in-triangle order, which makes
 *  buildGhost's walls face outward for a positive (along +n) extrude; a negative extrude
 *  mirrors the solid, so every triangle is flipped to restore outward orientation. */
export function buildSolidPrism(cap: Float32Array, bnd: Float32Array, n: [number, number, number], dist: number): Float32Array {
  const ghost = buildGhost(cap, bnd, n, dist); // offset cap + side walls
  const out = new Float32Array(ghost.length + cap.length);
  out.set(ghost, 0);
  // Bottom cap: the original face, wound in reverse so it faces out of the solid (−n).
  let o = ghost.length;
  for (let t = 0; t < cap.length; t += 9) {
    out.set(cap.subarray(t, t + 3), o);
    out.set(cap.subarray(t + 6, t + 9), o + 3);
    out.set(cap.subarray(t + 3, t + 6), o + 6);
    o += 9;
  }
  if (dist < 0) {
    // Mirrored solid → inside-out; swap two vertices of every triangle.
    for (let t = 0; t < out.length; t += 9) {
      for (let k = 0; k < 3; k++) {
        const a = out[t + 3 + k];
        out[t + 3 + k] = out[t + 6 + k];
        out[t + 6 + k] = a;
      }
    }
  }
  return out;
}

/** Build the live prism preview: the face cap offset by n·dist, plus side walls swept from the
 *  boundary edges. Pure position math on the arrays captured at drag start, so it's cheap per frame. */
function buildGhost(cap: Float32Array, bnd: Float32Array, n: [number, number, number], dist: number): Float32Array {
  const ox = n[0] * dist, oy = n[1] * dist, oz = n[2] * dist;
  const capTris = cap.length / 3;
  const walls = bnd.length / 6;
  const out = new Float32Array(cap.length + walls * 18); // offset cap + 2 tris per boundary edge
  // offset cap
  for (let i = 0; i < cap.length; i += 3) {
    out[i] = cap[i] + ox; out[i + 1] = cap[i + 1] + oy; out[i + 2] = cap[i + 2] + oz;
  }
  // side walls: for each boundary edge (A,B) → quad A,B,B',A'
  let o = cap.length;
  for (let e = 0; e < walls; e++) {
    const ax = bnd[e * 6], ay = bnd[e * 6 + 1], az = bnd[e * 6 + 2];
    const bx = bnd[e * 6 + 3], by = bnd[e * 6 + 4], bz = bnd[e * 6 + 5];
    const axo = ax + ox, ayo = ay + oy, azo = az + oz;
    const bxo = bx + ox, byo = by + oy, bzo = bz + oz;
    // tri 1: A, B, B'
    out[o++] = ax; out[o++] = ay; out[o++] = az; out[o++] = bx; out[o++] = by; out[o++] = bz; out[o++] = bxo; out[o++] = byo; out[o++] = bzo;
    // tri 2: A, B', A'
    out[o++] = ax; out[o++] = ay; out[o++] = az; out[o++] = bxo; out[o++] = byo; out[o++] = bzo; out[o++] = axo; out[o++] = ayo; out[o++] = azo;
  }
  void capTris;
  return out;
}

function modelSizeOf(s: Internals): number {
  if (!s.mesh) return 40;
  s.mesh.geometry.computeBoundingBox();
  const sz = s.mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  return Math.max(sz.x, sz.y, sz.z) || 40;
}

/** Position/scale the arrow along the handle direction for a given (signed) distance.
 *  dist 0 draws the resting handle; during a drag it grows/flips to show magnitude + sign.
 *  kind "fillet" labels it as a radius (R …); "extrude" labels a signed distance. */
function layoutPushArrow(s: Internals, center: [number, number, number], normal: [number, number, number], dist: number, units: "mm" | "in", kind: "extrude" | "fillet" = "extrude") {
  const g = s.pushArrow;
  const size = modelSizeOf(s);
  const dir = new THREE.Vector3(...normal).normalize();
  const sign = dist >= 0 ? 1 : -1;
  const L = Math.max(size * 0.18, Math.abs(dist));
  // Slim, Shapr-style handle: a hairline shaft with a small crisp tip. Capped so it
  // never turns into a fat teardrop on large parts (the old size*0.006 did at ~150 mm).
  const rS = Math.min(0.65, Math.max(0.22, size * 0.0032));
  g.position.set(center[0], center[1], center[2]);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(sign));
  const [shaft, cone, grab] = g.children as THREE.Mesh[];
  shaft.position.set(0, L * 0.42, 0); shaft.scale.set(rS, L * 0.84, rS);
  cone.position.set(0, L * 0.92, 0); cone.scale.set(rS * 3.4, L * 0.16, rS * 3.4);
  // Generous invisible grab target so the thin arrow is easy to click.
  const grabR = Math.max(rS * 8, size * 0.06);
  grab.position.set(0, L * 0.55, 0); grab.scale.set(grabR, L * 1.3, grabR);
  s.pushArrow.updateMatrixWorld(true);
  // Live distance label while dragging (child index 3); removed at rest.
  const old = g.children[3];
  if (old) { g.remove(old); const m = (old as THREE.Sprite).material as THREE.SpriteMaterial; m.map?.dispose(); m.dispose(); }
  if (Math.abs(dist) > 1e-3) {
    const text = kind === "fillet" ? `R ${fmtDist(Math.abs(dist), units)}` : `${dist >= 0 ? "+" : "−"}${fmtDist(Math.abs(dist), units)}`;
    const label = makeLabel(text, { fg: "#1d4ed8", bg: "rgba(255,255,255,0.95)", border: "#2563eb" });
    label.position.set(0, L + size * 0.06, 0);
    label.userData.dimLabel = true; label.userData.baseH = size * 0.05;
    g.add(label);
  }
  g.visible = true;
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

/** Format a display-space distance (mm) for a measurement label, honouring the unit toggle. */
function fmtDist(mm: number, units: "mm" | "in"): string {
  return units === "in" ? `${(mm / 25.4).toFixed(2)}″` : `${Math.round(mm * 10) / 10} mm`;
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
