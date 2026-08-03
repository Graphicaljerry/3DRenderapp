// What the canvas shows while a model is being built.
//
// Before this the viewer said "Describe something or drop a photo to see it here."
// for the entire generation — the one moment the user is definitely watching, and the
// screen claimed nothing was happening. This is the opposite: what is being made, which
// phase it is in, how long it has taken, and a part visibly building itself.
//
// Honesty rule: the bar is only ever determinate when a real number exists. Mesh
// providers report a percentage, so that drives it. CAD has no percentage to give —
// it has PHASES — so it shows the phase list with the current one lit and the
// animation running free. No invented progress that stalls at 90%.

import { useEffect, useRef, useState } from "react";

export interface BuildProgress {
  /** What is being made — the project name, or the words the user typed. */
  name: string;
  /** The live stage line (same text the chat timeline shows). */
  phase: string;
  /** 0–100 when the engine actually reports it (mesh); null for phase-only (CAD). */
  pct: number | null;
  kind: "cad" | "mesh";
}

/** The phases a CAD build moves through, in order, for the stepper. Matched loosely
    against the live stage text — the wording changes with the route taken. */
const CAD_PHASES: { key: string; label: string; match: RegExp }[] = [
  { key: "read", label: "Reading", match: /reading|checking|choosing/i },
  { key: "look", label: "Looking up", match: /search|research|reference|photo/i },
  { key: "write", label: "Writing CAD", match: /writing|thinking|edit mode/i },
  { key: "build", label: "Building solid", match: /building|kernel|applying/i },
];
const MESH_PHASES: { key: string; label: string; match: RegExp }[] = [
  { key: "read", label: "Reading", match: /reading|checking|choosing/i },
  { key: "look", label: "Looking up", match: /search|research|reference/i },
  { key: "queue", label: "Queued", match: /queue|prepar|starting/i },
  { key: "gen", label: "Sculpting", match: /generat|running|process/i },
];

export function BuildStage({ progress }: { progress: BuildProgress }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const progRef = useRef(progress);
  progRef.current = progress;
  const [t0] = useState(() => Date.now());
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [t0]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const draw = (now: number) => {
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue("--accent").trim() || "#498a6f";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const p = progRef.current;
      const LAYERS = 16;
      // With a real percentage the stack IS the progress. Without one it cycles, which
      // reads as "working" rather than as a measurement it cannot make.
      const elapsed = (now - start) / 1000;
      const frac = p.pct != null ? Math.max(0, Math.min(1, p.pct / 100)) : (elapsed % 4) / 4;
      const upto = Math.max(1, Math.round(frac * LAYERS));

      const cx = w / 2;
      const cy = h * 0.62;
      const rx = Math.min(w * 0.3, 96); // isometric half-width
      const ry = rx * 0.5;
      const lift = Math.max(2.4, ry * 0.09);

      // The plate: one flat isometric diamond, so the part has something to sit on.
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - ry); ctx.lineTo(cx + rx, cy); ctx.lineTo(cx, cy + ry); ctx.lineTo(cx - rx, cy); ctx.closePath();
      ctx.stroke();

      // Layers, bottom-up. A mesh build swells and tapers (organic); a CAD build keeps
      // its section (a machined part) — the shape says which engine is running.
      for (let i = 0; i < upto; i++) {
        const u = i / LAYERS;
        const k = p.kind === "mesh" ? 0.42 + 0.5 * Math.sin(Math.PI * (0.15 + u * 0.85)) : 0.55;
        const lx = rx * k;
        const ly = ry * k;
        const y = cy - i * lift;
        const fresh = i === upto - 1;
        ctx.globalAlpha = fresh ? 0.95 : 0.16 + 0.4 * (i / Math.max(1, upto));
        ctx.lineWidth = fresh ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(cx, y - ly); ctx.lineTo(cx + lx, y); ctx.lineTo(cx, y + ly); ctx.lineTo(cx - lx, y); ctx.closePath();
        ctx.stroke();
        // The nozzle riding the layer that is being laid right now.
        if (fresh && !reduced) {
          const a = (elapsed * 2.2) % (Math.PI * 2);
          ctx.globalAlpha = 1;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * lx, y + Math.sin(a) * ly, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phases = progress.kind === "mesh" ? MESH_PHASES : CAD_PHASES;
  // Which phase we are in: the last one whose pattern the live stage text matches.
  // Unmatched text keeps the previous phase lit rather than resetting to the start.
  let active = 0;
  phases.forEach((ph, i) => { if (ph.match.test(progress.phase)) active = i; });
  const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;

  return (
    <div className="build-stage" role="status" aria-live="polite">
      <canvas ref={ref} className="build-stage-canvas" aria-hidden="true" />
      <div className="build-stage-name">{progress.name}</div>
      <div className="build-stage-phase">{progress.phase}</div>
      <div className="build-stage-bar">
        <span style={progress.pct != null ? { width: `${Math.max(2, Math.min(100, progress.pct))}%` } : undefined} className={progress.pct != null ? "" : "indet"} />
      </div>
      <div className="build-stage-steps">
        {phases.map((ph, i) => (
          <span key={ph.key} className={`bs-step${i < active ? " done" : i === active ? " on" : ""}`}>{ph.label}</span>
        ))}
      </div>
      <div className="build-stage-meta">
        {progress.pct != null ? `${Math.round(progress.pct)}% · ${time}` : `${time} · ${progress.kind === "mesh" ? "mesh engine" : "CAD kernel"}`}
      </div>
    </div>
  );
}
