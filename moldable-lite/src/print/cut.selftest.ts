// Temporary geometry harness for print/cut.ts — driven from a Playwright probe through
// the vite dev server so the real THREE / CSG / BVH stack is exercised. Not shipped.
import * as THREE from "three";
import { penCut, addConnectors, planeSites, strokeSites, repack, type CutStroke } from "./cut";
import { meshVolume } from "./separate";

const vol = (g: THREE.BufferGeometry) => {
  const ng = g.index ? g.toNonIndexed() : g;
  return meshVolume(ng.getAttribute("position").array as Float32Array);
};

export function runCutSelfTest(): string[] {
  const log: string[] = [];
  const say = (s: string) => { log.push(s); return s; };

  // A 40×30×20 bar centred on the origin, resting on z=0.
  const bar = new THREE.BoxGeometry(40, 30, 20).toNonIndexed();
  bar.translate(0, 0, 10);
  const v0 = vol(bar);
  say(`bar volume ${v0.toFixed(0)} mm3 (expect 24000)`);

  // 1. A straight stroke across the middle, drawn on a plane facing -Y (looking along +Y).
  const straight: CutStroke = {
    pts: [[0, 0, -40], [0, 0, 60]].map((p) => [p[0], p[1], p[2]] as [number, number, number]),
    viewDir: [0, 1, 0],
  };
  const cut1 = penCut(bar, straight, { kerf: 0.2 });
  say(`straight cut → ${cut1 ? cut1.pieces.length : 0} pieces`);
  if (cut1) {
    const vs = cut1.pieces.map((p) => vol(p.geometry));
    say(`  piece volumes ${vs.map((v) => v.toFixed(0)).join(" + ")} = ${vs.reduce((a, b) => a + b, 0).toFixed(0)} (expect ≈ ${(v0 - 0.2 * 30 * 20).toFixed(0)} after kerf)`);
    say(`  each piece watertight-ish: ${cut1.pieces.every((p) => vol(p.geometry) > 1000)}`);
  }

  // 2. A curved (V) stroke — the case a plane cut cannot do.
  const curved: CutStroke = {
    pts: [[-30, 0, 25], [-8, 0, -6], [8, 0, 26], [30, 0, -4]] as [number, number, number][],
    viewDir: [0, 1, 0],
  };
  const cut2 = penCut(bar, curved, { kerf: 0.2 });
  say(`curved cut → ${cut2 ? cut2.pieces.length : 0} pieces`);

  // 3. Connectors on the straight cut: one piece grows a peg, the other loses a socket.
  if (cut1) {
    const before = cut1.pieces.map((p) => vol(p.geometry));
    const sites = strokeSites(straight, bar.boundingBox ?? new THREE.Box3().setFromBufferAttribute(bar.getAttribute("position") as THREE.BufferAttribute), 6);
    say(`stroke sites offered: ${sites.length}`);
    const con = addConnectors(cut1.pieces.map((p) => p.geometry), bar, sites, { diameter: 5, depth: 4, clearance: 0.2, maxPerFace: 2 });
    say(`connectors added: ${con.added}`);
    const after = con.pieces.map((g) => vol(g));
    say(`  volumes ${before.map((v) => v.toFixed(0)).join(",")} → ${after.map((v) => v.toFixed(0)).join(",")}`);
    const grew = after.some((v, i) => v > before[i] + 20);
    const shrank = after.some((v, i) => v < before[i] - 20);
    say(`  one side grew a peg: ${grew} | other side gained a socket: ${shrank}`);
    say(`  repack ok: ${repack(con.pieces).pieces.length} pieces`);
  }

  // 3b. A realistically-sized part: a big face should carry several spread-out pins.
  const slab = new THREE.BoxGeometry(120, 80, 40).toNonIndexed();
  slab.translate(0, 0, 20);
  const bigCut = penCut(slab, { pts: [[0, 0, -60], [0, 0, 120]], viewDir: [0, 1, 0] }, { kerf: 0.2 });
  say(`big slab cut → ${bigCut ? bigCut.pieces.length : 0} pieces`);
  if (bigCut) {
    const sites = strokeSites({ pts: [[0, 0, -60], [0, 0, 120]], viewDir: [0, 1, 0] }, new THREE.Box3().setFromBufferAttribute(slab.getAttribute("position") as THREE.BufferAttribute), 8);
    const con = addConnectors(bigCut.pieces.map((p) => p.geometry), slab, sites, { maxPerFace: 3 });
    say(`big slab connectors added: ${con.added} (want 2-3, spread)`);
  }

  // 4. Planar sites (the bed-split path) on the same bar.
  const box = new THREE.Box3().setFromBufferAttribute(bar.getAttribute("position") as THREE.BufferAttribute);
  const psites = planeSites({ point: new THREE.Vector3(0, 0, 10), normal: new THREE.Vector3(1, 0, 0) }, box, 6);
  say(`plane sites offered: ${psites.length}`);
  const halves = penCut(bar, { pts: [[0, -40, 10], [0, 40, 10]], viewDir: [0, 0, 1] }, { kerf: 0.2 });
  if (halves) {
    const con2 = addConnectors(halves.pieces.map((p) => p.geometry), bar, psites, { maxPerFace: 2 });
    say(`planar connectors added: ${con2.added}`);
  }
  return log;
}
