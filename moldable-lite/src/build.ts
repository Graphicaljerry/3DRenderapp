import * as THREE from "three";
import { Evaluator, Brush, ADDITION, SUBTRACTION } from "three-bvh-csg";
import type { ModelSpec, Shape } from "./spec";

const deg = (d = 0) => (d * Math.PI) / 180;
const csgMaterial = new THREE.MeshStandardMaterial();

function primGeometry(s: Shape): THREE.BufferGeometry {
  switch (s.type) {
    case "box":
      return new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
    case "cylinder": {
      const g = new THREE.CylinderGeometry(s.r, s.r, s.h, 64);
      g.rotateX(Math.PI / 2); // height along Z (print-up)
      return g;
    }
    case "cone": {
      const g = new THREE.ConeGeometry(s.r, s.h, 64);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case "sphere":
      return new THREE.SphereGeometry(s.r, 48, 32);
    case "torus":
      return new THREE.TorusGeometry(s.r, s.tube, 24, 64);
    default:
      throw new Error(`Unknown shape type: ${(s as { type: string }).type}`);
  }
}

function toBrush(s: Shape): Brush {
  const b = new Brush(primGeometry(s), csgMaterial);
  const p = (s as { pos?: [number, number, number] }).pos ?? [0, 0, 0];
  const r = (s as { rot?: [number, number, number] }).rot ?? [0, 0, 0];
  b.position.set(p[0], p[1], p[2]);
  b.rotation.set(deg(r[0]), deg(r[1]), deg(r[2]));
  b.updateMatrixWorld(true);
  return b;
}

export interface BuildResult {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
}

/** Union all `solids`, subtract all `cuts`, drop onto the bed (min z → 0), centre in X/Y. */
export function buildGeometry(spec: ModelSpec): BuildResult {
  const solids = spec.solids.map(toBrush);
  if (solids.length === 0) throw new Error("No solids to build.");

  const ev = new Evaluator();
  let result = solids[0];
  for (let i = 1; i < solids.length; i++) result = ev.evaluate(result, solids[i], ADDITION);
  for (const cut of spec.cuts ?? []) result = ev.evaluate(result, toBrush(cut), SUBTRACTION);

  const geometry = result.geometry.clone();
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  geometry.translate(-cx, -cy, -bb.min.z);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { geometry, dims: { x: round(size.x), y: round(size.y), z: round(size.z) } };
}
