import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ViewerHandle {
  resetView: () => void;
}

interface Props {
  geometry: THREE.BufferGeometry | null;
  wireframe: boolean;
}

interface Internals {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  mesh: THREE.Mesh | null;
  material: THREE.MeshStandardMaterial;
  ro: ResizeObserver;
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({ geometry, wireframe }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const st = useRef<Internals | null>(null);

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

    const grid = new THREE.GridHelper(300, 30, 0xced2d8, 0xe3e6ea);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);

    const material = new THREE.MeshStandardMaterial({ color: "#c7ccd3", metalness: 0.05, roughness: 0.75 });

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    st.current = { renderer, scene, camera, controls, content, mesh: null, material, ro };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
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
    if (!geometry) return;

    const mesh = new THREE.Mesh(geometry, s.material);
    s.content.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 30),
      new THREE.LineBasicMaterial({ color: "#2a2e35" }),
    );
    mesh.add(edges);
    s.mesh = mesh;
    frameToObject(s);
  }, [geometry]);

  useEffect(() => {
    if (st.current) st.current.material.wireframe = wireframe;
  }, [wireframe]);

  useImperativeHandle(ref, () => ({
    resetView() {
      if (st.current) frameToObject(st.current);
    },
  }));

  return <div ref={mount} className="viewerCanvas" />;
});

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
