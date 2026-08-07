import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Viewer, type ViewerHandle, type PickedPoint, type PickedFeature, type SelectKind, type ShowcaseScene, type TransformMode, type TransformCommit, type Measurement, type ContextHit } from "./Viewer";
import { Markdown } from "./Markdown";
import { BuildStage, type BuildProgress } from "./BuildStage";
import type { Pin } from "../store/types";
import type { ChatMessage, ClarifyState, Mode, ModePref } from "../App";
import type { BuildPlan } from "../llm/plan";
import type { PrintabilityReport, PrinterDefaults } from "../print/printability";
import type { ThinWallReport } from "../print/thinwalls";
import type { OrientSuggestion } from "../print/orient";
import { FASTENER_GROUPS, findFastener, insertBossHint, fastenerHole, fastenerLabel, fastenerFor, fastenerCalNote } from "../cad/fasteners";
import type { SurfacePattern } from "../engine/previewEngine";

/** Print-prep controls (Print tab + View menu): overhang heatmap, auto-orientation,
 *  wall-thickness check, elephant-foot chamfer. All local geometry — no AI calls. */
export interface PrintPrepCtl {
  overhangOn: boolean;
  toggleOverhang: () => void;
  thin: { report: ThinWallReport | null; busy: boolean; run: () => void; shown: boolean; toggleShown: () => void };
  orient: { suggestion: OrientSuggestion | null; run: () => void; apply: () => void; auto: () => void; face: (normal: [number, number, number]) => void };
  chamfer: { can: boolean; done: boolean; apply: (size: number) => void };
}
import type { Version } from "../store/types";
import { MAX_VERSIONS } from "../store/versions";
import type { EngineKind, ExportFormat, PointOp } from "../engine/types";
import { paramSoftRange, paramHardRange, isCountParam, humanizeParam, evalParamInput, groupParams, type CadParams } from "../cad/params";
import { fmtTok, fmtUSD } from "../llm/pricing";
import { HEAVY_TRIANGLES } from "../print/heavy";
import type { SlicerTarget } from "../lib/slicer";
import { IS_DESKTOP } from "../lib/desktopUpdate";
import { watchDesktopUpdate, checkForUpdate, restartApp, openDownload, type UpdateState } from "../lib/desktopUpdate";
import type { SplitPiece } from "../print/split";
import { pocketAdvice, type PocketFacing } from "../print/pockets";
import { TemplateStrip } from "./TemplatesModal";
import type { Template } from "../cad/templates";
import { IconPaperclip, IconArrowUp, IconUser, IconMoon, IconSun, IconX, IconCheck, IconReset, IconChevron, IconSparkle, IconGlobe, IconUndo, IconRedo, IconPointer, IconExport, IconScrew, IconBadge, IconTransform, IconRuler, IconMarker, IconWireframe, IconFrame, IconFaceSel, IconEdgeSel, IconPointSel, IconRotate, IconScale, IconModify, IconShapes, IconPrimBox, IconPrimCylinder, IconPrimBall, IconEdgeRound, IconEdgeAngle, IconPushPull, IconCube, IconCode, IconSliders, IconPrinter, IconHistory, IconHelp, IconMic, IconLayers, IconMagnet, IconFastener, IconTexturize, IconPaint, IconCut, IconChecklist } from "./icons";
import type * as THREE from "three";
import { MODELS } from "../llm/anthropic";
import { LLM_PRESETS, type LlmProviderId } from "../llm/llm";
import { localSupported } from "../llm/local";
import { shortModelName } from "../llm/openrouterModels";
import { fitClearance, fitCalibration, type FitId } from "../llm/prompts";
import { PROVIDERS, costLabel } from "../gen/registry";

// The Select tool's modes, in hotkey order (1–4). "point" is the old Pin.
// Each carries an icon so the label can collapse on narrow viewer columns (iPad).

// gen: true routes the chip to the free Generative engine instead of Precise CAD.
const SUGGESTIONS: { text: string; gen?: boolean }[] = [
  { text: "a 60×40 mm bracket, 4 mm thick, with two 4 mm holes" },
  { text: "a phone stand angled at 60 degrees" },
  { text: "a low-poly fox figurine", gen: true },
];

// 3MF leads: it carries real units, so slicers can never import at the wrong scale.
const EXPORT_FORMATS: { f: ExportFormat; label: string; desc: string }[] = [
  { f: "3mf", label: "3MF", desc: "Print mesh + real units — recommended" },
  { f: "stl", label: "STL", desc: "Universal print mesh" },
  { f: "step", label: "STEP", desc: "Editable solid · Shapr3D/Fusion" },
  { f: "obj", label: "OBJ", desc: "Mesh (reference)" },
];

/** A dropdown that can never be clipped or buried: portaled to <body>, fixed-position,
    anchored to its trigger, flipped above when there's no room below, clamped to the
    viewport, and closed by outside-click / Esc / scroll / resize. */
/** Only ONE popup open at a time, anywhere in the app. Each menu registers its own
    close function while it's open, and opening a new one closes the rest — otherwise
    two dropdowns sit on top of each other (the Set size panel over the snapping panel
    was the reported case). Menus that use AnchoredMenu get this for free; the couple
    that manage their own dropdown call the hook directly. */
/** Close a self-managed dropdown on an outside click or Escape (AnchoredMenu already
    does this for the portal-based menus). */
function useOutsideClose(ref: RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

const openMenus = new Set<() => void>();
function useSoloMenu(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const self = () => closeRef.current();
    for (const other of [...openMenus]) other(); // stand down, everyone else
    openMenus.add(self);
    return () => { openMenus.delete(self); };
  }, [open]);
}

function AnchoredMenu({ anchor, onClose, children, width = 190 }: { anchor: DOMRect; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useSoloMenu(true, onClose); // mounted == open
  const [h, setH] = useState(0);
  useLayoutEffect(() => setH(ref.current?.offsetHeight ?? 0), []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    // Defer, so the click that opened the menu doesn't instantly close it.
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
      document.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onClose);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const vw = window.innerWidth;
  const left = Math.max(8, Math.min(anchor.right - width, vw - width - 8));
  const openUp = anchor.bottom + h + 8 > window.innerHeight && anchor.top - h - 8 > 0;
  const top = openUp ? anchor.top - h - 4 : anchor.bottom + 4;
  return createPortal(
    <div ref={ref} className="pmenu" role="menu" style={{ left, top, width, visibility: h ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

/** "Circle it and ask": a freehand marker over the 3D view. Draw around a region;
    on release the current camera view + your stroke become ONE annotated screenshot
    handed to the chat composer, so the AI knows exactly where the change goes. */
export type MarkRegion = NonNullable<ReturnType<ViewerHandle["probeRegion"]>>;

function MarkOverlay({ viewerRef, onDone, onCancel }: {
  viewerRef: RefObject<ViewerHandle>;
  onDone: (blob: Blob, view: { azimuthDeg: number; elevationDeg: number } | null, region: MarkRegion | null) => void;
  onCancel: () => void;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const pts = useRef<{ x: number; y: number }[]>([]);
  const drawing = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const fit = () => {
    const cv = cvRef.current!;
    const r = cv.getBoundingClientRect();
    if (cv.width !== Math.round(r.width) || cv.height !== Math.round(r.height)) {
      cv.width = Math.round(r.width);
      cv.height = Math.round(r.height);
    }
  };
  const stroke = (c: CanvasRenderingContext2D, scale: number) => {
    const P = pts.current;
    if (P.length < 2) return;
    c.strokeStyle = "#ff3b30";
    c.lineWidth = Math.max(3, 3.5 * scale);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(P[0].x * scale, P[0].y * scale);
    for (let i = 1; i < P.length; i++) c.lineTo(P[i].x * scale, P[i].y * scale);
    c.stroke();
  };
  const redraw = () => {
    const cv = cvRef.current!;
    const c = cv.getContext("2d")!;
    c.clearRect(0, 0, cv.width, cv.height);
    stroke(c, 1);
  };
  const at = (e: React.PointerEvent) => {
    const r = cvRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  async function finish() {
    const P = pts.current;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const q of P) { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }
    if (P.length < 6 || (maxX - minX < 14 && maxY - minY < 14)) { pts.current = []; redraw(); return; } // accidental click — keep drawing
    const shot = viewerRef.current?.captureView();
    const view = viewerRef.current?.viewInfo() ?? null;
    if (!shot) { onCancel(); return; }
    // What did the circle actually land on? Sample a grid inside the stroke and raycast
    // it into the scene — the resulting 3D extent rides along so the AI gets hard
    // coordinates, not just pixels. (Even-odd point-in-polygon on the stroke path.)
    const inPoly = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if (P[i].y > y !== P[j].y > y && x < ((P[j].x - P[i].x) * (y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) c = !c;
      }
      return c;
    };
    const rect = cvRef.current!.getBoundingClientRect();
    const samples: { x: number; y: number }[] = [];
    const N = 14;
    for (let gy = 0; gy <= N; gy++) {
      for (let gx = 0; gx <= N; gx++) {
        const x = minX + ((maxX - minX) * gx) / N;
        const y = minY + ((maxY - minY) * gy) / N;
        if (inPoly(x, y)) samples.push({ x: rect.left + x, y: rect.top + y });
      }
    }
    const region = samples.length ? viewerRef.current?.probeRegion(samples) ?? null : null;
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = shot; });
    const out = document.createElement("canvas");
    out.width = img.width;
    out.height = img.height;
    const c = out.getContext("2d")!;
    c.drawImage(img, 0, 0);
    stroke(c, img.width / cvRef.current!.width);
    out.toBlob((b) => {
      if (b) onDone(b, view, region);
      else out.toBlob((b2) => (b2 ? onDone(b2, view, region) : onCancel()), "image/png");
    }, "image/webp", 0.85);
  }
  return (
    <div className="mark-overlay">
      <canvas
        ref={cvRef}
        onPointerDown={(e) => { fit(); drawing.current = true; pts.current = [at(e)]; (e.target as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; pts.current.push(at(e)); redraw(); }}
        onPointerUp={() => { if (!drawing.current) return; drawing.current = false; void finish(); }}
      />
      <div className="mark-hint">
        Draw around the part you want to change — it attaches to the chat as a marked screenshot
        <button className="ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** An object/plate label you can rename in place: double-click (or an external trigger)
    swaps in an input; Enter/blur commits, Esc cancels. */
function EditableName({ name, className, editing, onStartEdit, onRename, onDone }: {
  name: string;
  className?: string;
  editing: boolean;
  onStartEdit: () => void;
  onRename: (v: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(name); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!editing) {
    return (
      <span className={className} title={`${name} — double-click to rename`} onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}>
        {name}
      </span>
    );
  }
  const commit = () => { const v = draft.trim(); if (v && v !== name) onRename(v); onDone(); };
  return (
    <input
      ref={inputRef}
      className="name-edit"
      value={draft}
      maxLength={40}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") onDone();
      }}
      aria-label="Rename"
    />
  );
}

/** Research · Plan · Fit behind one button. All three are "how the NEXT build runs",
 *  all three are set once and left alone, and as loose chips they cost a permanent
 *  second row above the composer. The trigger names whatever is off its default, so
 *  folding them away never hides a setting that is currently doing something. */
function BuildOptions({ p }: { p: Props }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const precise = p.mode === "precise";
  const notes: string[] = [];
  if (p.modePref !== "generative" && p.webMode !== "auto") notes.push(p.webMode === "on" ? "Research On" : "No Research");
  if (!p.planCtl.on) notes.push("No Plan");
  if (precise && p.fit !== "snug") notes.push(`Fit · ${p.fit === "loose" ? "Loose" : "Press"}`);
  return (
    <span>
      <button ref={btn} type="button" className={`web-toggle opt-trigger${notes.length ? " on" : ""}`}
        aria-haspopup="menu" aria-expanded={!!anchor}
        title="How the next build runs — web research, plan-first, and how tightly parts fit together"
        onClick={() => setAnchor(anchor ? null : btn.current!.getBoundingClientRect())}>
        <IconSliders size={13} />
        <span className="web-state">{notes.length ? notes.join(" · ") : "Build options"}</span>
      </button>
      {anchor && (
        <AnchoredMenu anchor={anchor} onClose={() => setAnchor(null)} width={252}>
          {p.modePref !== "generative" && (
            <button role="menuitem" className="pmenu-item" onClick={p.onCycleWeb}>
              <b>Research · {p.webMode}</b>
              <span>{p.webMode === "auto" ? "Looks up named real-world products before building" : p.webMode === "on" ? "Always searches for real dimensions first" : "Never searches — builds from your words alone"}</span>
            </button>
          )}
          {/* Plan first is on by default: a first model that is already right beats
              four rounds of correcting one. "Just build it" stays one tap away. */}
          <button role="menuitem" className="pmenu-item" onClick={() => p.planCtl.setOn(!p.planCtl.on)}>
            <b>{p.planCtl.on ? "Plan first" : "Build straight away"}</b>
            <span>{p.planCtl.on ? "You get a short spec to check and correct before anything is generated" : "Skips the spec. One cheap call saved, a rebuild often spent"}</span>
          </button>
          {precise && (
            <>
              <div className="pmenu-sep" />
              <div className="pmenu-item pmenu-choice" role="none">
                <b>Part fit</b>
                <span>{FIT_OPTS.find((o) => o.id === p.fit)?.plain}{fitCalibration() != null ? " · measured on your printer" : ""}</span>
                <div className="pmenu-opts" role="radiogroup" aria-label="Part fit">
                  {FIT_OPTS.map((o) => (
                    <button key={o.id} role="radio" aria-checked={p.fit === o.id} className={`pm-opt${p.fit === o.id ? " on" : ""}`}
                      title={`${o.plain} — ${fitClearance(o.id)} mm gap. ${FIT_WHAT}`} onClick={() => p.onFit(o.id)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </AnchoredMenu>
      )}
    </span>
  );
}

/** One home for every display toggle — Dimensions, Wireframe, Stats, Units, Showcase —
    so the toolbar carries tools, not switches. */
function ViewMenu({ dimsMode, setDimsMode, wireframe, setWireframe, gray, setGray, plate, setPlate, stats, setStats, units, setUnits, showcase, setShowcase, overhangOn, toggleOverhang, onResetView }: {
  dimsMode: "select" | "always" | "off"; setDimsMode: (m: "select" | "always" | "off") => void;
  wireframe: boolean; setWireframe: (f: (w: boolean) => boolean) => void;
  gray: boolean; setGray: (v: boolean) => void;
  plate: boolean; setPlate: (v: boolean) => void;
  stats: boolean; setStats: (v: boolean) => void;
  units: "mm" | "in"; setUnits: (f: (u: "mm" | "in") => "mm" | "in") => void;
  showcase: boolean; setShowcase: (v: boolean) => void;
  overhangOn: boolean; toggleOverhang: () => void;
  onResetView: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = () => setAnchor(null);
  const Row = ({ on, label, hint, onClick }: { on: boolean; label: string; hint?: string; onClick: () => void }) => (
    <button role="menuitemcheckbox" aria-checked={on} className={`pmenu-item check${on ? " on" : ""}`} onClick={onClick}>
      <b>{on ? "✓ " : ""}{label}</b>
      {hint && <span>{hint}</span>}
    </button>
  );
  return (
    <span>
      <button ref={btn} className="ghost sm iconbtn" aria-haspopup="menu" aria-expanded={!!anchor} title="View options — dimensions, wireframe, stats, units, showcase"
        onClick={() => setAnchor(anchor ? null : btn.current!.getBoundingClientRect())}>
        <IconWireframe /><span className="btn-label">View</span>
      </button>
      {anchor && (
        <AnchoredMenu anchor={anchor} onClose={close} width={230}>
          <div className="pmenu-item pmenu-choice" role="none">
            <b>Dimensions</b>
            <span>Size lines + bounding box</span>
            <div className="pmenu-opts" role="radiogroup" aria-label="When to show dimensions">
              {([["select", "On select"], ["always", "Always"], ["off", "Off"]] as const).map(([m, l]) => (
                <button key={m} role="radio" aria-checked={dimsMode === m} className={`pm-opt${dimsMode === m ? " on" : ""}`} onClick={() => setDimsMode(m)}>{l}</button>
              ))}
            </div>
          </div>
          <Row on={wireframe} label="Wireframe" hint="See the mesh triangles" onClick={() => setWireframe((w) => !w)} />
          <Row on={gray} label="Grayscale" hint="Hide baked colors — see the print, not the paint" onClick={() => setGray(!gray)} />
          <Row on={plate} label="Build plate" hint="Solid plate under the model, sized to your printer" onClick={() => setPlate(!plate)} />
          <Row on={overhangOn} label="Overhang heatmap" hint="Paint faces that will need support" onClick={toggleOverhang} />
          <Row on={stats} label="Stats" hint="Triangles, volume, watertight" onClick={() => setStats(!stats)} />
          <Row on={showcase} label="Showcase" hint="Slow turntable on a studio stage" onClick={() => setShowcase(!showcase)} />
          <div className="pmenu-sep" />
          <button role="menuitem" className="pmenu-item" onClick={() => setUnits((u) => (u === "mm" ? "in" : "mm"))}>
            <b>Units: {units === "mm" ? "millimetres" : "inches"}</b>
            <span>Tap to switch to {units === "mm" ? "inches" : "millimetres"}</span>
          </button>
          <div className="pmenu-sep" />
          <button role="menuitem" className="pmenu-item" onClick={() => { close(); onResetView(); }}>
            <b>Reset view</b>
            <span>Re-frame the model in the viewport</span>
          </button>
        </AnchoredMenu>
      )}
    </span>
  );
}

// A Bambu-Basic-flavoured filament palette for quick per-part painting (+ a custom picker).
// Also the per-face Paint tool's filament list — triColor indexes exported.
export const FILAMENT_SWATCHES = [
  "#E02D2D", "#F5820F", "#F5C400", "#25B34B", "#1C8FE0", "#3B4CC0",
  "#8E44AD", "#E85AAE", "#8B5A2B", "#111418", "#9AA0A6", "#F5F5F5",
];

/** Per-part fill-colour picker in the Objects panel — Bambu-Studio-style. A painted part
    renders tinted in the viewer and exports as its own filament slot, so the slicer opens
    with each part pre-assigned to the matching colour. */
function ColorSwatch({ color, fallback, onPick, label }: { color?: string; fallback?: string; onPick: (hex: string | null) => void; label: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = () => setAnchor(null);
  const shown = color ?? fallback ?? "#7fc4b9";
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        ref={btn}
        className={`lp-swatch${color ? " painted" : ""}`}
        title={color ? `${label}: ${color} — click to change or clear` : `${label}: pick a fill colour (prints as its own filament)`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={() => setAnchor(anchor ? null : btn.current!.getBoundingClientRect())}
      >
        <span className="lp-swatch-dot" style={{ background: shown }} />
      </button>
      {anchor && (
        <AnchoredMenu anchor={anchor} onClose={close} width={188}>
          <div className="swatch-head" role="none">Fill colour</div>
          <div className="swatch-grid" role="none">
            {FILAMENT_SWATCHES.map((c) => (
              <button
                key={c}
                className={`sw${color?.toLowerCase() === c.toLowerCase() ? " on" : ""}`}
                style={{ background: c }}
                title={c}
                aria-label={`Paint ${c}`}
                onClick={() => { onPick(c); close(); }}
              />
            ))}
          </div>
          <label className="swatch-custom">
            <span>Custom</span>
            <input type="color" value={color ?? "#7fc4b9"} onChange={(e) => onPick(e.target.value.toUpperCase())} aria-label="Custom fill colour" />
          </label>
          {color && (
            <button role="menuitem" className="pmenu-item swatch-clear" onClick={() => { onPick(null); close(); }}>
              Clear — use the default filament
            </button>
          )}
        </AnchoredMenu>
      )}
    </span>
  );
}

/** Pick which build plate an object prints on — a menu, not a blind cycle. */
function PlateMenu({ value, count, names, onPick, onNewPlate }: { value: number; count: number; names?: Record<number, string>; onPick: (n: number) => void; onNewPlate: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = () => setAnchor(null);
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button ref={btn} className="lp-plate" title={`Prints on plate ${value}${names?.[value] ? ` (${names[value]})` : ""} — click to choose`} aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={() => setAnchor(anchor ? null : btn.current!.getBoundingClientRect())}>
        P{value} ▾
      </button>
      {anchor && (
        <AnchoredMenu anchor={anchor} onClose={close} width={170}>
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <button key={n} role="menuitem" className={`pmenu-item${n === value ? " on" : ""}`} onClick={() => { close(); onPick(n); }}>
              Plate {n}{names?.[n] ? ` · ${names[n]}` : ""}{n === value ? " ✓" : ""}
            </button>
          ))}
          <div className="pmenu-sep" />
          <button role="menuitem" className="pmenu-item" onClick={() => { close(); onNewPlate(); }}>+ New plate</button>
        </AnchoredMenu>
      )}
    </span>
  );
}
/** Bambu-style plate tabs over the 3D view: see what prints where, focus one plate,
    add/remove/rename plates (double-click a tab), and export the layout. */
function PlateBar({ count, names, active, setActive, counts, onAdd, onRemove, onRename, exportEach, exportProject }: {
  count: number;
  names: Record<number, string>;
  active: number;
  setActive: (n: number) => void;
  counts: Map<number, number>;
  onAdd: () => void;
  onRemove: (n: number) => void;
  onRename: (n: number, name: string) => void;
  exportEach: () => void;
  exportProject: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing !== null) setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0); }, [editing]);
  const commit = () => { if (editing !== null) onRename(editing, draft); setEditing(null); };
  return (
    <div className="plate-bar" role="group" aria-label="Build plates">
      <span className="pb-label">Plates</span>
      <div className="pb-tabs">
        <button className={`pb-tab${active === 0 ? " on" : ""}`} title="Show every plate" onClick={() => setActive(0)}>All</button>
        {Array.from({ length: count }, (_, i) => i + 1).map((n) =>
          editing === n ? (
            <input
              key={n}
              ref={inputRef}
              className="pb-edit"
              value={draft}
              placeholder={`Plate ${n}`}
              maxLength={24}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(null); }}
              aria-label={`Rename plate ${n}`}
            />
          ) : (
            <button
              key={n}
              className={`pb-tab${active === n ? " on" : ""}`}
              title={`Show only plate ${n}${names[n] ? ` (${names[n]})` : ""} — ${counts.get(n) ?? 0} object${(counts.get(n) ?? 0) === 1 ? "" : "s"} · double-click to rename`}
              onClick={() => setActive(n)}
              onDoubleClick={() => { setDraft(names[n] ?? ""); setEditing(n); }}
            >
              {n}
              {names[n] && <span className="pb-name">{names[n]}</span>}
              <span className={`pb-count${counts.get(n) ? "" : " zero"}`}>{counts.get(n) ?? 0}</span>
              {active === n && count > 1 && (
                <span
                  className="pb-x"
                  role="button"
                  aria-label={`Remove plate ${n}`}
                  title="Remove this plate — its objects join the previous plate"
                  onClick={(e) => { e.stopPropagation(); onRemove(n); }}
                >
                  <IconX size={9} />
                </span>
              )}
            </button>
          ),
        )}
      </div>
      <button className="pb-add" title="Add a build plate" onClick={onAdd}>+</button>
    </div>
  );
}

/** The project name beside the logo — click to rename; Enter/blur saves, Esc cancels. */
function ProjectTitle({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== name) onRename(v);
  };
  if (editing) {
    return (
      <input
        ref={inputRef}
        className="project-edit"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        maxLength={80}
        aria-label="Project name"
      />
    );
  }
  return (
    <button className="project" onClick={() => setEditing(true)} title="Rename project">
      <span className="project-name">{name}</span>
      <svg className="project-pen" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

/** Extra reference angles for multi-view mesh generation (front is the main photo). */
function MultiViewRow({ views, onPick, onClear, multiViewEngine, mode }: {
  views: Partial<Record<"left" | "back" | "right", string>>;
  onPick: (slot: "left" | "back" | "right", f: File) => void;
  onClear: (slot: "left" | "back" | "right") => void;
  multiViewEngine: boolean;
  mode: Mode;
}) {
  const slots: ("left" | "back" | "right")[] = ["left", "back", "right"];
  const label = { left: "Left", back: "Back", right: "Right" } as const;
  return (
    <div className="mv">
      <div className="mv-slots">
        <div className="mv-slot mv-front" title="Front — the reference photo above"><span className="mv-tag">Front</span></div>
        {slots.map((s) =>
          views[s] ? (
            <div className="mv-slot filled" key={s}>
              <img src={views[s]} alt={label[s]} />
              <span className="mv-tag">{label[s]}</span>
              <button type="button" className="mv-x" aria-label={`Remove ${label[s]} view`} onClick={() => onClear(s)}><IconX /></button>
            </div>
          ) : (
            <label className="mv-slot add" key={s} title={`Add a ${label[s].toLowerCase()} photo`}>
              <span className="mv-plus">+</span>
              <span className="mv-tag">{label[s]}</span>
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(s, f); e.currentTarget.value = ""; }} />
            </label>
          ),
        )}
      </div>
      <p className="mv-hint">
        {mode === "precise"
          ? "More angles → truer proportions. Every photo you add is read, and the far side stops being guesswork."
          : multiViewEngine
            ? "More angles → a more accurate mesh. This engine uses them."
            : <>More angles improve accuracy — but this engine uses only the front. Switch to <b>fal · Rodin</b> or <b>Tripo</b> to use them.</>}
      </p>
    </div>
  );
}

/** Glanceable mesh + print stats on the model (Meshy's Faces/Vertices, reframed
    for slicing: triangles, watertight, volume, bed fit). */
/** Dictation into the chat box via the Web Speech API. Renders nothing where the
 *  API doesn't exist; recognition text (finals + live interim) replaces everything
 *  typed after the point dictation started. */
function MicButton({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const SRClass = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const base = useRef(""); // text already in the box when dictation started
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => () => { try { rec.current?.abort?.(); } catch { /* already stopped */ } }, []);
  if (!SRClass) return null;
  const start = () => {
    const r = new SRClass();
    rec.current = r;
    base.current = valueRef.current ? valueRef.current.replace(/\s+$/, "") + " " : "";
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onChange((base.current + text).replace(/ {2,}/g, " "));
    };
    r.onend = () => { setListening(false); rec.current = null; };
    r.onerror = () => setListening(false);
    try { r.start(); setListening(true); } catch { setListening(false); }
  };
  return (
    <button
      type="button"
      className={`mic${listening ? " on" : ""}`}
      aria-label={listening ? "Stop dictation" : "Dictate"}
      aria-pressed={listening}
      title={listening ? "Stop dictation" : "Dictate your request instead of typing"}
      onClick={() => (listening ? rec.current?.stop?.() : start())}
    >
      <IconMic />
    </button>
  );
}

/** Display material: filament colour + finish. Visual only — prints don't change. */
/** How many spools this print needs as painted: the base filament plus every slot
 *  used on a face. The answer a slicer only gives you three screens later. */
function FilamentCount({ facePaint }: { facePaint: Uint8Array | null }) {
  const n = useMemo(() => {
    if (!facePaint) return 1;
    const used = new Set<number>();
    for (const v of facePaint) if (v) used.add(v);
    return used.size + 1; // + the base colour
  }, [facePaint]);
  return <div className="paint-count">Prints with <b>{n}</b> filament{n === 1 ? "" : "s"}</div>;
}

function MaterialMenu({ appearance, setAppearance }: { appearance: { color: string; finish: "matte" | "satin" | "glossy" | "metal" }; setAppearance: (a: { color: string; finish: "matte" | "satin" | "glossy" | "metal" }) => void }) {
  const [open, setOpen] = useState(false);
  const COLORS = ["#c7ccd3", "#f4f4f2", "#2b2b2e", "#d94040", "#f28c28", "#ecc94b", "#48a860", "#3b82f6", "#8b5cf6", "#14b8a6"];
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button className="ghost sm iconbtn has-modes" aria-label="Material" aria-expanded={open} title="Display material — filament colour & finish (visual only)" onClick={() => setOpen((v) => !v)}>
        {/* A shaded sphere in the chosen colour — the 3D-app convention for "material",
            where the flat dot read as an empty circle on pale filaments. */}
        <svg className="mat-ball" width="17" height="17" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8.8" fill={appearance.color} stroke="rgba(0,0,0,.35)" strokeWidth="1.4" />
          <path d="M19.6 15.1a8.8 8.8 0 0 1-12.4 4.4A8.8 8.8 0 0 0 19.6 15Z" fill="rgba(0,0,0,.18)" stroke="none" />
          <ellipse cx="8.8" cy="8.2" rx="2.6" ry="1.9" fill="rgba(255,255,255,.75)" stroke="none" transform="rotate(-32 8.8 8.2)" />
        </svg>
      <span className="rail-name">Material</span></button>
      {open && (
        <div className="snap-menu" role="menu">
          <div className="mat-swatches">
            {COLORS.map((c) => (
              <button key={c} className={`mat-swatch${appearance.color === c ? " on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => setAppearance({ ...appearance, color: c })} />
            ))}
          </div>
          <div className="snap-row"><span>Finish</span>
            <div className="seg sm">
              {(["matte", "satin", "glossy", "metal"] as const).map((f) => (
                <button key={f} className={appearance.finish === f ? "on" : ""} onClick={() => setAppearance({ ...appearance, finish: f })}>{f[0].toUpperCase() + f.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="ins-note">Visualization only — STL carries no colour; 3MF keeps it for multi-colour printers.</div>
        </div>
      )}
    </div>
  );
}

/** Physical surface texture: knurl / honeycomb / noise / wave / voronoi / diamond /
 *  fuzzy skin as REAL printable geometry. */
function SurfaceMenu({ disabled, isCad, onApply }: { disabled: boolean; isCad: boolean; onApply: (pattern: SurfacePattern, scale: number, depth: number) => void }) {
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState<SurfacePattern>("knurl");
  const [scale, setScale] = useState(3);
  const [depth, setDepth] = useState(0.4);
  const [raised, setRaised] = useState(true);
  const LABELS: Record<SurfacePattern, string> = { knurl: "Knurl", honeycomb: "Hex", noise: "Noise", wave: "Wave", voronoi: "Voronoi", diamond: "Diamond", fuzzy: "Fuzzy" };
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button className="ghost sm iconbtn has-modes" aria-label="Surface texture" aria-expanded={open} title="Surface texture — knurl, hex, noise, wave, voronoi, diamond or fuzzy skin as real printable geometry" onClick={() => setOpen((v) => !v)}>
        <IconTexturize />
      <span className="rail-name">Texture</span></button>
      {open && (
        <div className="snap-menu" role="menu">
          <div className="snap-row"><span>Pattern</span>
            <div className="seg sm" style={{ flexWrap: "wrap" }}>
              {(Object.keys(LABELS) as SurfacePattern[]).map((pp) => (
                <button key={pp} className={pattern === pp ? "on" : ""} onClick={() => setPattern(pp)}>{LABELS[pp]}</button>
              ))}
            </div>
          </div>
          <div className="snap-row"><span>Cell size</span>
            <div className="seg sm">{[2, 3, 5, 8].map((v) => <button key={v} className={scale === v ? "on" : ""} onClick={() => setScale(v)}>{v}mm</button>)}</div>
          </div>
          <div className="snap-row"><span>Depth</span>
            <div className="seg sm">{[0.2, 0.4, 0.8, 1.5].map((v) => <button key={v} className={depth === v ? "on" : ""} onClick={() => setDepth(v)}>{v}</button>)}</div>
          </div>
          <div className="snap-row"><span>Direction</span>
            <div className="seg sm">
              <button className={raised ? "on" : ""} onClick={() => setRaised(true)}>Raised</button>
              <button className={!raised ? "on" : ""} onClick={() => setRaised(false)}>Engraved</button>
            </div>
          </div>
          <button className="primary sm" style={{ width: "100%", marginTop: 8 }} disabled={disabled} onClick={() => { setOpen(false); onApply(pattern, scale, raised ? depth : -depth); }}>
            Apply to model
          </button>
          <div className="ins-note">{isCad ? "Real geometry — the model becomes a mesh (CAD version stays in History)." : "Real geometry, applied to the mesh."}</div>
        </div>
      )}
    </div>
  );
}

/** Gizmo snapping options: grid steps for Move, angle steps for Rotate. */
function SnapMenu({ snap, setSnap }: { snap: { move: number; rotate: number }; setSnap: (s: { move: number; rotate: number }) => void }) {
  const [open, setOpen] = useState(false);
  const active = snap.move > 0 || snap.rotate > 0;
  const box = useRef<HTMLDivElement>(null);
  useSoloMenu(open, () => setOpen(false));
  useOutsideClose(box, open, () => setOpen(false));
  return (
    <div ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button className={`ghost sm iconbtn snap-btn has-modes${active ? " on" : ""}`} aria-label="Snapping" aria-expanded={open} title="Snapping — grid steps for Move, angle steps for Rotate" onClick={() => setOpen((v) => !v)}>
        <IconMagnet />
        <span className="snap-name">Snap</span>
      </button>
      {open && (
        <div className="snap-menu" role="menu">
          <div className="snap-row"><span>Move</span>
            <div className="seg sm">
              {[0, 0.5, 1, 5].map((v) => (
                <button key={v} className={snap.move === v ? "on" : ""} onClick={() => setSnap({ ...snap, move: v })}>{v === 0 ? "Free" : `${v}mm`}</button>
              ))}
            </div>
          </div>
          <div className="snap-row"><span>Rotate</span>
            <div className="seg sm">
              {[0, 5, 15, 45].map((v) => (
                <button key={v} className={snap.rotate === v ? "on" : ""} onClick={() => setSnap({ ...snap, rotate: v })}>{v === 0 ? "Free" : `${v}°`}</button>
              ))}
            </div>
          </div>
          <div className="ins-note">Scale snaps to 5%. Snap-to-object is on the roadmap.</div>
        </div>
      )}
    </div>
  );
}

/** Typed resize, Bambu-style: exact W/D/H in mm (linked by default) or a uniform %,
 *  plus one-tap "Scale to fit bed". Mesh models may stretch per-axis; CAD scales uniformly. */
function ResizeMenu({ ctl }: { ctl: Props["resizeCtl"] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useSoloMenu(open, () => setOpen(false));
  useOutsideClose(box, open, () => setOpen(false));
  const [vals, setVals] = useState({ x: "", y: "", z: "", pct: "100" });
  const [uniform, setUniform] = useState(true);
  const d = ctl.dims;
  const linked = uniform || !ctl.perAxis; // CAD is always uniform
  const r1s = (n: number) => String(Math.round(n * 10) / 10);
  const seed = () => d && setVals({ x: r1s(d.x), y: r1s(d.y), z: r1s(d.z), pct: "100" });
  const setAxis = (axis: "x" | "y" | "z", v: string) => {
    const n = parseFloat(v);
    if (linked && d && Number.isFinite(n) && n > 0 && d[axis] > 0) {
      const f = n / d[axis];
      setVals({
        x: axis === "x" ? v : r1s(d.x * f),
        y: axis === "y" ? v : r1s(d.y * f),
        z: axis === "z" ? v : r1s(d.z * f),
        pct: String(Math.round(f * 1000) / 10),
      });
    } else setVals((s) => ({ ...s, [axis]: v }));
  };
  const setPct = (v: string) => {
    const n = parseFloat(v);
    if (d && Number.isFinite(n) && n > 0) setVals({ x: r1s((d.x * n) / 100), y: r1s((d.y * n) / 100), z: r1s((d.z * n) / 100), pct: v });
    else setVals((s) => ({ ...s, pct: v }));
  };
  const apply = () => {
    if (!d) return;
    const sx = parseFloat(vals.x) / d.x;
    const sy = parseFloat(vals.y) / d.y;
    const sz = parseFloat(vals.z) / d.z;
    if (![sx, sy, sz].every((v) => Number.isFinite(v) && v > 0)) return;
    ctl.resize(linked ? [sx, sx, sx] : [sx, sy, sz]);
    setOpen(false);
  };
  const num = (axis: "x" | "y" | "z", label: string) => (
    <label className="rz-field">
      {label}
      <input type="number" min={0.1} step={0.1} value={vals[axis]} onChange={(e) => setAxis(axis, e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
    </label>
  );
  return (
    <div ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button
        className={`ghost sm iconbtn${open ? " on" : ""}`}
        aria-label="Set size"
        aria-expanded={open}
        disabled={!d || ctl.busy}
        title="Set size — type the exact size in mm (or a %) instead of dragging the Scale gizmo; includes one-tap Scale to fit bed"
        onClick={() => { if (!open) seed(); setOpen((v) => !v); }}
      >
        <IconScale /><span className="btn-label">Set size…</span>
      </button>
      {open && d && (
        <div className="snap-menu resize-menu" role="menu">
          <div className="snap-row rz-dims">
            {num("x", "W")}
            {num("y", "D")}
            {num("z", "H")}
            <span className="rz-unit">mm</span>
          </div>
          <div className="snap-row">
            <label className="rz-field">%<input type="number" min={1} step={1} value={vals.pct} onChange={(e) => setPct(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></label>
            {ctl.perAxis ? (
              <label className="rz-uniform"><input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} /> uniform</label>
            ) : (
              <span className="rz-uniform" title="CAD parts scale uniformly — ask in chat or edit Params for exact per-axis dimensions">uniform (CAD)</span>
            )}
          </div>
          <div className="snap-row rz-actions">
            <button className="ghost sm" disabled={ctl.fits || ctl.busy} title={ctl.fits ? "Already fits the build volume" : `Shrink to fit your ${ctl.bed.x} × ${ctl.bed.y} × ${ctl.bed.z} mm build volume`} onClick={() => { ctl.fitToPlate(); setOpen(false); }}>
              Scale to fit bed
            </button>
            <button className="primary sm" disabled={ctl.busy} onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Docked selection inspector — the selected part's numbers, editable. replicad scale is
 *  uniform-only, so editing any one dimension rescales the whole part to match it. */
function SelectionInspector({ dims, units, busy, canScale, onScale, onDeselect, onAdjust }: {
  dims: { x: number; y: number; z: number }; units: "mm" | "in"; busy: boolean; canScale: boolean;
  onScale: (axis: "x" | "y" | "z", target: number) => void; onDeselect: () => void;
  /** Straight to the Adjust panel — the thing people click a model to reach. */
  onAdjust: () => void;
}) {
  const [draft, setDraft] = useState<{ axis: "x" | "y" | "z"; v: string } | null>(null);
  const show = (n: number) => (units === "in" ? (n / 25.4).toFixed(2) : String(Math.round(n * 10) / 10));
  const commit = () => {
    if (!draft) return;
    let v = Number(draft.v);
    if (units === "in") v *= 25.4;
    if (Number.isFinite(v) && v > 0.1 && Math.abs(v - dims[draft.axis]) > 1e-3) onScale(draft.axis, v);
    setDraft(null);
  };
  const rows: { axis: "x" | "y" | "z"; label: string }[] = [
    { axis: "x", label: "W" }, { axis: "y", label: "D" }, { axis: "z", label: "H" },
  ];
  return (
    <div className="inspector" role="region" aria-label="Selection">
      <div className="lp-head"><b>Selection</b><button className="x" aria-label="Deselect" onClick={onDeselect}><IconX /></button></div>
      {rows.map((r) => (
        <label key={r.axis} className="ins-row">
          <span className="ins-lab">{r.label}</span>
          <input
            inputMode="decimal"
            disabled={!canScale || busy}
            value={draft?.axis === r.axis ? draft.v : show(dims[r.axis])}
            onFocus={(e) => { setDraft({ axis: r.axis, v: show(dims[r.axis]) }); e.currentTarget.select(); }}
            onChange={(e) => setDraft({ axis: r.axis, v: e.target.value })}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }}
          />
          <span className="ins-unit">{units}</span>
        </label>
      ))}
      <div className="ins-note">{canScale ? "Edit any size — the whole part rescales to match (uniform)." : "Resizing needs the CAD engine."}</div>
      {/* Clicking a part and then hunting through the Inspector list for "Adjust" was
          two steps too many — it is the reason most people click a part at all. */}
      <button className="ghost sm block ins-adjust" onClick={onAdjust}>Adjust size &amp; shape</button>
    </div>
  );
}

/** One saved measurement — and the place you retype it. Reading "37.4 mm" and wanting
 *  40 is the whole gesture Shapr3D users reach for; the value is an input, and what
 *  will actually move to get there is named before you commit, because "set this to 40"
 *  is ambiguous until you know whether it drives a parameter or rescales the part. */
function MeasureRow({ m, index, ctl, dimCtl, busy }: {
  m: Measurement; index: number; ctl: Props["measureCtl"]; dimCtl: Props["dimCtl"]; busy: boolean;
}) {
  const span: [number, number, number] = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]];
  const measured = Math.round(Math.hypot(span[0], span[1], span[2]) * 10) / 10;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(measured));
  const drivers = useMemo(() => (editing ? dimCtl.drivers(measured, span) : []), [editing, measured, dimCtl, span[0], span[1], span[2]]);
  const [pick, setPick] = useState(0);
  const target = Number(text);
  const valid = Number.isFinite(target) && target > 0.01 && Math.abs(target - measured) > 1e-3;
  if (!editing) {
    return (
      <div className="lp-row static">
        <IconRuler /><span className="lp-name">Measure {index + 1}</span>
        <button className="lp-sub meas-val" title="Type an exact size for this distance" onClick={() => { setText(String(measured)); setPick(0); setEditing(true); }}>
          {measured} mm
        </button>
        <button className="x" aria-label="Delete measurement" onClick={() => ctl.remove(m.id)}><IconX /></button>
      </div>
    );
  }
  return (
    <div className="lp-row static meas-edit">
      <div className="meas-edit-top">
        <IconRuler />
        <span className="lp-name">Measure {index + 1}</span>
        <input
          className="meas-input"
          value={text}
          autoFocus
          inputMode="decimal"
          aria-label={`Target size for measurement ${index + 1}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && drivers[pick]) { dimCtl.apply(drivers[pick], measured, target); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <span className="fine">mm</span>
      </div>
      {drivers.length === 0 ? (
        <p className="fine">Nothing here can drive that distance — no parameter matches it. Adjust the part in the Adjust panel, or ask in chat.</p>
      ) : (
        <>
          <div className="meas-drivers" role="radiogroup" aria-label="What to change">
            {drivers.map((d, i) => (
              <button key={i} role="radio" aria-checked={pick === i} className={`chip sm${pick === i ? " on" : ""}`} onClick={() => setPick(i)}>
                {d.label}
              </button>
            ))}
          </div>
          <p className="fine">{measured} → {valid ? target : "…"} mm by changing <b>{drivers[pick]?.label}</b>. Free — no AI.</p>
        </>
      )}
      <div className="meas-actions">
        <button className="primary sm" disabled={!valid || busy || !drivers[pick]} onClick={() => { dimCtl.apply(drivers[pick], measured, target); setEditing(false); }}>Set</button>
        <button className="ghost sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Tools-and-gestures cheat sheet — the toolbar's hover tooltips don't exist on touch
 *  devices, so the ? button opens this instead. Short, icon-anchored, closable. */
/* The Inspector dock. One panel at a time, docked beside a stage that stays live —
   replacing the old tab strip's habit of hiding the canvas to show a full-width panel.
   The canvas tab strip and this list are two views of the SAME state (CANVAS_TABS keys
   are DockPanel values), so "3D View" reads as active exactly when no deep section is. */
/* The contextual toolbar. Anchored AT the selection instead of parked in the canvas
   corner underneath the tool rail — pointer travel is ~0, and the rail can no longer
   draw over the panel it just opened (rail z-index 30 vs .pin-panel 6, same corner).
   Position is written straight to the node from a rAF loop so orbiting the model does
   not re-render React; the loop only runs while something is actually selected. */
function ContextBar({ anchor, away, viewerRef, children }: {
  anchor: [number, number, number] | null;
  /** A point further along the drag arrow. The bar is pushed the OPPOSITE way on
   *  screen, so it can never sit on top of the handle you're about to grab. */
  away?: [number, number, number] | null;
  viewerRef: React.RefObject<ViewerHandle | null>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    let raf = 0;
    let lx = -1, ly = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      if (!el) return;
      const pt = viewerRef.current?.projectPoint(anchor[0], anchor[1], anchor[2]);
      if (!pt) return;
      el.style.visibility = pt.behind ? "hidden" : "visible";
      // Direction the arrow leaves the pick, in screen space — the bar goes the other way.
      let ox = 0, oy = -1;
      if (away) {
        const tip = viewerRef.current?.projectPoint(away[0], away[1], away[2]);
        if (tip) {
          const dx = tip.x - pt.x, dy = tip.y - pt.y;
          const len = Math.hypot(dx, dy);
          if (len > 4) { ox = -dx / len; oy = -dy / len; }
        }
      }
      // Keep the bar inside the canvas and clear of the Inspector dock — a selection
      // near the right edge would otherwise project underneath it and be unreachable.
      const host = el.parentElement;
      const PUSH = 58; // clears the arrow's grab zone at any zoom
      let x = pt.x + ox * PUSH, y = pt.y + oy * PUSH;
      if (host) {
        const half = el.offsetWidth / 2;
        const dock = host.querySelector(".inspector-dock") as HTMLElement | null;
        const rightLimit = host.clientWidth - (dock ? dock.offsetWidth + 24 : 12) - half;
        x = Math.min(Math.max(x, half + 12), Math.max(half + 12, rightLimit));
        y = Math.max(y, el.offsetHeight + 20); // never above the viewer head
      }
      if (Math.abs(x - lx) < 0.5 && Math.abs(y - ly) < 0.5) return; // no sub-pixel churn
      lx = x; ly = y;
      // centred on the pick and lifted clear of it, so the bar never covers what was clicked
      // Centred on the offset point rather than hung above the pick: when the arrow
      // runs sideways the bar moves sideways too, instead of overlapping it.
      el.style.transform = `translate(calc(${Math.round(x)}px - 50%), calc(${Math.round(y)}px - 50%))`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor, away, viewerRef]);
  if (!anchor) return null;
  return <div className="ctxbar" ref={ref} role="toolbar" aria-label="Selection actions">{children}</div>;
}

/* ONE export surface. Replaces four that did not know about each other: the status-bar
   dropdown (3MF/STL/STEP/OBJ), the plate bar menu (3MF only), the same menu again in the
   Objects panel, and the split-pieces panel (STL/3MF/zip) — three different format
   vocabularies for one concept. It opens on readiness, because the question before
   "which file?" is always "is this going to print?". */
const FORMATS_WHAT =
  "3MF keeps real millimetres and per-part colour and is what modern slicers want. " +
  "STL is the universal fallback and forgets both. STEP is editable CAD for Fusion or Shapr3D, not a print file. " +
  "OBJ is for reference only.";
const READINESS_WHAT =
  "Four checks that run before every export: the model is closed, it fits your bed, its size looks sane, " +
  "and it is not so dense your slicer will struggle.";
function ExportPanel({ p, busy }: { p: Props; busy: boolean }) {
  const [override, setOverride] = useState(false);
  const [pieceFmt, setPieceFmt] = useState<"stl" | "3mf">("stl");
  const r = p.report;
  const pieces = p.splitCtl.pieces ?? [];
  const hasPlates = p.plateCtl.count > 1 || p.attachments.length > 0;
  const isMesh = p.activeKind !== "replicad";

  // Walls join the gate: kick the sampling scan off once when the panel opens (it
  // invalidates itself on any rebuild), so by the time a file leaves, the row shows a
  // real measurement — as a warning, never a blocker, because thin can be intentional.
  const thin = p.printPrep.thin;
  const thinKick = useRef(false);
  useEffect(() => {
    if (thinKick.current || !p.geometry || thin.report || thin.busy) return;
    thinKick.current = true;
    thin.run();
  }, [p.geometry, thin]);

  // The five checks that actually run. Nothing here is claimed that the code does
  // not compute — floating islands are deliberately absent.
  const tight = r?.manifold.isWatertight ?? null;
  const fits = r?.bedFit.fitsRotated ?? null;
  const heavy = r ? r.triangleCount > HEAVY_TRIANGLES : null;
  const maxDim = p.dims ? Math.max(p.dims.x, p.dims.y, p.dims.z) : null;
  const sane = maxDim == null ? null : maxDim >= 3;
  const blocked = r != null && (fits === false || tight === false);
  const gated = blocked && !override;

  const Check = ({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) => (
    <div className={`xrow${ok === false ? " bad" : ok ? " ok" : ""}`}>
      <span className="xmark">{ok == null ? "·" : ok ? "✓" : "▲"}</span>
      <span className="xlabel">{label}</span>
      {detail && <span className="xdetail">{detail}</span>}
    </div>
  );

  if (!p.geometry) return <p className="dock-empty">Nothing to export yet — build or import a model first.</p>;

  return (
    <div className="dock-panel export-panel">
      <p className="dock-sub">Print readiness <Hint text={READINESS_WHAT} /></p>
      {!r ? (
        // The report is computed on an idle callback after the geometry lands. Say so,
        // rather than rendering nothing and looking like a clean bill of health.
        <p className="dock-note">Checking this model…</p>
      ) : (
        <>
          <Check ok={tight} label="Watertight" detail={tight ? undefined : `${r.manifold.boundaryEdges} open edges`} />
          <Check ok={fits} label="Fits your bed" detail={`${p.printer.bed.x}×${p.printer.bed.y}×${p.printer.bed.z} mm`} />
          <Check ok={sane} label="Scale looks right" detail={maxDim ? `${Math.round(maxDim)} mm` : undefined} />
          <Check ok={heavy === null ? null : !heavy} label="Slicer-friendly" detail={r.triangleCount >= 1000 ? `${Math.round(r.triangleCount / 1000)}k tris` : `${r.triangleCount} tris`} />
          {/* Honest phrasing on the pass state: this is a sample, not a proof — say how
              many spots were measured rather than pronouncing the walls "healthy". */}
          <Check
            ok={thin.report ? thin.report.thinSamples === 0 : null}
            label={thin.report ? (thin.report.thinSamples > 0 ? "Thin walls found" : "Walls") : "Walls"}
            detail={
              !thin.report
                ? thin.busy ? "measuring…" : undefined
                : thin.report.thinSamples > 0
                  ? `${thin.report.thinSamples} spots under ${thin.report.thresholdMM} mm`
                  : `none thin in ${thin.report.sampled} samples`
            }
          />
        </>
      )}
      {thin.report && thin.report.thinSamples > 0 && (
        <p className="fine">Thinnest ≈ {thin.report.minThicknessMM} mm — under {thin.report.thresholdMM} mm walls print fragile or vanish. <button className="link" onClick={thin.toggleShown}>{thin.shown ? "Hide them" : "Show them on the model"}</button></p>
      )}
      {/* Magnet/screw pockets vs gravity: an up-facing pocket prints clean; sideways
          or downward, the roof of the little cylinder droops without supports — and a
          drooped roof is a magnet that won't seat. Design-time knowledge the slicer
          only gets if the user remembers to ask for supports. */}
      {p.pockets && (
        <Check
          ok={p.pockets.side + p.pockets.down === 0}
          label={p.pockets.side + p.pockets.down === 0 ? "Pockets print clean" : "Pockets need supports"}
          detail={p.pockets.side + p.pockets.down === 0 ? `all ${p.pockets.total} open upward` : `${p.pockets.side + p.pockets.down} of ${p.pockets.total} face sideways/down`}
        />
      )}
      {p.pockets && pocketAdvice(p.pockets) && <p className="fine">{pocketAdvice(p.pockets)}</p>}

      {r && !tight && isMesh && (
        <button className="ghost sm" disabled={busy} onClick={p.onRepair}>Fix model — make it watertight</button>
      )}
      {r && heavy && isMesh && (
        <button className="ghost sm" disabled={busy} onClick={p.onSimplify}>Simplify — halve triangles</button>
      )}
      {r && fits === false && (
        <div className="xfix">
          <button className="primary sm" disabled={busy} onClick={p.onFitToPlate}>Scale to fit</button>
          <button className="ghost sm" disabled={busy} onClick={p.onSplit}>Split into pieces</button>
        </div>
      )}
      {gated && (
        <button className="link xoverride" onClick={() => setOverride(true)}>
          Export anyway — I'll deal with it in the slicer
        </button>
      )}

      {/* Elephant's foot, at the moment it matters: right before the file leaves. Once
          per model — the ops chain remembers, so this row reads "added" after. */}
      {p.printPrep.chamfer.can && (
        p.printPrep.chamfer.done ? (
          <p className="fine">✓ Bottom bevel added — the squished first layer stays inside the true footprint.</p>
        ) : (
          <div className="xfix">
            <button className="ghost sm" disabled={busy} onClick={() => p.printPrep.chamfer.apply(0.4)} title="Most printers squash the first layer slightly outward (the “elephant's foot”), which fattens the footprint and shrinks holes near the bed. A 0.4 mm bevel on every bottom edge absorbs the bulge. Undoable.">
              Add 0.4 mm bottom bevel — first-layer squish guard
            </button>
          </div>
        )
      )}

      <p className="dock-sub">File <Hint text={FORMATS_WHAT} /></p>
      <input
        className="xname"
        value={p.exportName ?? ""}
        placeholder={p.exportDefaultName ?? "model"}
        aria-label="File name"
        onChange={(e) => p.onExportName?.(e.target.value)}
      />
      <div className="xformats">
        {EXPORT_FORMATS.map(({ f, label, desc }) => {
          const ok = p.canExport(f) && !(f === "step" && !p.supportsStep);
          return (
            <button key={f} className="xfmt" disabled={!ok || gated || busy} title={f === "step" && !p.supportsStep ? "needs the Precise engine" : desc} onClick={() => p.onExport(f)}>
              {label}
            </button>
          );
        })}
      </div>
      {p.exportPaint.has && (
        <div className="snap-row" title="Painted writes the filament regions into the 3MF (STL never carries colour). Plain exports the same shape uncoloured — one model, both variations.">
          <span>Colours</span>
          <div className="seg sm">
            <button className={p.exportPaint.on ? "on" : ""} onClick={() => p.exportPaint.set(true)}>Painted</button>
            <button className={p.exportPaint.on ? "" : "on"} onClick={() => p.exportPaint.set(false)}>Plain</button>
          </div>
        </div>
      )}

      {hasPlates && (
        <>
          <p className="dock-sub">Plates</p>
          <button className="ghost sm" disabled={gated || busy} onClick={p.plateCtl.exportProject}>One project .3mf — all plates in one file</button>
          <button className="ghost sm" disabled={gated || busy} onClick={p.plateCtl.exportEach}>One .3mf per plate{p.plateCtl.count > 1 ? " — as a zip" : ""}</button>
        </>
      )}

      {pieces.length > 0 && (
        <>
          <p className="dock-sub">Pieces · {pieces.length}</p>
          <div className="seg sm xpiece">
            <button className={pieceFmt === "stl" ? "on" : ""} onClick={() => setPieceFmt("stl")}>STL</button>
            <button className={pieceFmt === "3mf" ? "on" : ""} onClick={() => setPieceFmt("3mf")}>3MF</button>
          </div>
          <button className="ghost sm" disabled={gated || busy} onClick={() => p.splitCtl.exportAll(pieceFmt)}>Download all as .zip</button>
        </>
      )}

      <p className="dock-sub">Hand off</p>
      {/* The desktop app opens the file through the OS, so it reaches whichever slicer
          owns .3mf — naming a specific one would be a guess. The browser can only deep-
          link, and a deep link IS per-slicer, so the web build asks which. */}
      {IS_DESKTOP ? (
        <>
          <button className="ghost sm" disabled={gated || busy} onClick={() => p.onOpenSlicer("orca")}>Open in slicer</button>
          <p className="fine">Saves the 3MF and opens it in your default slicer — Orca, Bambu, Prusa, whichever owns .3mf. The file keeps its name, so after an edit you can send it again and use <b>Reload from disk</b> in the slicer instead of starting the print setup over.</p>
        </>
      ) : (
        <>
          <button className="ghost sm" disabled={gated || busy} onClick={() => p.onOpenSlicer("bambu")}>Open in Bambu Studio</button>
          <button className="ghost sm" disabled={gated || busy} onClick={() => p.onOpenSlicer("orca")}>Open in OrcaSlicer</button>
          <p className="fine">Sends the 3MF straight to the slicer when Moldable is running on your own machine; on the hosted site it downloads instead, and double-clicking the file opens your slicer. PrusaSlicer only accepts links from printables.com, so it takes the download route either way.</p>
        </>
      )}
      {busy && <p className="dock-note">Preparing the file…</p>}
    </div>
  );
}

/* Hover help. `title` alone is invisible until you already suspect there is something
   to learn — this marks the spot. Focusable so it is reachable without a pointer. */
function Hint({ text }: { text: string }) {
  return <span className="hint" tabIndex={0} role="note" aria-label={text} title={text}>?</span>;
}

function DockRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="dock-row">
      <span className="dock-k">{k}</span>
      <span className="dock-v">{v}</span>
    </div>
  );
}

/* Reads whatever is currently selected. Three truthful states rather than one
   invented one: a picked feature, the whole body, or nothing picked yet — the
   empty state is where the selection-driven model gets taught. */
function DockSelection({ feature, dims, units, modelSelected, modifying, ask, onRestFace }: {
  feature: PickedFeature | null;
  dims: { x: number; y: number; z: number } | null;
  units: "mm" | "in";
  modelSelected: boolean;
  /** The Modify tool is armed — its flyout replaces the floating op bar, so say that instead. */
  modifying?: boolean;
  ask?: {
    text: string; setText: (v: string) => void; onAsk: () => void; onClear: () => void;
    canAsk: boolean; busy: boolean; placeholder: string; count?: number;
    /** How the multi-selection breaks down, so the panel can name it honestly. */
    kinds?: { face?: number; edge?: number; vertex?: number };
    /** Run the armed Modify operation over the whole set. */
    applyAll?: { label: string; size: number; run: () => void };
  };
  /** Rotate the whole part so this face's normal points down at the plate. Also in
   *  the right-click menu — but right-click doesn't exist on an iPad, so the face
   *  panel is the findable home. */
  onRestFace?: (normal: [number, number, number]) => void;
}) {
  const n = (v: number) => (units === "in" ? (v / 25.4).toFixed(2) : String(Math.round(v * 10) / 10));
  const u = units === "in" ? "in" : "mm";
  if (feature) {
    const kind = feature.kind === "face" ? "Face" : feature.kind === "edge" ? "Edge" : "Corner";
    const detail = feature.kind === "face" ? `${feature.label} · ${feature.curved ? "curved" : "planar"}` : feature.label;
    const size =
      feature.kind === "face" && feature.w != null && feature.h != null ? `${n(feature.w)} × ${n(feature.h)} ${u}`
      : feature.kind === "edge" && feature.len != null ? `${n(feature.len)} ${u} long`
      : null;
    return (
      <div className="dock-panel">
        <DockRow k={kind} v={detail} />
        {size && <DockRow k="Size" v={size} />}
        <DockRow k="Position" v={`X ${n(feature.cx)}   Y ${n(feature.cy)}   Z ${n(feature.cz)}`} />
        {feature.kind === "face" && feature.nx != null && onRestFace && (
          <button className="ghost sm" title="Rotate the whole part so this face lies flat on the build plate — the printing orientation"
            onClick={() => onRestFace([feature.nx!, feature.ny!, feature.nz!])}>
            Rest this face on the plate
          </button>
        )}
        <p className="dock-note">
          {modifying
            ? "Drag the arrow on the model to set the amount live — the size box in the Modify panel follows, and stops when it can't go further."
            : feature.kind === "face"
              ? "Round, Bevel and Push / Pull are on the toolbar at the selection — free, no AI. A negative value pulls the face in, or drag the blue arrow."
              : feature.kind === "edge"
                ? "Round and Bevel are on the toolbar at the selection — free, no AI. Or drag the blue arrow to round this edge live."
                : "Round and Bevel are on the toolbar at the selection — free, no AI."}
        </p>
        {ask && <DockAsk ask={ask} />}
      </div>
    );
  }
  if (modelSelected && dims) {
    return (
      <div className="dock-panel">
        <DockRow k="Object" v="Whole part" />
        <DockRow k="Size" v={`${n(dims.x)} × ${n(dims.y)} × ${n(dims.z)} ${u}`} />
        <p className="dock-note">Edit any size from Set size… — the whole part rescales to match.</p>
      </div>
    );
  }
  if (ask && ask.count) {
    // The set can hold faces, edges and corners together now, so it can't be labelled
    // "Faces" — name what's actually in it.
    const kinds = ask.kinds ?? {};
    const parts = [
      kinds.face ? `${kinds.face} face${kinds.face > 1 ? "s" : ""}` : "",
      kinds.edge ? `${kinds.edge} edge${kinds.edge > 1 ? "s" : ""}` : "",
      kinds.vertex ? `${kinds.vertex} corner${kinds.vertex > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    return (
      <div className="dock-panel">
        <DockRow k="Selected" v={parts.length ? parts.join(" · ") : `${ask.count} spots`} />
        <p className="dock-note">Shift-click to add more, or shift-drag to box-select.</p>
        {/* Apply the armed operation to every one of them at once — the whole reason to
            build a set. Only offered while an operation IS armed; otherwise the set is
            just something to describe to the AI below. */}
        {ask.applyAll && (
          <div className="param-actions">
            <button className="primary sm" disabled={ask.busy} onClick={ask.applyAll.run}
              title={`Apply ${ask.applyAll.label} ${ask.applyAll.size} mm to all ${ask.count}`}>
              {ask.applyAll.label} all {ask.count} · {ask.applyAll.size} mm
            </button>
          </div>
        )}
        <DockAsk ask={ask} />
      </div>
    );
  }
  return <p className="dock-empty">Click a face, an edge or a corner to see what you can do with it.</p>;
}

/* The "ask the AI about this selection" path. It used to sit in the floating panel
   the tool rail drew over; the verbs moved to the contextual bar and the words moved
   here, so there is one place for each rather than one card holding both. */
function DockAsk({ ask }: { ask: NonNullable<Parameters<typeof DockSelection>[0]["ask"]> }) {
  return (
    <div className="dock-ask">
      <textarea rows={2} value={ask.text} onChange={(e) => ask.setText(e.target.value)} placeholder={ask.placeholder} />
      <div className="param-actions">
        <button className="primary sm" disabled={!ask.text.trim() || !ask.canAsk || ask.busy} onClick={ask.onAsk}>
          Ask AI to change {ask.count ? "these" : "this"}
        </button>
        <button className="ghost sm" onClick={ask.onClear}>Clear</button>
      </div>
      {!ask.canAsk && <p className="fine">Precise (CAD) models only.</p>}
    </div>
  );
}

/** Exact typed rotation in the Move flyout's Rotate mode: pick an axis, type degrees,
 *  go. Complements the rings (freehand) and Shift (90° steps) with "I know the number". */
function RotateByRow({ busy, onGo }: { busy: boolean; onGo: (axis: "x" | "y" | "z", deg: number) => void }) {
  const [axis, setAxis] = useState<"x" | "y" | "z">("z");
  const [deg, setDeg] = useState("90");
  const go = () => {
    const d = parseFloat(deg);
    if (!Number.isFinite(d) || d === 0) return;
    onGo(axis, d);
  };
  return (
    <>
      <div className="seg sm" role="radiogroup" aria-label="Rotation axis">
        {(["x", "y", "z"] as const).map((a) => (
          <button key={a} role="radio" aria-checked={axis === a} className={axis === a ? "on" : ""} title={`Rotate about the ${a.toUpperCase()} axis`} onClick={() => setAxis(a)}>{a.toUpperCase()}</button>
        ))}
      </div>
      <input
        className="rotate-deg" type="number" step={15} value={deg} aria-label="Degrees"
        onChange={(e) => setDeg(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button className="ghost sm" disabled={busy} title="Rotate by exactly this many degrees (negative = the other way), resting back on the plate — undoable" onClick={go}>Rotate</button>
    </>
  );
}

// Structural twin of lib/screws.ts ScrewSize — Workspace stays decoupled from the lib.
type ScrewSizeLike = { id: string; label: string; d: number; pitch: number; clearance: number; bite: number; head: number; insertBore?: number; insertLen?: number; note?: string };
type DockPanel = "selection" | "objects" | "params" | "print" | "code" | "history" | "export";
// Icons ride the Inspector rows themselves — the old canvas tab strip duplicated this
// list (every tab was just setDockPanel), so the strip is gone and its icons moved here.
// "Adjust", not "Parameters": the row is free no-AI dimension tweaking, and "Parameters"
// sent people to the chatbot to pay tokens for what this panel does for free.
const DOCK_ITEMS: ReadonlyArray<{ key: DockPanel; label: string; icon: JSX.Element }> = [
  { key: "selection", label: "Selection", icon: <IconPointer size={18} /> },
  { key: "objects", label: "Objects", icon: <IconLayers size={18} /> },
  { key: "params", label: "Adjust", icon: <IconSliders size={18} /> },
  { key: "print", label: "Printability", icon: <IconPrinter size={18} /> },
  { key: "code", label: "Source", icon: <IconCode size={18} /> },
  { key: "history", label: "History", icon: <IconHistory size={18} /> },
  { key: "export", label: "Export", icon: <IconExport size={18} /> },
];

/** Reactive media query — the phone shell is a different composition, not a squeezed
 *  desktop, so components need to KNOW they are on a phone rather than only styling
 *  around it (render conditions, sheet states, send-expands behaviour). */
function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** "July 31st, 2026" — the chat head's date, ordinal and all. */
function chatDate(): string {
  const d = new Date();
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${d.toLocaleDateString("en-US", { month: "long" })} ${day}${suffix}, ${d.getFullYear()}`;
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  const rows: { icon: JSX.Element; text: string }[] = [
    { icon: <IconCube />, text: "Orbit: drag rotates, pinch or scroll zooms, middle- or right-drag (two fingers) pans." },
    { icon: <IconPointer />, text: "Right-click the model, a part, or empty space for quick actions — rename, duplicate, clearance tools, plates." },
    { icon: <IconLayers />, text: "Objects panel: double-click any name (or a plate tab) to rename it." },
    { icon: <IconModify />, text: "Modify: hover the model — it picks the face, edge or corner under the cursor — then Push/Pull, Rounded or Angled it (keys 1–3)." },
    { icon: <IconEdgeSel />, text: "Drag the blue arrow to extrude a face or round an edge — the model updates live; type an exact mm in the quick-edit box instead if you prefer." },
    { icon: <IconCheck />, text: "If a size doesn't fit the geometry, Moldable applies the largest that does and tells you both numbers." },
    { icon: <IconFaceSel />, text: "Shift-drag (with Modify on) box-selects many faces at once." },
    { icon: <IconTransform />, text: "Transform: move, rotate or scale the whole part — rotate is how you set print orientation." },
    { icon: <IconRuler />, text: "Measure: tap two points to read the distance between them." },
    { icon: <IconFaceSel />, text: "Drill holes: click a face → Hole… — type exact offsets, snap to a magnet grid, or align with another hole (pick its rim, then zero a Δ or type the spacing)." },
    { icon: <IconMarker />, text: "Mark: draw around a part of the model — the marked screenshot attaches to the chat, so \"make this thicker\" needs no coordinates." },
    { icon: <IconUndo />, text: "Undo ⌘/Ctrl+Z · Redo ⇧⌘Z or Ctrl+Y — including paint strokes. Every edit is a restorable version in History." },
    { icon: <IconPointer />, text: "Keys: V Modify · N Note · G Transform · M Measure · B Paint · F re-frame the model · 1–3 pick the Modify operation." },
    { icon: <IconX />, text: "Esc — or a click on empty canvas — puts the current tool down and closes any open panel." },
    { icon: <IconPrinter />, text: "The bottom bar shows your printer's plate — tap it to switch printers or bed size." },
  ];
  return (
    <div className="help-sheet" role="dialog" aria-label="Tools and gestures">
      <div className="help-head">
        <b>Tools & gestures</b>
        <button className="x" aria-label="Close help" onClick={onClose}><IconX /></button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="help-row">{r.icon}<span>{r.text}</span></div>
      ))}
    </div>
  );
}

// Sample the real requestAnimationFrame cadence over ~40 frames and report it in Hz.
function sampleDisplayRate(done: (hz: number) => void) {
  let n = 0;
  let t0 = 0;
  const step = (t: number) => {
    if (!t0) t0 = t;
    if (++n < 40) { requestAnimationFrame(step); return; }
    if (t > t0) done(Math.round(((n - 1) * 1000) / (t - t0)));
  };
  requestAnimationFrame(step);
}

// How the viewer FEELS tracks the display's real refresh rate, and a WKWebView (the Mac
// app) does not always get the same rate a browser gets on the very same panel. The
// packaged desktop app has no devtools console to check that from, so surface the
// measured rate in the build tag's tooltip — hovering it is the whole diagnostic.
function BuildTag() {
  const [hz, setHz] = useState(0);
  // Sample once the app has settled; start-up work would depress the reading.
  useEffect(() => {
    const id = window.setTimeout(() => sampleDisplayRate(setHz), 3000);
    return () => clearTimeout(id);
  }, []);
  return (
    <span
      className="build-tag"
      onMouseEnter={() => sampleDisplayRate(setHz)}
      title={`Deployed build number — it goes up with every update, so a bigger number after a refresh means the update landed.\nDisplay: ${hz ? `${hz} Hz` : "measuring…"} · ${window.devicePixelRatio}× pixel ratio`}
    >
      v{__BUILD_STAMP__}
    </span>
  );
}

function MeshStats({ report }: { report: PrintabilityReport }) {
  const heavy = report.triangleCount > HEAVY_TRIANGLES;
  const wt = report.manifold.isWatertight;
  const fit = report.bedFit;
  return (
    <div className="mesh-stats" role="status" aria-label="Mesh and print stats">
      <div className="ms-row"><span>Triangles</span><b className={heavy ? "warn" : ""}>{report.triangleCount.toLocaleString()}{heavy ? " · heavy" : ""}</b></div>
      <div className="ms-row"><span>Watertight</span><b className={wt ? "ok" : "bad"}>{wt ? "Yes" : `${report.manifold.boundaryEdges} open`}</b></div>
      <div className="ms-row"><span>Volume</span><b>{(report.volume.approxVolume / 1000).toFixed(1)} cm³</b></div>
      <div className="ms-row"><span>Fits bed</span><b className={fit.fitsRotated ? "ok" : "bad"}>{fit.fitsAsIs ? "Yes" : fit.fitsWithRotation ? "Rotated" : "No"}</b></div>
    </div>
  );
}

/** The "path to a print-ready file" — the differentiator competitors stop short of.
    Reflects real state (model → checked → print-ready) and jumps to the check. */
function PathToPrint({ hasModel, report, onOpenCheck }: {
  hasModel: boolean;
  report: PrintabilityReport | null;
  onOpenCheck: () => void;
}) {
  const checked = !!report;
  const ready = !!report && report.manifold.isWatertight && report.bedFit.fitsRotated && report.triangleCount <= HEAVY_TRIANGLES;
  const readyState: "pending" | "done" | "warn" = !report ? "pending" : ready ? "done" : "warn";
  const steps: { label: string; state: "pending" | "done" | "warn"; click?: () => void }[] = [
    { label: "Design", state: hasModel ? "done" : "pending" },
    { label: "Check", state: checked ? "done" : "pending", click: hasModel ? onOpenCheck : undefined },
    { label: readyState === "warn" ? "Needs fix" : "Print Ready", state: readyState, click: checked ? onOpenCheck : undefined },
  ];
  return (
    <div className="p2p" title="Your path to a print-ready file — Moldable takes you all the way to export">
      {steps.map((s, i) => {
        const inner = <><i className={`p2p-dot ${s.state}`} /><span className="p2p-lab">{s.label}</span></>;
        return s.click ? (
          <button key={i} type="button" className={`p2p-step ${s.state}`} onClick={s.click}>{inner}</button>
        ) : (
          <span key={i} className={`p2p-step ${s.state}`}>{inner}</span>
        );
      })}
    </div>
  );
}

/** Modify panel: the operation, its size, and — new — every rounding and bevel already
 *  on the part as an editable list.
 *
 *  "Round" and "Bevel" are gone as words. Both were jargon the panel expected you to
 *  already know; the profile glyph beside each one shows the corner being taken off,
 *  which is the actual difference, and "Rounded"/"Angled" name the RESULT rather than
 *  the operation. */
function ModifyFly({ ctl, featureCtl }: { ctl: Props["modifyCtl"]; featureCtl: Props["featureCtl"] }) {
  const op = ctl.op!;
  const sel = ctl.editIndex != null ? ctl.edges.find((e) => e.index === ctl.editIndex) ?? null : null;
  // What this spot can actually take. Push/Pull runs both ways (in cuts, out adds);
  // a rounding only ever goes outward from zero.
  const arrow = featureCtl.pushArrow;
  const lo = op.op === "push" ? (arrow?.min ?? -Infinity) : 0.05;
  const hi = arrow?.max ?? Infinity;
  const OPS = [
    { k: "push" as const, label: "Push/Pull", Icon: IconPushPull, tip: "Move a flat face along its own direction — out adds material, in cuts it away" },
    { k: "round" as const, label: "Rounded", Icon: IconEdgeRound, tip: "Take the corner off as a curve (a fillet) — kinder on hands and stronger in print" },
    { k: "bevel" as const, label: "Angled", Icon: IconEdgeAngle, tip: "Take the corner off as a flat slope (a chamfer) — the classic lead-in for a screw or a lid" },
  ];
  return (
    <div className="rail-fly modify-fly">
      <div className="modify-ops" role="radiogroup" aria-label="What to do">
        {OPS.map((o) => (
          <button key={o.k} className={op.op === o.k ? "on" : ""} role="radio" aria-checked={op.op === o.k}
            title={o.tip} onClick={() => ctl.set({ op: o.k, size: op.size })}>
            <o.Icon size={18} /><span>{o.label}</span>
          </button>
        ))}
      </div>
      {/* Mid-drag the box mirrors the live value; typing still works between drags.
          The limits come from the same computation that stops the drag arrow, so the
          typed path and the dragged path agree — you can't type a number the drag
          wouldn't reach, which is where the "errors when rounding edges" came from. */}
      <label className="modify-size">
        <input
          type="number"
          step={0.5}
          min={lo}
          max={hi}
          value={featureCtl.liveMm ?? op.size}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) ctl.set({ op: op.op, size: Math.min(hi, Math.max(lo, v)) });
          }}
        />
        <span>mm</span>
        <button
          className="ghost sm"
          disabled={!featureCtl.selected}
          title={featureCtl.selected ? "Apply this size to the selected spot" : "Click a spot on the model first"}
          onClick={ctl.apply}
        >Apply</button>
      </label>
      {featureCtl.selected && hi < Infinity && (
        <p className="fine modify-range">Anything from {fmtMm(lo)} to {fmtMm(hi)} fits here.</p>
      )}
      {featureCtl.liveStop ? (
        <p className="fine modify-stop">
          {featureCtl.liveStop === "max"
            ? op.op === "push"
              ? "That's the limit — any further won't fit the printer."
              : "That's the limit — as big as fits here."
            : "That's the limit — any deeper cuts through."}
        </p>
      ) : ctl.note ? (
        <p className="fine modify-stop">{ctl.note}</p>
      ) : featureCtl.selected ? (
        <p className="fine">
          {op.op === "push"
            ? "Now drag the arrow — out adds, in cuts. Or type a size and press Apply."
            : "Now drag the arrow to set the size by eye — or type it and press Apply."}
        </p>
      ) : (
        <p className="fine">
          {op.op === "push"
            ? "Click a flat face to give it a drag arrow."
            : "Click a face, edge or corner to give it a drag arrow."}
        </p>
      )}
      {/* Everything already applied, still editable. This is the difference between a
          decoration you can only Undo and a feature you own. */}
      {ctl.edges.length > 0 && (
        <>
          <div className="shape-lbl">
            <span>Rounded edges</span>
            <button className="link-sm" onClick={ctl.reset} title="Take every rounding and bevel back off — one Undo brings them all back">Reset all</button>
          </div>
          <div className="pocket-list">
            {ctl.edges.map((e) => (
              <div key={e.index} className={`pocket-row${ctl.editIndex === e.index ? " on" : ""}`}>
                <button className="pocket-pick" title="Edit this one — retype its size below"
                  onClick={() => ctl.select(ctl.editIndex === e.index ? null : e.index)}>
                  {e.name === "Rounded" ? <IconEdgeRound size={14} /> : <IconEdgeAngle size={14} />}
                  <span className="pocket-size">{e.name} {e.what}</span>
                  <span className="pocket-where">{e.size} mm</span>
                </button>
                <button className="x" aria-label="Remove this edge treatment" title="Take it back off — undoable" onClick={() => ctl.remove(e.index)}><IconX /></button>
              </div>
            ))}
          </div>
          {sel && (
            <label className="modify-size">
              <input type="number" step={0.5} min={0.05} defaultValue={sel.size} key={`${sel.index}:${sel.size}`}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter") return;
                  const v = parseFloat((ev.target as HTMLInputElement).value);
                  if (Number.isFinite(v) && v > 0) ctl.edit(sel.index, v);
                }} />
              <span>mm</span>
              <button className="ghost sm" title="Rebuild this edge at the new size"
                onClick={(ev) => {
                  const inp = (ev.currentTarget.parentElement as HTMLElement).querySelector("input") as HTMLInputElement;
                  const v = parseFloat(inp.value);
                  if (Number.isFinite(v) && v > 0) ctl.edit(sel.index, v);
                }}>Set</button>
            </label>
          )}
        </>
      )}
      <p className="fine">Shell, revolve or patterns: select the spot, then ask in chat.</p>
    </div>
  );
}

/** Shape tool panel: what to drop, whether it adds or cuts, and — once something is
 *  placed — its exact size and centre. Clicking puts it roughly where you point; these
 *  boxes are what make it exact, which is the whole reason not to describe it in words. */
function ShapeFly({ ctl, units }: { ctl: Props["shapeCtl"]; units: "mm" | "in" }) {
  const t = ctl.tool!;
  const sel = ctl.editIndex != null ? ctl.shapes.find((x) => x.index === ctl.editIndex) ?? null : null;
  const KINDS = [
    { k: "box" as const, label: "Box", Icon: IconPrimBox },
    { k: "cylinder" as const, label: "Cylinder", Icon: IconPrimCylinder },
    { k: "sphere" as const, label: "Ball", Icon: IconPrimBall },
  ];
  // Which of the three numbers a shape actually has: a ball is one diameter, a
  // cylinder is a diameter and a height, a box is all three.
  const fields = (k: string): { i: number; l: string }[] =>
    k === "sphere" ? [{ i: 0, l: "⌀" }]
      : k === "cylinder" ? [{ i: 0, l: "⌀" }, { i: 2, l: "H" }]
        : [{ i: 0, l: "W" }, { i: 1, l: "D" }, { i: 2, l: "H" }];
  const size = sel ? sel.size : t.size;
  const kind = sel ? sel.shape : t.shape;
  const cut = sel ? sel.cut : t.cut;
  // Sizes are stored in mm; the boxes speak whichever unit the project is in, so an
  // inch project doesn't get three fields silently labelled mm.
  const inch = units === "in";
  const toU = (mm: number) => (inch ? Math.round((mm / 25.4) * 1000) / 1000 : Math.round(mm * 100) / 100);
  const toMm = (v: number) => (inch ? v * 25.4 : v);
  const step = inch ? 0.05 : 0.5;
  const setSize = (i: number, v: number) => {
    const next: [number, number, number] = [...size] as [number, number, number];
    next[i] = v;
    if (i === 0 && kind !== "box") next[1] = v; // ⌀ drives both cross-section axes
    if (kind === "sphere") { next[1] = v; next[2] = v; }
    if (sel) ctl.edit(sel.index, { size: next });
    else ctl.set({ ...t, size: next });
  };
  return (
    <div className="rail-fly shape-fly">
      {/* What you're dropping is the tool's SUBJECT — it used to be a text seg carrying
          the same weight as the snap setting three rows below it. Tiles, with the solid
          drawn above its name, so the choice reads before you read anything.
          The row means one thing in both modes — "what kind is this shape" — so with one
          selected the tiles CHANGE it rather than going dead behind a tooltip telling you
          to deselect first. */}
      {/* radiogroup, not three toggle buttons: it's one choice out of three, and
          aria-pressed on each would announce three independent switches. */}
      <div className="shape-kinds" role="radiogroup" aria-label={sel ? "Shape kind" : "Shape to drop"}>
        {KINDS.map((o) => (
          <button key={o.k} className={kind === o.k ? "on" : ""} role="radio" aria-checked={kind === o.k}
            onClick={() => (sel ? ctl.edit(sel.index, { shape: o.k }) : ctl.set({ ...t, shape: o.k }))}
            title={sel ? `Turn this one into a ${o.label.toLowerCase()}` : `Drop a ${o.label.toLowerCase()}`}>
            <o.Icon /><span>{o.label}</span>
          </button>
        ))}
      </div>
      <div className="seg sm">
        <button className={!cut ? "on" : ""}
          onClick={() => (sel ? ctl.edit(sel.index, { cut: false }) : ctl.set({ ...t, cut: false }))}
          title="Fuse it onto the part — a boss, a rib, a lug">Add</button>
        <button className={cut ? "on" : ""}
          onClick={() => (sel ? ctl.edit(sel.index, { cut: true }) : ctl.set({ ...t, cut: true }))}
          title="Subtract it — a pocket, a slot, a clearance">Cut</button>
      </div>
      <div className="shape-lbl"><span>Size</span><span className="shape-unit">{inch ? "in" : "mm"}</span></div>
      <div className="shape-nums">
        {fields(kind).map((f) => (
          <label key={f.i}><span>{f.l}</span>
            <input type="number" step={step} min={inch ? 0.01 : 0.2} value={toU(size[f.i])}
              onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v > 0) setSize(f.i, toMm(v)); }} />
          </label>
        ))}
      </div>
      {sel ? (
        <>
          <div className="shape-lbl"><span>Centre</span><span className="shape-unit">{inch ? "in" : "mm"}</span></div>
          <div className="shape-nums">
            {(["X", "Y", "Z"] as const).map((ax, i) => (
              <label key={ax}><span>{ax}</span>
                <input type="number" step={step} value={toU(sel.at[i])}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    const next: [number, number, number] = [...sel.at] as [number, number, number];
                    next[i] = toMm(v);
                    ctl.edit(sel.index, { at: next });
                  }} />
              </label>
            ))}
          </div>
          <p className="fine">Z is height above the plate. Type any of them — nothing is baked in.</p>
        </>
      ) : (
        <>
          <div className="shape-lbl"><span>Land it</span></div>
          <div className="seg sm">
            <button className={t.snap > 0 ? "on" : ""} onClick={() => ctl.set({ ...t, snap: 1 })} title="Land the centre on a 1 mm grid">On a 1 mm grid</button>
            <button className={t.snap === 0 ? "on" : ""} onClick={() => ctl.set({ ...t, snap: 0 })} title="Land it exactly where you clicked">Anywhere</button>
          </div>
          <p className="fine">Click the model where you want it. {cut ? "It sinks in, so the size above is the pocket." : "It sits on the surface."} Then type its exact numbers.</p>
        </>
      )}
      {ctl.shapes.length > 0 && (
        <>
          <div className="shape-lbl"><span>On the model</span><span className="shape-unit">{ctl.shapes.length}</span></div>
          <div className="pocket-list">
            {ctl.shapes.map((k) => {
              const KIcon = k.shape === "box" ? IconPrimBox : k.shape === "cylinder" ? IconPrimCylinder : IconPrimBall;
              return (
                <div key={k.index} className={`pocket-row${ctl.editIndex === k.index ? " on" : ""}`}>
                  <button className="pocket-pick" title="Edit this one — its size and centre become the boxes above"
                    onClick={() => ctl.select(ctl.editIndex === k.index ? null : k.index)}>
                    <KIcon size={14} />
                    <span className="pocket-size">{k.cut ? "Cut" : "Add"} {k.shape === "sphere" ? "ball" : k.shape}</span>
                    <span className="pocket-where">{k.size.slice(0, k.shape === "sphere" ? 1 : k.shape === "cylinder" ? 1 : 3).map((n) => Math.round(n * 10) / 10).join("×")} · {fmtLen(k.at[2], units)} up</span>
                  </button>
                  <button className="x" aria-label="Remove this shape" title="Take it back off — undoable" onClick={() => ctl.remove(k.index)}><IconX /></button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** A limit, in mm, trimmed to something readable ("−12.4", "8"). */
function fmtMm(v: number): string {
  if (!Number.isFinite(v)) return "any";
  const r = Math.round(v * 10) / 10;
  return `${r} mm`;
}

/** One length in the chosen unit, for inline readouts. */
function fmtLen(mm: number, units: "mm" | "in"): string {
  return units === "in" ? `${(mm / 25.4).toFixed(2)}″` : `${Math.round(mm * 10) / 10} mm`;
}

/** Format overall W×D×H in the chosen unit (unit shown once). */
function fmtDims(d: { x: number; y: number; z: number }, units: "mm" | "in"): string {
  if (units === "in") {
    const c = (n: number) => (n / 25.4).toFixed(2);
    return `${c(d.x)} × ${c(d.y)} × ${c(d.z)} in`;
  }
  return `${d.x} × ${d.y} × ${d.z} mm`;
}


interface Props {
  projectName: string;
  onRename: (name: string) => void;
  activeKind: EngineKind;
  genLabel: string;
  fellBack: boolean;
  /** A running local Ollama with downloaded models — offer it as a free private brain. */
  ollamaOffer: { count: number; model: string; onUse: (m: string) => void; onDismiss: () => void } | null;
  bootError?: string;
  authNotice?: string | null;
  onDismissAuthNotice?: () => void;
  exportName?: string;
  onExportName?: (v: string) => void;
  exportDefaultName?: string;
  exporting?: boolean;
  providerWall?: string | null;
  onWallDismiss?: () => void;
  onWallAddKey?: () => void;
  onWallRetry?: () => void;
  onWallMesh?: () => void;
  booting: boolean;
  accountEmail: string | null;
  avatar: string | null; // profile photo data URL, or null for the initial
  onOpenProfile: () => void;
  /** First focus of the chat composer — App uses it for the one-time sign-in nudge. */
  onComposerFocus?: () => void;
  onSignOut: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  mode: Mode; // resolved engine (for badges / active-kind display)
  modePref: ModePref; // the composer switch: "auto" | "precise" | "generative"
  pickMode: (p: ModePref) => void;
  webMode: "auto" | "on" | "off";
  onCycleWeb: () => void;
  guided: boolean;
  onStartGuided: () => void;
  fit: FitId;
  onFit: (f: FitId) => void;
  brain: { provider: LlmProviderId; model: string };
  hasBrainKey: (provider: LlmProviderId) => boolean;
  onPickBrain: (provider: LlmProviderId, model: string) => void;
  autoPick: string; // "Auto → <model> (<why>)" shown when OpenRouter Auto picks per request
  genProvider: string;
  genModel: string;
  hasGenKey: (provider: string) => boolean;
  onPickEngine: (provider: string, model: string) => void;
  imageUrl: string | null;
  imageMarkup: boolean; // the composer image is a marked screenshot, not a photo
  imageNote: string | null; // e.g. "covers ≈ 54 × 4 × 30 mm" — what the circle landed on
  aiPreview: {
    active: boolean; // an AI proposal is held on the canvas awaiting Apply/Discard
    hasDiff: boolean; // green/red change overlays are showing
    apply: () => void;
    discard: () => void;
    retry: () => void; // rebuild the same ask fresh — a different take on the same words
    mode: "ask" | "auto";
    setMode: (m: "ask" | "auto") => void;
  };
  aiDiff: { added: Float32Array | null; removed: Float32Array | null } | null;
  /** Faces of the CURRENT model a hovered parameter moves — drawn on the object itself. */
  paramPeek: Float32Array | null;
  /** Grabbing/hovering a parameter slider previews WHERE it acts on the model. */
  onPeekParam: (key: string) => void;
  onPeekParamEnd: () => void;
  holeCtl: {
    draft: {
      at: [number, number, number];
      normal: [number, number, number];
      diameter: number;
      depth: number; // 0 = through
      snap: number; // magnet increment, 0 = free
      ref: { center: [number, number, number]; diameter?: number } | null;
      picking: boolean;
    } | null;
    canStart: boolean; // a flat face on a CAD model is selected
    axes: [number, number] | null; // the two editable in-plane axes (0=x 1=y 2=z)
    start: () => void;
    cancel: () => void;
    patch: (p: Partial<NonNullable<Props["holeCtl"]["draft"]>>) => void;
    setAxis: (axis: number, v: number) => void;
    apply: () => void;
  };
  magnetCtl: {
    tool: {
      size: { d: number; h: number; note?: string };
      fit: "press" | "glue";
      /** How far the magnet stands PROUD of the surface (mm): 0 = dead flush. A hair
       *  proud is the prop-maker trick that guarantees magnet-to-magnet contact —
       *  printed surfaces and magnet thickness both run a whisker under nominal. */
      seat: number;
      pair: boolean;
      snap: number; // grid step in mm; 0 = freeform
      placed: { at: [number, number, number]; normal: [number, number, number] }[];
    } | null;
    canUse: boolean; // CAD models only — meshes can't be drilled
    sizes: { d: number; h: number; note?: string }[];
    toggle: () => void;
    patch: (p: Partial<NonNullable<Props["magnetCtl"]["tool"]>>) => void;
    place: (spot: { at: [number, number, number]; normal: [number, number, number]; back: { at: [number, number, number]; normal: [number, number, number]; thickness: number } | null }) => void;
    pocket: { diameter: number; depth: number } | null; // the current size+fit as a pocket
    edit: { moving: boolean } | null; // a placed pocket is selected for editing
    editApply: (next: { size?: { d: number; h: number; note?: string }; fit?: "press" | "glue"; seat?: number }) => void;
    editMove: () => void;
    editDelete: () => void;
    editDone: () => void;
    removeAll: () => void;
    recutAll: () => void; // re-cut every pocket to the current size + fit + seat
    placedCount: number;
    /** Every pocket on the model, read back out of the op chain (nothing is baked in). */
    pockets: { index: number; label: string; fit: string; up: number }[];
    editIndex: number | null; // which pocket the panel is currently editing
    selectPocket: (index: number) => void;
    removePocket: (index: number) => void;
  };
  screwCtl: {
    tool: {
      size: ScrewSizeLike;
      fit: "through" | "bite" | "insert";
      countersink: boolean;
      snap: number;
      placed: { at: [number, number, number]; normal: [number, number, number] }[];
    } | null;
    canUse: boolean;
    sizes: ScrewSizeLike[];
    toggle: () => void;
    patch: (p: Partial<NonNullable<Props["screwCtl"]["tool"]>>) => void;
    place: (spot: { at: [number, number, number]; normal: [number, number, number]; back: { at: [number, number, number]; normal: [number, number, number]; thickness: number } | null }) => void;
    cut: { minor: number; major: number; pitch: number; depth: number; countersink: number; what: string } | null;
    edit: { moving: boolean } | null; // a placed hole is selected for editing
    editApply: (next: { size?: ScrewSizeLike; fit?: "through" | "bite" | "insert"; countersink?: boolean }) => void;
    editMove: () => void;
    editDelete: () => void;
    editDone: () => void;
    removeAll: () => void;
    placedCount: number;
  };
  onPickImage: (f: File) => void;
  onPickImages: (fs: File[]) => void; // multi-file drop: first = reference, rest = unlabelled extras
  refsCount: number; // extra unlabelled reference photos riding with the composer image
  photoAdvice: string; // model-aware format/resolution guidance for attachments
  onMarkup: (blob: Blob, view: { azimuthDeg: number; elevationDeg: number } | null, region: MarkRegion | null) => void;
  onClearImage: () => void;
  views: Partial<Record<"left" | "back" | "right", string>>;
  onPickView: (slot: "left" | "back" | "right", f: File) => void;
  onClearView: (slot: "left" | "back" | "right") => void;
  multiViewEngine: boolean;
  onMeasure: () => void;
  messages: ChatMessage[];
  status: "idle" | "generating";
  genProgress: BuildProgress | null; // live build stage shown over the canvas

  input: string;
  setInput: (v: string) => void;
  onSend: (p: string, forceMode?: Mode) => void;
  /** Composer's Improve button. `before` non-null means the box currently holds a
   *  rewrite and `undo` puts the user's own words back. */
  improveCtl: {
    busy: boolean; can: boolean; run: () => void;
    before: string | null; undo: () => void;
    note: string | null; dismissNote: () => void;
  };
  /** Question cards living in the transcript: pick an answer, or build from one. */
  confirmCtl: { choose: (msgId: string, yes: boolean) => void; offer: (msgId: string, accepted: boolean) => void };
  /** Remove one line from the transcript (two-step confirm lives in the row). */
  onDeleteMessage: (id: string) => void;
  /** Remove several at once — the Select sweep's single confirm already happened. */
  onDeleteMessages: (ids: string[]) => void;
  /** Plan mode: approve, edit or skip the spec before anything is generated. */
  planCtl: { on: boolean; setOn: (v: boolean) => void; choose: (msgId: string, choice: "build" | "skip", edited?: BuildPlan) => void };
  clarifyCtl: {
    answer: (msgId: string, qid: string, value: string) => void;
    build: (msgId: string, withAnswers: boolean) => void;
  };
  onRetryModel: (text: string, mode: Mode, value: string) => void;
  onExample: () => void;
  onTemplate: (t: Template) => void;
  onOpenTemplates: () => void;
  resume: string | null;
  onResume: () => void;
  geometry: THREE.BufferGeometry | null;
  dims: { x: number; y: number; z: number } | null;
  report: PrintabilityReport | null;
  analysisOverlay: { positions: Float32Array; colors: Float32Array } | null; // printability paint-on overlay
  printPrep: PrintPrepCtl;
  /** Which way drilled pockets open in this orientation — null when there are none. */
  pockets: PocketFacing | null;
  modelSelected: boolean;
  onModelSelect: (sel: boolean) => void;
  onScaleTo: (axis: "x" | "y" | "z", target: number) => void; // uniform-scale the part so `axis` hits target mm
  attachments: { id: string; geometry: THREE.BufferGeometry; name: string; tint?: string }[];
  selAttachIds: string[];
  onAttachSelect: (id: string | null, additive?: boolean) => void;
  onMergeAttachments: (ids?: string[]) => void;
  onEngraveAttachments: (ids: string[]) => void; // subtract instead of fuse — carved-in logos
  onAddLogo: (f: File) => void; // SVG straight in, PNG/JPG through the tracer
  onRemoveAttachment: (id: string) => void;
  partCount: number; // disconnected solids inside the model mesh (1 = a single part)
  separated: boolean; // the dry-fit sandbox is open (model was split into parts)
  separatedIds: string[]; // which objects came out of the split (shown grouped under the model)
  separatedKind: EngineKind | null; // engine kind of the model the split came from (Select shows disabled, not gone)
  onSeparateParts: () => void;
  onRegroup: () => void;
  onKeepAside: () => void; // duplicate the current model onto a new plate, then iterate
  exportPaint: { on: boolean; set: (v: boolean) => void; has: boolean }; // colours in the exported file, or plain
  onEditFrozen: (id: string) => void; // swap a duplicated version back to being the live editable model
  onCheckFit: (ids: string[]) => void;
  onMakeFit: (ids: string[]) => void;
  onDropToPlate: (ids: string[]) => void;
  onRenameAttachment: (id: string, name: string) => void;
  clipboardCtl: {
    canPaste: boolean;
    pasteName: string | null;
    copy: (t: { kind: "model" } | { kind: "attachment"; id: string }) => void;
    paste: () => void;
    duplicate: (t: { kind: "model" } | { kind: "attachment"; id: string }) => void;
  };
  snap: { move: number; rotate: number };
  setSnap: (s: { move: number; rotate: number }) => void;
  plateFor: (key: string) => number;
  plateCtl: {
    count: number;
    names: Record<number, string>; // user labels ("Lids", "Spares") — optional per plate
    rename: (n: number, name: string) => void;
    assign: (key: string, n: number) => void;
    add: () => number; // returns the new plate's number
    remove: (n: number) => void;
    exportEach: () => void;
    exportProject: () => void;
  };
  activePlate: number; // 0 = all
  setActivePlate: (n: number) => void;
  showcase: boolean;
  setShowcase: (v: boolean) => void;
  showcaseScene: ShowcaseScene;
  setShowcaseScene: (v: ShowcaseScene) => void;
  appearance: { color: string; finish: "matte" | "satin" | "glossy" | "metal" };
  setAppearance: (a: { color: string; finish: "matte" | "satin" | "glossy" | "metal" }) => void;
  partColors: Record<string, string>;
  setPartColor: (key: string, hex: string | null) => void;
  paintCtl: {
    mode: boolean; setMode: (v: boolean) => void;
    tool: "fill" | "brush" | "pick"; setTool: (t: "fill" | "brush" | "pick") => void;
    mirror: boolean; setMirror: (v: boolean) => void;
    pickSlot: (slot: number) => void;
    slot: number; setSlot: (n: number) => void;
    angle: number; setAngle: (n: number) => void;
    brushSize: number; setBrushSize: (n: number) => void;
    palette: string[];
    setSlotColor: (index: number, hex: string) => void; // recolour a filament slot to an exact hex
    facePaint: Uint8Array | null;
    onStroke: (tc: Uint8Array) => void;
    onEraseAll: () => void;
    hasPaint: boolean;
  };
  texture: THREE.Texture | null;
  onApplySurface: (pattern: SurfacePattern, scale: number, depth: number) => void;
  printer: PrinterDefaults;
  onOpenPrinterSettings: () => void;
  wireframe: boolean;
  setWireframe: (f: (w: boolean) => boolean) => void;
  gray: boolean; // View > Grayscale: hide baked mesh colors (display only)
  setGray: (v: boolean) => void;
  showPlate: boolean; // View > Build plate (solid slab under the model)
  setShowPlate: (v: boolean) => void;
  plateColor: string | null;
  gridOpacity: number;
  modelBadge: { label: string; color: string } | null; // which engine/AI made the model (Objects panel)
  showDims: boolean; // resolved visibility for the viewer (App folds mode + selection)
  dimsMode: "select" | "always" | "off";
  setDimsMode: (m: "select" | "always" | "off") => void;
  units: "mm" | "in";
  setUnits: (f: (u: "mm" | "in") => "mm" | "in") => void;
  viewerRef: RefObject<ViewerHandle>;
  onEmptyTap: () => void; // tap on empty canvas — put the tool down, close popups
  tab: "3d" | "code" | "params" | "print" | "history";
  setTab: (t: "3d" | "code" | "params" | "print" | "history") => void;
  codeText: string;
  streamingText: string;
  streamingThink: string; // live model reasoning while generating
  onRerun: (edited: string) => void;
  cadDefaults: CadParams | null;
  paramValues: CadParams;
  onApplyParams: (values: CadParams, editedKey?: string) => void;
  onLiveParams: (values: CadParams) => void; // mid-scrub rebuilds — no status flip, no error bubbles
  onSaveParams: () => void;
  onOpenSlicer: (t: SlicerTarget) => void;
  onRepair: () => void;
  onSimplify: () => void;
  onSplit: () => void;
  onFitToPlate: () => void;
  splitCtl: {
    pieces: (SplitPiece & { plate?: number })[] | null;
    toPlates: () => void; // every piece to its own build plate (exports honour it)
    plated: boolean;
    exportPiece: (index: number, format: "stl" | "3mf") => void;
    exportAll: (format: "stl" | "3mf") => void;
    clear: () => void;
  };
  versions: Version[];
  headId?: string; // which version the model is actually showing
  restoringId: string | null; // a restore is rebuilding this one right now
  onRestore: (id: string) => void;
  undoCtl: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; busy: boolean };
  supportsStep: boolean;
  canExport: (f: ExportFormat) => boolean;
  onExport: (f: ExportFormat) => void;
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onNew: () => void;
  onHome: () => void;
  pins: Pin[];
  pinCtl: {
    active: { pin: Pin; index: number; face: string } | null;
    text: string;
    setText: (s: string) => void;
    askAi: () => void;
    saveNote: () => void;
    del: () => void;
    clearAll: () => void;
    close: () => void;
    pick: (pt: PickedPoint) => void;
    select: (id: string) => void;
  };
  featureCtl: {
    mode: boolean;
    toggleMode: () => void;
    kind: SelectKind;
    setKind: (k: SelectKind) => void;
    /** Arm/disarm the Note (pin) tool — the one survivor of the old kind row. */
    togglePin: () => void;
    selected: PickedFeature | null;
    text: string;
    setText: (s: string) => void;
    pick: (f: PickedFeature) => void;
    pickFaces: (faces: PickedFeature[]) => void;
    askAi: () => void;
    directOp: (type: PointOp["type"], size: number) => void;
    pushArrow: { center: [number, number, number]; normal: [number, number, number]; kind: "extrude" | "fillet"; min?: number; max?: number } | null;
    pushPull: (distance: number) => void;
    pushLive: (distance: number, solid?: Float32Array | null, stop?: "min" | "max" | null) => void; // live drag value + optional boolean-preview prism + limit state
    liveMm: number | null;
    liveStop: "min" | "max" | null; // the drag is pinned at its limit
    clear: () => void;
  };
  /** Shape: drop a primitive exactly where you point, then type its numbers. No AI. */
  shapeCtl: {
    tool: { shape: "box" | "cylinder" | "sphere"; size: [number, number, number]; cut: boolean; snap: number } | null;
    set: (v: Props["shapeCtl"]["tool"]) => void;
    /** Arm or put down, standing every other tool down and turning picking on. */
    toggle: () => void;
    shapes: { index: number; shape: "box" | "cylinder" | "sphere"; cut: boolean; size: [number, number, number]; at: [number, number, number] }[];
    editIndex: number | null;
    select: (i: number | null) => void;
    edit: (i: number, patch: { shape?: "box" | "cylinder" | "sphere"; size?: [number, number, number]; at?: [number, number, number]; cut?: boolean }) => void;
    remove: (i: number) => void;
  };
  /** Modify: arm an op (push/round/bevel), then click a spot and drag its anchor — Spline's flow. */
  modifyCtl: {
    op: { op: "push" | "round" | "bevel"; size: number } | null;
    note: string | null; // why the last click did nothing (wrong feature for the op)
    set: (v: { op: "push" | "round" | "bevel"; size: number } | null) => void;
    /** Arm or put down, standing every other tool down and turning picking on. */
    toggle: () => void;
    apply: () => void; // apply the typed size to the selected feature (the no-drag path)
    /** Every rounding/bevel already on the part — editable, removable, resettable. */
    edges: { index: number; name: string; what: string; size: number }[];
    editIndex: number | null;
    select: (i: number | null) => void;
    edit: (i: number, size: number) => void;
    remove: (i: number) => void;
    reset: () => void;
  };
  facesCtl: {
    faces: PickedFeature[];
    text: string;
    setText: (s: string) => void;
    askAi: () => void;
    /** Apply the armed Modify operation to every pick in the set — local, no AI. What
     *  each one gets depends on whether it's a face, an edge or a corner. */
    directOp: (size: number) => void;
    clear: () => void;
  };
  transformCtl: {
    mode: TransformMode;
    setMode: (m: TransformMode) => void;
    commit: (c: TransformCommit) => void;
    rotateBy: (axis: "x" | "y" | "z", deg: number) => void; // exact typed rotation, rested on the plate
    busy: boolean;
  };
  resizeCtl: {
    dims: { x: number; y: number; z: number } | null;
    bed: { x: number; y: number; z: number };
    perAxis: boolean; // mesh models stretch per axis; CAD ops are uniform-only
    fits: boolean;
    busy: boolean;
    resize: (scale: [number, number, number]) => void;
    fitToPlate: () => void;
  };
  genTexCtl: { on: boolean; toggle: () => void };
  /** Pen cut: draw a line across the part and slice along it, with optional pins. */
  cutCtl: {
    mode: boolean;
    toggle: () => void;
    pending: boolean;       // a stroke is drawn and waiting to be applied
    onStroke: (s: { pts: [number, number, number][]; viewDir: [number, number, number] }) => void;
    stroke: { pts: [number, number, number][] } | null;
    apply: () => void;
    clear: () => void;      // throw the stroke away and draw again
    busy: boolean;
    connectors: boolean;
    setConnectors: (v: boolean) => void;
    pinSize: number;
    setPinSize: (v: number) => void;
  };
  /** Typed dimensions: take a measured distance to an exact number without the AI.
   *  `drivers` says what could legitimately move it; `apply` moves it. */
  dimCtl: {
    drivers: (measured: number, span?: [number, number, number]) => { kind: string; key?: string; axis?: string; label: string; current: number }[];
    apply: (driver: any, measured: number, target: number) => void;
  };
  measureCtl: {
    mode: boolean;
    toggle: () => void;
    pending: [number, number, number] | null;
    items: Measurement[];
    // A fresh measurement lives here until Save moves it into items — taps near
    // either end re-anchor it, so the flow is: two taps → adjust → Save.
    draft: Measurement | null;
    saveDraft: () => void;
    discardDraft: () => void;
    point: (p: [number, number, number]) => void;
    segment: (a: [number, number, number], b: [number, number, number]) => void;
    remove: (id: string) => void;
    clear: () => void;
  };
}

export function Workspace(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  // Composer grows with the text (up to ~5 lines) so long requests stay fully readable.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const growComposer = () => {
    const el = composerRef.current;
    if (!el) return;
    // Empty box stays one line tall: scrollHeight of an EMPTY textarea includes the
    // WRAPPED placeholder at narrow widths, which ballooned the box (real report).
    // 34px = the textarea inside the field pill (field padding brings it to 40).
    if (!el.value) {
      el.style.height = "34px";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  useEffect(growComposer, [p.input]); // covers dictation, sends (clear), and programmatic sets
  const [dragOver, setDragOver] = useState(false);
  const [dragOverCanvas, setDragOverCanvas] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoOver, setLogoOver] = useState(false);
  // Open beside the stage on desktop; on a phone the sheet starts in PEEK, because the
  // first thing a phone user should see is their model, not an empty transcript.
  const [chatOpen, setChatOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 760);
  // Transcript multi-select: null = off; a Set while picking. One confirm deletes the
  // whole selection — the per-message two-step stays for onesies, this is for sweeps.
  const [msgSel, setMsgSel] = useState<Set<string> | null>(null);
  const [msgSelConfirm, setMsgSelConfirm] = useState(false);
  const msgSelToggle = useCallback((id: string) => {
    setMsgSelConfirm(false);
    setMsgSel((s) => {
      if (!s) return s;
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const endMsgSel = () => { setMsgSel(null); setMsgSelConfirm(false); };
  // Which fastener the consolidated rail slot re-arms with (and shows as its icon).
  const [lastFastener, setLastFastener] = useState<"magnet" | "screw">("magnet");
  // Resizable chat column: drag the divider to trade chat width for 3D-viewer room
  // (most valuable on iPad-sized screens). Persisted; double-click resets.
  const CHAT_W_DEFAULT = 400;
  const clampChatW = (w: number) => Math.min(640, Math.max(280, Math.round(w)));
  const [chatW, setChatW] = useState(() => {
    try { const v = Number(localStorage.getItem("moldable_chat_w")); return Number.isFinite(v) && v > 0 ? clampChatW(v) : CHAT_W_DEFAULT; } catch { return CHAT_W_DEFAULT; }
  });
  const chatWRef = useRef(chatW);
  chatWRef.current = chatW;
  const chatResize = useRef<{ startX: number; startW: number } | null>(null);
  const saveChatW = (w: number) => { try { localStorage.setItem("moldable_chat_w", String(w)); } catch { /* private mode */ } };
  const [showStats, setShowStats] = useState(true); // mesh/print stats overlay in the 3D view
  const [showHelp, setShowHelp] = useState(false); // tools & gestures cheat-sheet overlay
  const [showLayers, setShowLayers] = useState(false); // legacy gate: context-menu Rename still opens Objects
  const [dockPanel, setDockPanel] = useState<DockPanel>("selection");
  // Open by default, EXCEPT where it would eat the canvas. The dock is a fixed 262px
  // panel; on a phone the viewer is ~374px wide, so it covered 70% of the 3D view before
  // you had seen the model at all. Measured once at mount — resizing later is the user's
  // own doing and should not slam their panel shut.
  const [dockOpen, setDockOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 760);
  // Section list: named rows for a first visit (nothing to learn the icons from yet),
  // packed to icons from the first pick onward — and the choice sticks after that.
  const [navNames, setNavNamesState] = useState(() => localStorage.getItem("moldable_dock_names") !== "0");
  const setNavNames = (v: boolean) => {
    setNavNamesState(v);
    try { localStorage.setItem("moldable_dock_names", v ? "1" : "0"); } catch { /* private mode */ }
  };
  // Resizable like the chat: same clamp-ref-persist pattern, opposite edge. The layers
  // list and the parameter rows were designed into 262px; on a big screen there is no
  // reason the Inspector cannot have the room the chat gets.
  const DOCK_W_DEFAULT = 262;
  const clampDockW = (w: number) => Math.min(520, Math.max(230, Math.round(w)));
  const [dockW, setDockW] = useState(() => {
    try { const v = Number(localStorage.getItem("moldable_dock_w")); return Number.isFinite(v) && v > 0 ? clampDockW(v) : DOCK_W_DEFAULT; } catch { return DOCK_W_DEFAULT; }
  });
  const dockWRef = useRef(dockW);
  dockWRef.current = dockW;
  const dockResize = useRef<{ startX: number; startW: number } | null>(null);
  const saveDockW = (w: number) => { try { localStorage.setItem("moldable_dock_w", String(w)); } catch { /* private mode */ } };
  // A pick is a request to inspect it: bring Selection forward rather than leaving the
  // description behind whichever panel happened to be open.
  const picked = !!p.featureCtl.selected || p.facesCtl.faces.length > 0;
  useEffect(() => { if (picked) { setDockPanel("selection"); setDockOpen(true); } }, [picked]);
  const dockLabel = DOCK_ITEMS.find((d) => d.key === dockPanel)?.label ?? "";
  // The phone shell (skills/mobile-ux): chat becomes a bottom sheet whose collapsed
  // "peek" is just the composer, and chatOpen flips peek <-> full instead of hiding
  // the panel behind a side rail.
  const phone = useMediaQuery("(max-width: 760px)");
  // Phone: a build landing is the payoff, so the sheet drops back to its peek and
  // hands the screen to the model — it had been keeping ~62% of a 844px phone for
  // a two-line reply, leaving the 3D view a 240px strip. Swipe up to read on.
  const lastGeom = useRef(p.geometry);
  useEffect(() => {
    if (phone && p.geometry && p.geometry !== lastGeom.current) {
      setChatOpen(false);
      // Re-frame after the sheet has finished collapsing: the canvas roughly
      // triples in height, and a camera framed for the old strip leaves the part
      // cropped against the edges.
      const t = setTimeout(() => p.viewerRef.current?.resetView(), 340);
      lastGeom.current = p.geometry;
      return () => clearTimeout(t);
    }
    lastGeom.current = p.geometry;
  }, [p.geometry, phone]);
  // While a finger is on the model, floating chrome steps back — the video-player
  // contract. Phone only: on desktop the pointer lives on the canvas half the time.
  const [stageBusy, setStageBusy] = useState(false);
  useEffect(() => {
    if (!stageBusy) return;
    const up = () => setStageBusy(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [stageBusy]);
  void showLayers; void setShowLayers; // retained: context-menu Rename still drives this
  const [ctx, setCtx] = useState<ContextHit | null>(null); // right-click quick-action menu
  const [renaming, setRenaming] = useState<string | null>(null); // "model" | attachment id being renamed
  const [markMode, setMarkMode] = useState(false); // "circle it and ask" draw overlay
  // Mark's state lives HERE while Select/Transform/Measure/Paint live in App, so nothing
  // kept them mutually exclusive — Mark and Measure could both render as armed at once.
  // One direction is this effect (another tool wins → Mark stands down); the other is in
  // Mark's own onClick, which disarms the rest before arming itself.
  const otherToolOn = p.featureCtl.mode || p.measureCtl.mode || p.cutCtl.mode || p.transformCtl.mode !== "off" || p.paintCtl.mode || !!p.magnetCtl.tool || !!p.screwCtl.tool;
  useEffect(() => { if (otherToolOn) setMarkMode(false); }, [otherToolOn]);

  // Paste a reference image from the clipboard anywhere in the app.
  const pickRef = useRef(p.onPickImage);
  pickRef.current = p.onPickImage;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            pickRef.current(f);
          }
          return;
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const enginePill =
    p.activeKind === "replicad" ? "Engine · replicad" : p.activeKind === "generative" ? `Engine · ${p.genLabel}` : "Engine · primitive";

  // How many objects sit on each plate — feeds the plate tabs' badges.
  const plateCounts = new Map<number, number>();
  const bumpPlate = (n: number) => plateCounts.set(n, (plateCounts.get(n) ?? 0) + 1);
  if (p.geometry) bumpPlate(p.plateFor("model"));
  for (const a of p.attachments) bumpPlate(p.plateFor(a.id));

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    setDragOverCanvas(false);
    // ALL usable files, not the first: extra photos become unlabelled references.
    const fs = Array.from(e.dataTransfer.files).filter((x) => x.type.startsWith("image/") || /\.(svg|glb|gltf|stl|step|stp|shapr)$/i.test(x.name));
    if (fs.length) p.onPickImages(fs);
  }

  const objectsPanel = (
                <div className="layers-panel" role="region" aria-label="Objects on the canvas">
                  <div className="lp-head"><b>Objects</b><button className="x" aria-label="Close objects" onClick={() => setDockPanel("selection")}><IconX /></button></div>
                  <div className="lp-plates">
                    {[0, ...Array.from({ length: p.plateCtl.count }, (_, i) => i + 1)].map((n) => (
                      <button key={n} className={p.activePlate === n ? "on" : ""} title={n === 0 ? "Show every plate" : `Show only plate ${n}`} onClick={() => p.setActivePlate(n)}>{n === 0 ? "All" : `P${n}`}</button>
                    ))}
                    <button className="lp-add" title="Add a build plate" onClick={() => p.plateCtl.add()}>+</button>
                  </div>
                  <div className={`lp-row${p.modelSelected ? " on" : ""}${p.geometry ? "" : " static"}`} style={{ cursor: p.geometry ? "pointer" : "default" }} title="Select the whole part (shows its bounding box) — double-click the name to rename" onClick={() => p.geometry && p.onModelSelect(!p.modelSelected)}>
                    <IconCube />
                    <EditableName name={p.projectName} className="lp-name" editing={renaming === "model"} onStartEdit={() => setRenaming("model")} onRename={p.onRename} onDone={() => setRenaming(null)} />
                    {p.modelBadge && p.geometry && (
                      <span className="lp-badge" style={{ color: p.modelBadge.color, borderColor: p.modelBadge.color }} title={`Made by ${p.modelBadge.label}`}>
                        {p.modelBadge.label}
                      </span>
                    )}
                    {p.geometry && <ColorSwatch label={p.projectName} color={p.partColors["model"]} onPick={(hex) => p.setPartColor("model", hex)} />}
                    {p.geometry && <PlateMenu value={p.plateFor("model")} count={p.plateCtl.count} names={p.plateCtl.names} onPick={(n) => p.plateCtl.assign("model", n)} onNewPlate={() => p.plateCtl.assign("model", p.plateCtl.add())} />}
                    {p.dims && <span className="lp-sub">{p.dims.x}×{p.dims.y}×{p.dims.z}</span>}
                  </div>
                  {p.geometry && (
                    <button className="ghost sm lp-keep" title="Freeze a copy of the model on its own build plate, beside the live one — then ask for the next variant without losing this version"
                      onClick={p.onKeepAside}>
                      Duplicate
                    </button>
                  )}
                  {(() => {
                    const sepSet = new Set(p.separatedIds);
                    const grouped = p.attachments.filter((a) => sepSet.has(a.id));
                    const loose = p.attachments.filter((a) => !sepSet.has(a.id));
                    const row = (a: { id: string; name: string }, sub: boolean) => {
                      const on = p.selAttachIds.includes(a.id);
                      return (
                        <div key={a.id} className={`lp-row${on ? " on" : ""}${sub ? " sub" : ""}`} style={{ cursor: "pointer" }} title={`${a.name} — click to select, double-click the name to rename`} onClick={(e) => p.onAttachSelect(a.id, e.shiftKey)}>
                          {sub && <span className="lp-tie" aria-hidden="true">└</span>}
                          <input type="checkbox" className="lp-check" checked={on} aria-label={`Group-select ${a.name}`} onClick={(e) => e.stopPropagation()} onChange={() => p.onAttachSelect(a.id, true)} />
                          <ColorSwatch label={a.name} color={p.partColors[a.id]} fallback="#7fc4b9" onPick={(hex) => p.setPartColor(a.id, hex)} />
                          <EditableName name={a.name} className="lp-name" editing={renaming === a.id} onStartEdit={() => setRenaming(a.id)} onRename={(v) => p.onRenameAttachment(a.id, v)} onDone={() => setRenaming(null)} />
                          <PlateMenu value={p.plateFor(a.id)} count={p.plateCtl.count} names={p.plateCtl.names} onPick={(n) => p.plateCtl.assign(a.id, n)} onNewPlate={() => p.plateCtl.assign(a.id, p.plateCtl.add())} />
                          {(a as { frozenSource?: unknown }).frozenSource != null && (
                            <button className="lp-edit" title="Edit this version — it becomes the live model; the current live model is duplicated in its place"
                              onClick={(e) => { e.stopPropagation(); p.onEditFrozen(a.id); }}>Edit</button>
                          )}
                          <button className="x" aria-label={`Remove ${a.name}`} onClick={(e) => { e.stopPropagation(); p.onRemoveAttachment(a.id); }}><IconX /></button>
                        </div>
                      );
                    };
                    return (
                      <>
                        {grouped.length > 0 && <div className="lp-group">Separated from the model — Regroup or Merge rejoins them</div>}
                        {grouped.map((a) => row(a, true))}
                        {(p.splitCtl.pieces ?? []).map((pc, i) => (
                          <div key={`pc${i}`} className="lp-row static">
                            <span className="lp-dot" style={{ background: pc.color }} /><span className="lp-name">Piece {i + 1}</span>
                            <span className="lp-sub">{pc.dims.x}×{pc.dims.y}×{pc.dims.z}</span>
                          </div>
                        ))}
                        {loose.map((a) => row(a, false))}
                      </>
                    );
                  })()}
                  {p.geometry && (p.separated ? (
                    <button
                      className="ghost sm"
                      style={{ width: "100%", marginTop: 6 }}
                      title="Put the model back exactly as it was before separating (same as Undo while parts are separated)"
                      onClick={p.onRegroup}
                    >
                      Regroup parts
                    </button>
                  ) : p.partCount > 1 ? (
                    <button
                      className="ghost sm"
                      style={{ width: "100%", marginTop: 6 }}
                      title="Ungroup the model's disconnected solids (like a box printed beside its lid) so each moves on its own — check the clearance, then Merge to keep it or Undo to regroup"
                      onClick={p.onSeparateParts}
                    >
                      Separate {p.partCount} parts
                    </button>
                  ) : null)}
                  {p.selAttachIds.length > 0 && (
                    <div className="lp-fitrow">
                      <button className="ghost sm" title="Does it fit here? Computes the real overlap between the selected part(s) and the model — zero overlap means no collision at this position" onClick={() => p.onCheckFit(p.selAttachIds)}>
                        Check clearance
                      </button>
                      <button className="ghost sm" title="For parts that nest into each other: carve the selected part's shape (+0.2 mm clearance) out of the model at its current position, so it can slot in" onClick={() => p.onMakeFit(p.selAttachIds)}>
                        Cut to fit
                      </button>
                      <button className="ghost sm" title="Settle the selected part(s) back down onto the build plate (keeps position and rotation)" onClick={() => p.onDropToPlate(p.selAttachIds)}>
                        Drop to plate
                      </button>
                    </div>
                  )}
                  {p.attachments.length > 0 && (
                    <button className="primary sm" style={{ width: "100%", marginTop: 6 }} title="Fuse into ONE printable solid (Undo brings the pieces back)" onClick={() => p.onMergeAttachments(p.selAttachIds.length > 1 ? p.selAttachIds : undefined)}>
                      {p.selAttachIds.length > 1 ? `Merge selected (${p.selAttachIds.length})` : "Merge all into model"}
                    </button>
                  )}
                  {p.selAttachIds.length > 0 && (
                    <button className="ghost sm" style={{ width: "100%", marginTop: 6 }} title="Carve the selected part's shape INTO the model wherever they overlap — an engraved logo or relief (Undo brings the layer back)" onClick={() => p.onEngraveAttachments(p.selAttachIds)}>
                      Engrave into model
                    </button>
                  )}
                  {p.pins.map((pin, i) => (
                    <button key={pin.id} className={`lp-row${p.pinCtl.active?.pin.id === pin.id ? " on" : ""}`} title="Select this point marker" onClick={() => p.pinCtl.select(pin.id)}>
                      <span className="lp-dot pin">{i + 1}</span><span className="lp-name">{pin.text ? pin.text.slice(0, 26) : `Point ${i + 1}`}</span>
                    </button>
                  ))}
                  {p.measureCtl.items.map((mm, i) => (
                    <MeasureRow key={mm.id} m={mm} index={i} ctl={p.measureCtl} dimCtl={p.dimCtl} busy={p.status === "generating"} />
                  ))}
                  {!p.geometry && <div className="lp-empty">Nothing on the canvas yet</div>}
                </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {/* The wordmark is the way back to the Launchpad — the convention every app
              on the web shares. It used to be a duplicate "+ New chat", so the start
              screen had no route back at all short of a reload. Your part is not
              discarded: it returns as the resume chip. */}
          <button className="brandbtn" onClick={p.onHome} title="Back to the start screen (your part is kept)" aria-label="Moldable — back to the start screen">
            <CubeMark />
            <span className="wordmark">Moldable</span>
          </button>
          <span className="sep">/</span>
          <ProjectTitle name={p.projectName} onRename={p.onRename} />
        </div>
        <div className="topbar-right">
          <span className={`pill ${p.activeKind === "primitive" ? "pill-warn" : ""}`}>{enginePill}</span>
          {/* Navigation, not actions: these read as text with an underline on hover.
              Only "+ New chat" keeps a filled button, because it is the one thing here
              that CHANGES something. Boxing all four made none of them primary. */}
          <button className="navlink" onClick={p.onOpenTemplates}>Templates</button>
          <button className="navlink" onClick={p.onOpenLibrary}>Library</button>
          <button className="primary sm" onClick={p.onNew} title="Start a fresh chat & model (your current one stays in the Library)">+ New chat</button>
          {/* The two icons are stacked and cross-faded rather than swapped, so the
              switch is one continuous motion instead of a pop. */}
          <button
            className={`theme-toggle${p.theme === "dark" ? " is-dark" : ""}`}
            onClick={p.onToggleTheme}
            title={p.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle dark mode"
            aria-pressed={p.theme === "dark"}
          >
            <span className="tt-ico tt-sun"><IconSun /></span>
            <span className="tt-ico tt-moon"><IconMoon /></span>
          </button>
          <div className="profile-wrap">
            <button
              className="ghost profile"
              onClick={() => (p.accountEmail ? setProfileMenu((v) => !v) : p.onOpenProfile())}
              title={p.accountEmail ? `${p.accountEmail} — account menu` : "Sign in & settings"}
              aria-label="Account menu"
              aria-expanded={profileMenu}
            >
              {p.avatar ? <span className="avatar"><img src={p.avatar} alt="" /></span>
                : p.accountEmail ? <span className="avatar">{p.accountEmail[0].toUpperCase()}</span>
                  : <IconUser />}
            </button>
            {profileMenu && p.accountEmail && (
              <div className="profile-menu" onMouseLeave={() => setProfileMenu(false)}>
                <div className="pm-head">
                  <span className="pm-avatar">{p.avatar ? <img src={p.avatar} alt="" /> : p.accountEmail[0].toUpperCase()}</span>
                  <span className="pm-who">
                    <span className="pm-label">Signed in</span>
                    <span className="pm-email">{p.accountEmail}</span>
                  </span>
                </div>
                <button className="pm-item" onClick={() => { setProfileMenu(false); p.onNew(); }}>New chat</button>
                <button className="pm-item" onClick={() => { setProfileMenu(false); p.onOpenLibrary(); }}>Library</button>
                <button className="pm-item" onClick={() => { setProfileMenu(false); p.onOpenSettings(); }}>Settings</button>
                <button className="pm-item" onClick={() => { setProfileMenu(false); p.onOpenProfile(); }}>Account &amp; sync</button>
                <button className="pm-item" onClick={() => { setProfileMenu(false); p.onToggleTheme(); }}>{p.theme === "dark" ? "Light mode" : "Dark mode"}</button>
                <div className="pm-sep" />
                <button className="pm-item danger" onClick={() => { setProfileMenu(false); p.onSignOut(); }}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {p.fellBack && (
        <div className="banner">
          3D CAD kernel unavailable — Precise mode is using the simple <b>primitive</b> engine (STEP export off).
          {p.bootError ? <span className="banner-detail"> ({p.bootError})</span> : null}
        </div>
      )}

      {p.authNotice && (
        <div className="banner ok" role="status">
          {p.authNotice}
          <button className="banner-x" aria-label="Dismiss" onClick={p.onDismissAuthNotice}>×</button>
        </div>
      )}

      {p.ollamaOffer && (
        <div className="banner ok" role="status">
          Ollama found on this machine with {p.ollamaOffer.count} local model{p.ollamaOffer.count === 1 ? "" : "s"} — builds run free, private and offline.
          <button className="ghost sm" onClick={() => p.ollamaOffer!.onUse(p.ollamaOffer!.model)}>Use {p.ollamaOffer.model}</button>
          <button className="banner-x" aria-label="Dismiss" onClick={p.ollamaOffer.onDismiss}>×</button>
        </div>
      )}

      <main className={`split${chatOpen ? "" : " chat-collapsed"}`} style={{ "--chat-w": `${chatW}px` } as CSSProperties}>
        {!chatOpen && !phone && (
          <button className="chat-rail" title="Show chat" aria-label="Show chat" onClick={() => setChatOpen(true)}>
            <span className="chat-rail-label">Chat ›</span>
          </button>
        )}
        <section
          className={`chat ${dragOver ? "drop" : ""}${phone ? ` sheet ${chatOpen ? "open" : "peek"}` : ""}`}
          style={chatOpen || phone ? undefined : { display: "none" }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {/* Phone only (CSS hides it wider): the sheet's handle. Tap toggles peek
              (composer alone) and full (transcript + controls) — the model keeps the
              screen until the conversation is asked for. */}
          <button className="sheet-grab" aria-expanded={chatOpen} aria-label={chatOpen ? "Collapse chat" : "Expand chat"} onClick={() => setChatOpen(!chatOpen)}>
            <span className="sheet-grab-pill" aria-hidden="true" />
          </button>
          <div className="chat-bar">
            <span className="chat-title">Chat</span>
            {msgSel ? (
              /* Selection header: the count IS the state, and the whole sweep rides on
                 ONE confirm — the reason this mode exists at all. */
              <span className="chat-selbar">
                <span className="chat-date">{msgSel.size} selected</span>
                <button className="chat-hide" onClick={() => { setMsgSelConfirm(false); setMsgSel(new Set(p.messages.map((m) => m.id))); }}>All</button>
                {msgSelConfirm ? (
                  <button className="chat-hide danger" onClick={() => { p.onDeleteMessages([...msgSel]); endMsgSel(); }}>Really delete {msgSel.size}?</button>
                ) : (
                  <button className="chat-hide danger" disabled={msgSel.size === 0} onClick={() => setMsgSelConfirm(true)}>Delete {msgSel.size || ""}</button>
                )}
                <button className="chat-hide" onClick={endMsgSel}>Cancel</button>
              </span>
            ) : (
              <>
                {/* Today, in words — the transcript below is undated, so the head carries
                    the one timestamp the session needs. */}
                <span className="chat-date">{chatDate()}</span>
                <span className="chat-selbar">
                  {p.messages.length > 1 && (
                    <button className="chat-hide" title="Pick several messages and delete them in one go" onClick={() => setMsgSel(new Set())}>Select</button>
                  )}
                  <button className="chat-hide" title="Hide chat" onClick={() => setChatOpen(false)}>Hide</button>
                </span>
              </>
            )}
          </div>
          <Messages messages={p.messages} thinking={p.streamingThink} onChip={p.onSend} onExample={p.onExample} onTemplate={p.onTemplate} onOpenTemplates={p.onOpenTemplates} onStartGuided={p.onStartGuided} resume={p.resume} onResume={p.onResume} status={p.status}
            brain={p.brain} hasBrainKey={p.hasBrainKey} genProvider={p.genProvider} genModel={p.genModel} hasGenKey={p.hasGenKey} onRetryModel={p.onRetryModel} clarifyCtl={p.clarifyCtl} confirmCtl={p.confirmCtl} planCtl={p.planCtl} onDeleteMessage={p.onDeleteMessage}
            selecting={msgSel} onToggleSelect={msgSelToggle} />

          {p.providerWall && (
          <div className="wall-card" role="status">
            <b>Precise CAD needs an AI provider.</b>
            <p className="wall-prompt">“{p.providerWall}”</p>
            <div className="wall-actions">
              <button className="primary sm" onClick={p.onWallMesh}>Build it as a mesh now</button>
              <button className="ghost sm" onClick={p.onWallAddKey}>Add a free Gemini key</button>
              <button className="ghost sm" onClick={p.onWallRetry}>Try again</button>
              <button className="x" aria-label="Dismiss" onClick={p.onWallDismiss}><IconX /></button>
            </div>
            <p className="fine">A mesh needs no key at all — you get geometry either way.</p>
          </div>
        )}
        <div className="composer-wrap">
            <div className="modebar">
              {/* Figma order, top to bottom: WHO builds it (Model row), HOW it builds
                  (mode seg), then the ask itself. One decision per row. */}
              <div className="modebar-row modebar-model">
                <span className="mb-label">Model</span>
                {p.modePref !== "generative" ? (
                  <BrainPicker brain={p.brain} hasKey={p.hasBrainKey} onPick={p.onPickBrain} />
                ) : (
                  <EnginePicker provider={p.genProvider} model={p.genModel} hasKey={p.hasGenKey} onPick={p.onPickEngine} />
                )}
                {/* Research, Plan and Fit are set-once-and-forget: three permanent
                    chips wrapped this row onto a second line and stole ~40px above
                    the input forever. They live behind one button now, which states
                    how many are off their default so nothing hides silently. */}
                <BuildOptions p={p} />
              </div>
              <div className="modebar-row">
                <div className="seg">
                  <button className={p.modePref === "auto" ? "on auto-live" : ""} title="Auto — just describe what you want to print and the app picks the right engine for you: exact CAD for functional parts, AI mesh for organic shapes" onClick={() => p.pickMode("auto")}>Auto</button>
                  <button className={p.modePref === "precise" ? "on" : ""} title="Precise (CAD) — exact, editable, dimensioned parts · STEP export" onClick={() => p.pickMode("precise")}>Precise (CAD)</button>
                  <button className={p.modePref === "generative" ? "on" : ""} title="Generative (AI mesh) — organic / sculptural shapes from text or a photo" onClick={() => p.pickMode("generative")}>Generative (AI mesh)</button>
                </div>
                <Hint text="How the shape gets made. Precise builds exact, editable millimetre parts you can export as STEP — brackets, cases, adapters. Generative builds an organic AI mesh — figurines, sculpted shapes — which cannot be dimensioned. Auto reads your description and picks for you." />
              </div>
              {/* This line renders ONLY when it says something you could not already
                  read off the controls. It used to restate the mode on every idle
                  frame ("Describe what you want to print — Auto picks…"), which is
                  what the ? beside Auto is for, and cost a whole row above the input
                  for nothing. Now it appears for what Auto actually chose, for the
                  photo/markup states, and for generative pricing. */}
              {(() => {
                const line = p.autoPick
                  ? p.autoPick
                  : p.modePref === "precise"
                    ? p.guided
                      ? "Replacement part — clearance is added to fitted features"
                      : p.imageUrl
                        ? p.imageMarkup
                          ? "Marked screenshot → the change goes where you circled"
                          : "Photo → exact CAD replacement (vision)"
                        : null
                    : p.modePref === "generative"
                      ? p.genProvider === "auto"
                        ? "Auto shows the engine & price when you send"
                        : costLabel(p.genProvider, p.genModel) || null
                      : null;
                return line ? <span className="modehint">{line}</span> : null;
              })()}
              <div className="modebar-row modebar-gen">
              {p.mode === "generative" && (
                <button
                  className={`texchip${p.genTexCtl.on ? " on" : ""}`}
                  aria-pressed={p.genTexCtl.on}
                  title={p.genTexCtl.on
                    ? "Baked color textures ON — pretty previews, but paid engines charge extra for texturing (Hunyuan ~3×) and the colors don't survive single-filament printing. Tap for print-first gray."
                    : "Print-first: geometry only, no baked textures — a clean gray mesh (what your print will look like) at the lower engine price. Tap to bake colors."}
                  onClick={p.genTexCtl.toggle}
                >
                  {p.genTexCtl.on ? "🎨 Color: on" : "⬜ Color: off — print-first"}
                </button>
              )}
              </div>
            </div>

            {p.imageUrl && (
              <div className="imgchip">
                <img src={p.imageUrl} alt={p.imageMarkup ? "marked screenshot" : "reference"} />
                <span>
                  {p.imageMarkup ? `marked screenshot${p.imageNote ? ` · ${p.imageNote}` : ""} — describe the change` : p.refsCount > 0 ? `${p.refsCount + 1} reference pictures` : "reference picture"}
                  {!p.imageMarkup && <Hint text={p.photoAdvice} />}
                </span>
                {p.mode === "precise" && !p.imageMarkup && (
                  <button className="imgchip-measure" title="Measure real dimensions from this photo" onClick={p.onMeasure}>Measure</button>
                )}
                <button aria-label="Remove reference image" onClick={p.onClearImage}><IconX /></button>
              </div>
            )}

            {/* Shown for ANY engine now: extra angles help the CAD path just as much
                as the mesh engines (one photo leaves the far side to guesswork), and
                hiding this in Generative meant nobody in Auto ever found it. */}
            {p.imageUrl && !p.imageMarkup && (
              <MultiViewRow views={p.views} onPick={p.onPickView} onClear={p.onClearView} multiViewEngine={p.multiViewEngine} mode={p.mode} />
            )}

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                p.onSend(p.input);
                // Sending from the collapsed sheet opens it — the reply streams into
                // the transcript, and a reply nobody can see reads as a hang.
                if (phone && !chatOpen) setChatOpen(true);
              }}
            >
              {/* One field, everything inside it (the launchpad's pattern): clip on the
                  left where every chat app keeps it, actions on the right. The textarea
                  ends BEFORE the send button, so its scrollbar no longer hides under it. */}
              <div className="compose-field">
                <button
                  type="button"
                  className="attach"
                  title={`Upload photos or sketches → 3D. ${p.photoAdvice}`}
                  aria-label="Upload photos or sketches to turn into a 3D model"
                  onClick={() => fileRef.current?.click()}
                >
                  <IconPaperclip />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.svg,.glb,.gltf,.stl,.step,.stp,.shapr"
                  multiple
                  hidden
                  onChange={(e) => {
                    const fs = Array.from(e.target.files ?? []);
                    if (fs.length) p.onPickImages(fs);
                    e.currentTarget.value = "";
                  }}
                />
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={p.input}
                  onFocus={() => p.onComposerFocus?.()}
                  onChange={(e) => p.setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends (Shift+Enter = new line), like every chat app.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    p.mode === "generative"
                      ? "Describe it, or upload / paste a photo…"
                      : p.imageUrl
                        ? p.imageMarkup
                          ? "What should change in the circled region? (e.g. flatten this, make it 3 mm thicker)…"
                          : "Add known measurements (e.g. 32 mm wide, M4 holes) — they override estimates…"
                        : p.guided
                          ? "Upload a photo of the part, or describe it with any measurements…"
                          : "What would you like to build?"
                  }
                />
                {/* A button, not an always-on pass. Rewriting what someone typed on their
                    behalf, silently, is the one thing this app should never do to a
                    description that becomes a physical object — so the rewrite is asked
                    for, shown in the box, and revertible before it is ever sent. */}
                <button
                  type="button"
                  className={`improve${p.improveCtl.busy ? " busy" : ""}`}
                  title="Improve this description — fills in the measurements and details a buildable request needs. Uses your reference photo too."
                  aria-label="Improve this description"
                  disabled={!p.improveCtl.can || p.improveCtl.busy || p.status === "generating"}
                  onClick={p.improveCtl.run}
                >
                  {p.improveCtl.busy ? <span className="spinner sm" /> : <IconSparkle size={15} />}
                </button>
                <MicButton value={p.input} onChange={p.setInput} />
                <button type="submit" className="send" aria-label="Send" disabled={p.status === "generating"}><IconArrowUp /></button>
              </div>
            </form>

            {(p.improveCtl.before !== null || p.improveCtl.note) && (
              <div className="improve-note" role="status">
                {p.improveCtl.before !== null ? (
                  <>
                    <span>Rewritten to be buildable.</span>
                    <button className="link sm" onClick={p.improveCtl.undo}>Use what I wrote</button>
                  </>
                ) : (
                  <>
                    <span>{p.improveCtl.note}</span>
                    <button className="x" aria-label="Dismiss" onClick={p.improveCtl.dismissNote}><IconX /></button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {chatOpen && (
          <div
            className="chat-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            title="Drag to resize the chat — double-click to reset"
            onPointerDown={(e) => {
              e.preventDefault(); // keep iPadOS from treating the pen/touch drag as a scroll
              chatResize.current = { startX: e.clientX, startW: chatWRef.current };
              try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
            }}
            onPointerMove={(e) => {
              const r = chatResize.current;
              if (!r) return;
              setChatW(clampChatW(r.startW + (e.clientX - r.startX)));
            }}
            onPointerUp={(e) => {
              if (!chatResize.current) return;
              chatResize.current = null;
              try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* already lost */ }
              saveChatW(chatWRef.current);
            }}
            onPointerCancel={() => { chatResize.current = null; }}
            onDoubleClick={() => { setChatW(CHAT_W_DEFAULT); saveChatW(CHAT_W_DEFAULT); }}
          />
        )}

        <section
          className={`viewer${p.tab === "params" ? " params-docked" : ""}${dragOverCanvas ? " drop" : ""}${stageBusy ? " stage-busy" : ""}`}
          style={{ "--dock-w": `${dockOpen ? dockW : 0}px` } as CSSProperties}
          onDragOver={(e) => { e.preventDefault(); setDragOverCanvas(true); }}
          onDragLeave={() => setDragOverCanvas(false)}
          onDrop={onDrop}
        >
          <div className="viewer-head">
              {/* One pill, top-left. The tab strip that used to sit here duplicated the
                  Inspector's section list one-for-one (every tab was setDockPanel), so
                  it's gone — the sections' icons moved onto the Inspector rows, and the
                  editing toolbar takes the corner the tabs occupied. */}
              {(p.tab === "3d" || p.tab === "params") && (
                <div className="viewer-tools">
                  <div className="seg sm">
                    <button className="iconbtn" title="Undo (⌘/Ctrl+Z)" aria-label="Undo" disabled={!p.undoCtl.canUndo || p.undoCtl.busy} onClick={p.undoCtl.undo}><IconUndo /></button>
                    <button className="iconbtn" title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo" disabled={!p.undoCtl.canRedo || p.undoCtl.busy} onClick={p.undoCtl.redo}><IconRedo /></button>
                  </div>
                  {/* Size and snapping live here, not in the Transform flyout: they're
                      settings you change at any time, so they shouldn't be buried behind
                      a tool (and they used to float loose on the canvas). */}
                  {(p.tab === "3d" || p.tab === "params") && (
                    <>
                      <ResizeMenu ctl={p.resizeCtl} />
                      <SnapMenu snap={p.snap} setSnap={p.setSnap} />
                    </>
                  )}
                  <ViewMenu
                    dimsMode={p.dimsMode}
                    setDimsMode={p.setDimsMode}
                    wireframe={p.wireframe}
                    setWireframe={p.setWireframe}
                    gray={p.gray}
                    setGray={p.setGray}
                    plate={p.showPlate}
                    setPlate={p.setShowPlate}
                    stats={showStats}
                    setStats={setShowStats}
                    units={p.units}
                    setUnits={p.setUnits}
                    showcase={p.showcase}
                    setShowcase={p.setShowcase}
                    overhangOn={p.printPrep.overhangOn}
                    toggleOverhang={p.printPrep.toggleOverhang}
                    onResetView={() => p.viewerRef.current?.resetView()}
                  />
                  <button className={`ghost sm iconbtn${showHelp ? " on" : ""}`} aria-pressed={showHelp} aria-label="Help" title="What every tool and gesture does" onClick={() => setShowHelp((h) => !h)}>
                    <IconHelp />
                  </button>
                </div>
              )}
          </div>

          {/* --dock-w lives on the SECTION, not here: the head is a sibling of this div
              and needs the same number to keep its pills clear of the Inspector card. */}
          <div className="viewer-body" onPointerDown={phone ? (e) => { if ((e.target as HTMLElement).tagName === "CANVAS") setStageBusy(true); } : undefined}>
            {/* The stage is never hidden: every panel now docks beside it. */}
            <div style={{ display: "block", height: "100%" }}>
              <Viewer
                ref={p.viewerRef}
                // Click empty canvas = "put it down": closes this panel's own popups
                // and hands off to the app for the tools and selection.
                onEmptyTap={() => {
                  setMarkMode(false);
                  setShowLayers(false);
                  setShowHelp(false);
                  p.onEmptyTap();
                }}
                geometry={p.geometry}
                analysisOverlay={p.analysisOverlay}
                wireframe={p.wireframe}
                clay={p.gray}
                bed={{ x: p.printer.bed.x, y: p.printer.bed.y, z: p.printer.bed.z }}
                showPlate={p.showPlate}
                plateColor={p.plateColor}
                gridOpacity={p.gridOpacity}
                showDims={p.showDims}
                units={p.units}
                theme={p.theme}
                pins={p.pins}
                selectedPin={p.pinCtl.active?.pin.id ?? null}
                selectMode={p.featureCtl.mode}
                selectKind={p.featureCtl.kind}
                featureSelected={!!p.featureCtl.selected}
                boxSelectionActive={p.facesCtl.faces.length > 0}
                modelSelected={p.modelSelected}
                onModelSelect={p.onModelSelect}
                attachments={p.attachments}
                selAttachIds={p.selAttachIds}
                visiblePlate={p.activePlate}
                plateCount={p.plateCtl.count}
                plateFor={p.plateFor}
                showcase={p.showcase}
                showcaseScene={p.showcaseScene}
                onAttachSelect={p.onAttachSelect}
                snap={p.snap}
                appearance={p.appearance}
                partColors={p.partColors}
                cutMode={p.cutCtl.mode}
                onCutStroke={p.cutCtl.onStroke}
                cutStroke={p.cutCtl.stroke}
                paintMode={p.paintCtl.mode}
                paintTool={p.paintCtl.tool}
                paintMirror={p.paintCtl.mirror}
                onPickSlot={p.paintCtl.pickSlot}
                paintSlot={p.paintCtl.slot}
                paintAngle={p.paintCtl.angle}
                brushSize={p.paintCtl.brushSize}
                paintPalette={p.paintCtl.palette}
                facePaint={p.paintCtl.facePaint}
                onPaintStroke={p.paintCtl.onStroke}
                texture={p.texture}
                transformMode={p.transformCtl.mode}
                measureMode={p.measureCtl.mode}
                measurePending={p.measureCtl.pending}
                measurements={p.measureCtl.draft ? [...p.measureCtl.items, p.measureCtl.draft] : p.measureCtl.items}
                pushArrow={p.featureCtl.pushArrow}
                onPushPull={p.featureCtl.pushPull}
                onPushPullLive={p.featureCtl.pushLive}
                onPickFaces={p.featureCtl.pickFaces}
                onPickPoint={p.pinCtl.pick}
                onPickFeature={p.featureCtl.pick}
                onSelectPin={p.pinCtl.select}
                onTransformCommit={p.transformCtl.commit}
                onMeasurePoint={p.measureCtl.point}
                onMeasureSegment={p.measureCtl.segment}
                onMeasureDelete={p.measureCtl.remove}
                diff={p.aiDiff}
                paramPeek={p.paramPeek}
                holeGhost={p.holeCtl.draft ? { at: p.holeCtl.draft.at, normal: p.holeCtl.draft.normal, diameter: p.holeCtl.draft.diameter, depth: p.holeCtl.draft.depth, ref: p.holeCtl.draft.ref?.center ?? null } : null}
                holePlace={p.holeCtl.draft && !p.holeCtl.draft.picking
                  ? { active: true, snap: p.holeCtl.draft.snap, onPlace: (at) => p.holeCtl.patch({ at }) }
                  : null}
                onModelDblClick={() => { setDockPanel("params"); setDockOpen(true); }}
                magnetPlace={p.magnetCtl.tool && p.magnetCtl.pocket
                  ? { diameter: p.magnetCtl.pocket.diameter, depth: p.magnetCtl.pocket.depth, snap: p.magnetCtl.tool.snap, align: p.magnetCtl.tool.placed, onPlace: p.magnetCtl.place }
                  : p.screwCtl.tool && p.screwCtl.cut
                    // The screw tool rides the SAME hover-ghost/snap/align machinery: the
                    // ghost shows the widest thing being cut (countersink or rib crest).
                    ? { diameter: Math.max(p.screwCtl.cut.countersink, p.screwCtl.cut.major), depth: p.screwCtl.cut.depth || 12, snap: p.screwCtl.tool.snap, align: p.screwCtl.tool.placed, onPlace: p.screwCtl.place }
                    : null}
                onContext={(h) => {
                  // Right-click selects what it lands on (standard editor behavior), then opens the menu.
                  if (h.target.kind === "attachment") p.onAttachSelect(h.target.id);
                  else if (h.target.kind === "model") p.onModelSelect(true);
                  setCtx(h);
                }}
              />
              {(p.tab === "3d" || p.tab === "params") && p.aiPreview.active && (
                <div className="ai-preview-bar" role="region" aria-label="AI change preview">
                  <span className="apb-text">
                    <b>AI change ready — this is a preview</b>
                    {p.aiPreview.hasDiff && (
                      <span className="apb-legend"><i className="apb-add" /> added <i className="apb-rem" /> removed</span>
                    )}
                    <span className="apb-hint">like it but not done? just type the next change</span>
                  </span>
                  <button className="primary sm" onClick={p.aiPreview.apply} title="Keep this change (saved as a version — Undo still works)">Apply</button>
                  <button className="ghost sm" onClick={p.aiPreview.retry} title="Not what you pictured? Rebuild this same request from scratch for a different take">Try again</button>
                  <button className="ghost sm" onClick={p.aiPreview.discard} title="Throw the proposal away — the model stays exactly as it was">Discard</button>
                  <button
                    className="apb-mode"
                    title="Stop asking: apply AI changes immediately from now on (switch back any time in Settings → AI)"
                    onClick={() => { p.aiPreview.setMode("auto"); p.aiPreview.apply(); }}
                  >
                    always apply automatically
                  </button>
                </div>
              )}
              {p.tab === "3d" && markMode && (
                <MarkOverlay
                  viewerRef={p.viewerRef}
                  onDone={(blob, view, region) => {
                    setMarkMode(false);
                    setChatOpen(true); // the marked screenshot lands in the composer — make sure it's visible
                    p.onMarkup(blob, view, region);
                  }}
                  onCancel={() => setMarkMode(false)}
                />
              )}
              {ctx && (() => {
                const close = () => setCtx(null);
                const anchor = { top: ctx.y, bottom: ctx.y, right: ctx.x + 200 } as DOMRect;
                const t = ctx.target;
                const Item = ({ label, hint, onClick, disabled }: { label: string; hint?: string; onClick: () => void; disabled?: boolean }) => (
                  <button role="menuitem" className="pmenu-item" disabled={disabled} onClick={() => { close(); onClick(); }}>
                    <b>{label}</b>
                    {hint && <span>{hint}</span>}
                  </button>
                );
                const plateItems = (key: string) => p.plateCtl.count > 1 || p.attachments.length > 0 ? (
                  <>
                    <div className="pmenu-sep" />
                    <div className="pmenu-head">Print on plate</div>
                    {Array.from({ length: p.plateCtl.count }, (_, i) => i + 1).map((n) => (
                      <button key={n} role="menuitem" className={`pmenu-item${p.plateFor(key) === n ? " on" : ""}`} onClick={() => { close(); p.plateCtl.assign(key, n); }}>
                        Plate {n}{p.plateCtl.names[n] ? ` · ${p.plateCtl.names[n]}` : ""}{p.plateFor(key) === n ? " ✓" : ""}
                      </button>
                    ))}
                    <button role="menuitem" className="pmenu-item" onClick={() => { close(); p.plateCtl.assign(key, p.plateCtl.add()); }}>+ New plate</button>
                  </>
                ) : null;
                return (
                  <AnchoredMenu anchor={anchor} onClose={close} width={200}>
                    {t.kind === "model" && p.geometry && (
                      <>
                        <Item label="Adjust size & shape" hint="Free sliders — every dimension, no AI" onClick={() => { setDockPanel("params"); setDockOpen(true); }} />
                        <div className="pmenu-sep" />
                        <Item label="Rename" onClick={() => { setShowLayers(true); setRenaming("model"); }} />
                        <Item label="Duplicate" hint="A copy on its own plate — then iterate the live model" onClick={p.onKeepAside} />
                        <Item label="Copy" onClick={() => p.clipboardCtl.copy({ kind: "model" })} />
                        <div className="pmenu-sep" />
                        {p.separated ? (
                          <Item label="Regroup parts" hint="Undo the split exactly" onClick={p.onRegroup} />
                        ) : p.partCount > 1 ? (
                          <Item label={`Separate ${p.partCount} parts`} hint="Move each solid on its own" onClick={p.onSeparateParts} />
                        ) : null}
                        {t.normal && (
                          <Item label="This face on the plate" hint="Rotate so the clicked face sits flat" onClick={() => p.printPrep.orient.face(t.normal!)} />
                        )}
                        <Item label="Lay flat for printing" hint="Best orientation, resting on the plate" onClick={() => p.printPrep.orient.auto()} />
                        {plateItems("model")}
                        <div className="pmenu-sep" />
                        <Item label="Frame model" onClick={() => p.viewerRef.current?.resetView()} />
                      </>
                    )}
                    {t.kind === "attachment" && (
                      <>
                        <Item label="Rename" onClick={() => { setShowLayers(true); setRenaming(t.id); }} />
                        <Item label="Duplicate" onClick={() => p.clipboardCtl.duplicate({ kind: "attachment", id: t.id })} />
                        <Item label="Copy" onClick={() => p.clipboardCtl.copy({ kind: "attachment", id: t.id })} />
                        <Item label="Delete" onClick={() => p.onRemoveAttachment(t.id)} />
                        <div className="pmenu-sep" />
                        <Item label="Check clearance" hint="Real overlap vs the model" onClick={() => p.onCheckFit([t.id])} />
                        <Item label="Cut to fit" hint="Carve its shape + clearance" onClick={() => p.onMakeFit([t.id])} />
                        <Item label="Drop to plate" onClick={() => p.onDropToPlate([t.id])} />
                        <Item label="Merge into model" hint="Fuse into one solid" onClick={() => p.onMergeAttachments([t.id])} />
                        <Item label="Engrave into model" hint="Carve its shape in" onClick={() => p.onEngraveAttachments([t.id])} />
                        {plateItems(t.id)}
                      </>
                    )}
                    {t.kind === "empty" && (
                      <>
                        {p.clipboardCtl.canPaste && <Item label={`Paste "${p.clipboardCtl.pasteName}"`} onClick={p.clipboardCtl.paste} />}
                        {p.activePlate !== 0 && <Item label="Show all plates" onClick={() => p.setActivePlate(0)} />}
                        <Item label="Reset view" hint="Re-frame the model" onClick={() => p.viewerRef.current?.resetView()} />
                      </>
                    )}
                  </AnchoredMenu>
                );
              })()}
              {(p.tab === "3d" || p.tab === "params") && (
                <div className="canvas-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
                  {(p.activeKind === "replicad" || p.separatedKind === "replicad") && (
                    <>
                    {/* Select used to live here. It picked a face/edge/corner and then you
                        reached for Modify to do something with it — two tools for one
                        motion, and a five-way "what am I picking" row on top. Modify does
                        the whole thing now: hover picks whatever is under the cursor, click
                        holds it, and the operation is already on the panel. */}
                    <div className="rail-tool">
                      {/* Shape: the "I know exactly where I want this lump/hole" tool.
                          Placing is a click; being EXACT is the number fields under it. */}
                      <button
                        className={`ghost sm iconbtn${p.shapeCtl.tool ? " on" : ""}`}
                        aria-pressed={!!p.shapeCtl.tool}
                        aria-label="Shape"
                        disabled={p.activeKind !== "replicad"}
                        title={p.activeKind !== "replicad"
                          ? "Shapes work on the whole CAD model — Regroup parts to use it"
                          : "Shape tool: drop a box, cylinder or ball exactly where you click, added on or cut out — then type its exact size and position. Free, no AI."}
                        onClick={p.shapeCtl.toggle}
                      >
                        <IconShapes />
                      <span className="rail-name">Shape</span>
                    </button>
                      {p.shapeCtl.tool && p.activeKind === "replicad" && <ShapeFly ctl={p.shapeCtl} units={p.units} />}
                    </div>
                    <div className="rail-tool">
                      {/* Modify inverts Select's flow: arm the operation FIRST, then every click
                          applies it on the spot — so "round these four corners" is four clicks.
                          It rides on Select's picking (arming it turns select mode on). */}
                      <button
                        className={`ghost sm iconbtn${p.modifyCtl.op ? " on" : ""}`}
                        aria-pressed={!!p.modifyCtl.op}
                        aria-label="Modify"
                        disabled={p.activeKind !== "replicad"}
                        title={p.activeKind !== "replicad"
                          ? "Modify works on the whole CAD model — Regroup parts to use it"
                          : "Modify tool: pick Push/Pull, Round or Bevel and a size, then click the model — each click applies it right there, no AI"}
                        onClick={p.modifyCtl.toggle}
                      >
                        <IconModify />
                      <span className="rail-name">Modify</span>
                    </button>
                      {p.modifyCtl.op && p.activeKind === "replicad" && <ModifyFly ctl={p.modifyCtl} featureCtl={p.featureCtl} />}
                    </div>
                    </>
                  )}
                  <div className="rail-tool">
                    <button
                      className={`ghost sm iconbtn${p.transformCtl.mode !== "off" ? " on" : ""}`}
                      aria-pressed={p.transformCtl.mode !== "off"}
                      aria-label="Transform"
                      disabled={p.transformCtl.busy}
                      title="Transform tool: move, rotate (great for print orientation) or scale the whole part — drag the gizmo, no AI, no tokens"
                      onClick={() => p.transformCtl.setMode(p.transformCtl.mode === "off" ? "move" : "off")}
                    >
                      <IconTransform />
                    <span className="rail-name">Move</span>
                    </button>
                    {p.transformCtl.mode !== "off" && (
                      <div className="rail-fly">
                        <div className="seg sm mode-seg">
                          <button className={`iconbtn${p.transformCtl.mode === "move" ? " on" : ""}`} aria-label="Move" title="Move the part (drag the arrows)" onClick={() => p.transformCtl.setMode("move")}><IconTransform /><span className="btn-label">Move</span></button>
                          <button className={`iconbtn${p.transformCtl.mode === "rotate" ? " on" : ""}`} aria-label="Rotate" title="Rotate the part (drag the rings — hold Shift for 90° steps)" onClick={() => p.transformCtl.setMode("rotate")}><IconRotate /><span className="btn-label">Rotate</span></button>
                          <button className={`iconbtn${p.transformCtl.mode === "scale" ? " on" : ""}`} aria-label="Scale" title="Scale the part uniformly (drag a handle)" onClick={() => p.transformCtl.setMode("scale")}><IconScale /><span className="btn-label">Scale</span></button>
                        </div>
                        {p.transformCtl.mode === "rotate" && (
                          <RotateByRow busy={p.transformCtl.busy} onGo={p.transformCtl.rotateBy} />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="rail-tool">
                    <button
                      className={`ghost sm iconbtn${p.measureCtl.mode ? " on" : ""}`}
                      aria-pressed={p.measureCtl.mode}
                      aria-label="Measure"
                      title="Measure tool: click two points on the model to see the distance between them"
                      onClick={p.measureCtl.toggle}
                    >
                      <IconRuler />
                    <span className="rail-name">Measure</span>
                    </button>
                    {p.measureCtl.mode && p.measureCtl.items.length > 0 && (
                      <div className="rail-fly">
                        <button className="ghost sm" title="Clear all measurements" onClick={p.measureCtl.clear}>Clear ({p.measureCtl.items.length})</button>
                      </div>
                    )}
                  </div>
                  <div className="rail-tool">
                    {/* Pen cut: draw the split line yourself instead of taking the
                        bed-sized grid. The flyout is the confirm step — the stroke
                        stays on screen so it can be checked from another angle. */}
                    <button
                      className={`ghost sm iconbtn${p.cutCtl.mode ? " on" : ""}`}
                      aria-pressed={p.cutCtl.mode}
                      aria-label="Cut"
                      title="Cut tool: draw a line across the part and it splits along it"
                      onClick={p.cutCtl.toggle}
                    >
                      <IconCut />
                    <span className="rail-name">Cut</span>
                    </button>
                    {p.cutCtl.mode && (
                      <div className="rail-fly cut-fly">
                        <p className="fine">
                          {p.cutCtl.pending
                            ? "Cut along this line? Orbit to check it first — the line stays put."
                            : "Drag across the part to draw the cut. Start and finish outside it."}
                        </p>
                        <label className="cut-row">
                          <input type="checkbox" checked={p.cutCtl.connectors} onChange={(e) => p.cutCtl.setConnectors(e.target.checked)} />
                          Connecting pins
                        </label>
                        {p.cutCtl.connectors && (
                          <div className="cut-row">
                            <span className="fine">Pin size</span>
                            {[4, 5, 6, 8].map((d) => (
                              <button
                                key={d}
                                className={`chip sm${p.cutCtl.pinSize === d ? " on" : ""}`}
                                onClick={() => p.cutCtl.setPinSize(d)}
                              >
                                {d} mm
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="cut-actions">
                          <button className="primary sm" disabled={!p.cutCtl.pending || p.cutCtl.busy} onClick={p.cutCtl.apply}>
                            {p.cutCtl.busy ? "Cutting…" : "Cut here"}
                          </button>
                          <button className="ghost sm" disabled={!p.cutCtl.pending} onClick={p.cutCtl.clear}>Redraw</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="rail-tool">
                    {/* Magnets and screws share one Fasteners slot: both cut pockets with
                        the same free CAD hole machinery, and two rail rows for one job made
                        the rail read longer than it is. The flyout's first row picks which;
                        the rail icon shows the one you'd get. */}
                    <button
                      className={`ghost sm iconbtn${p.magnetCtl.tool || p.screwCtl.tool ? " on" : ""}`}
                      aria-pressed={!!(p.magnetCtl.tool || p.screwCtl.tool)}
                      aria-label="Fasteners"
                      disabled={!p.geometry || p.tab !== "3d" || !p.magnetCtl.canUse}
                      title={p.magnetCtl.canUse
                        ? "Fasteners: magnet pockets and screw holes. Pick which in the panel, hover the model for a preview, click to cut."
                        : "Fasteners work on Precise (CAD) models — mesh models can't be drilled"}
                      onClick={() => {
                        if (p.magnetCtl.tool) p.magnetCtl.toggle();
                        else if (p.screwCtl.tool) p.screwCtl.toggle();
                        else (lastFastener === "screw" ? p.screwCtl : p.magnetCtl).toggle();
                      }}
                    >
                      <IconFastener />
                    <span className="rail-name">Fasteners</span>
                    </button>
                    {(p.magnetCtl.tool || p.screwCtl.tool) && (
                      <div className="rail-fly">
                        <div className="magnet-fly">
                          {/* Arming one puts the other down (dismissOverlays inside the
                              toggles) — the seg only ever needs to switch the off one on. */}
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="Fastener kind">
                            <button className={p.magnetCtl.tool ? "on" : ""} role="radio" aria-checked={!!p.magnetCtl.tool}
                              title="Pockets for disc magnets — press-fit or glued"
                              onClick={() => { setLastFastener("magnet"); if (!p.magnetCtl.tool) p.magnetCtl.toggle(); }}>
                              <IconMagnet size={13} /><span className="btn-label">Magnet</span>
                            </button>
                            <button className={p.screwCtl.tool ? "on" : ""} role="radio" aria-checked={!!p.screwCtl.tool}
                              title="Screw holes — clearance, thread-bite or heat-set insert"
                              onClick={() => { setLastFastener("screw"); if (!p.screwCtl.tool) p.screwCtl.toggle(); }}>
                              <IconScrew size={13} /><span className="btn-label">Screw</span>
                            </button>
                          </div>
                          {p.magnetCtl.tool && (<>
                          <div className="paint-lbl">Disc magnet · ⌀×h mm</div>
                          <div className="magnet-sizes" role="radiogroup" aria-label="Magnet size">
                            {p.magnetCtl.sizes.map((s) => {
                              const on = p.magnetCtl.tool!.size.d === s.d && p.magnetCtl.tool!.size.h === s.h;
                              return (
                                <button key={`${s.d}x${s.h}`} role="radio" aria-checked={on} className={`msize${on ? " on" : ""}`}
                                  title={s.note ? `${s.d}×${s.h} mm — ${s.note}` : `${s.d}×${s.h} mm`}
                                  onClick={() => { p.magnetCtl.patch({ size: s }); p.magnetCtl.editApply({ size: s }); }}>
                                  {s.d}×{s.h}
                                </button>
                              );
                            })}
                          </div>
                          <div className="paint-lbl">How it's held in</div>
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="How the magnet is held in">
                            <button className={p.magnetCtl.tool.fit === "glue" ? "on" : ""} role="radio" aria-checked={p.magnetCtl.tool.fit === "glue"}
                              title="The pocket is cut 0.25 mm wider than the magnet. A small drop of super glue in the bottom squeezes up into the side ring and locks it. The safe choice, and the default."
                              onClick={() => { p.magnetCtl.patch({ fit: "glue" }); p.magnetCtl.editApply({ fit: "glue" }); }}>Glued in</button>
                            <button className={p.magnetCtl.tool.fit === "press" ? "on" : ""} role="radio" aria-checked={p.magnetCtl.tool.fit === "press"}
                              title="The pocket is cut just 0.1 mm wider — the magnet presses in with thumb pressure and friction holds it. No glue needed, but a hard knock can pop it out."
                              onClick={() => { p.magnetCtl.patch({ fit: "press" }); p.magnetCtl.editApply({ fit: "press" }); }}>Push fit</button>
                          </div>
                          <div className="paint-lbl">How it sits when printed</div>
                          {/* Options are named by the PRINTED outcome, not the cut. Printed
                              pockets always land a hair too deep (magnets run under nominal,
                              printed tops sag), so "Flush" secretly cuts 0.1 mm shallow to
                              cancel that out. The mm compensation stays backstage. */}
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="Magnet seat">
                            {[{ v: 0.1, l: "Flush", t: "The magnet lands even with the surface and touches whatever it grabs. Printed pockets always come out a hair too deep, so this cuts the pocket a hair shallow to cancel that out. The default." },
                              { v: 0.2, l: "Raised", t: "The magnet stands just above the surface — extra insurance if Flush still leaves a tiny gap on your printer." },
                              { v: 0, l: "Recessed", t: "The pocket is exactly magnet-deep, so the printed magnet ends up a hair below the surface. Only for faces that must slide past each other." }].map((o) => (
                              <button key={o.v} className={p.magnetCtl.tool!.seat === o.v ? "on" : ""} role="radio" aria-checked={p.magnetCtl.tool!.seat === o.v}
                                title={o.t}
                                onClick={() => { p.magnetCtl.patch({ seat: o.v }); p.magnetCtl.editApply({ seat: o.v }); }}>{o.l}</button>
                            ))}
                          </div>
                          <div className="paint-lbl">Placing</div>
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="Placement snapping">
                            <button className={p.magnetCtl.tool.snap > 0 ? "on" : ""} role="radio" aria-checked={p.magnetCtl.tool.snap > 0}
                              title="Positions land on a 1 mm grid — tidy, repeatable spacing."
                              onClick={() => p.magnetCtl.patch({ snap: 1 })}>1 mm grid</button>
                            <button className={p.magnetCtl.tool.snap === 0 ? "on" : ""} role="radio" aria-checked={p.magnetCtl.tool.snap === 0}
                              title="The pocket goes exactly where the cursor is. Lining up with a pocket you've already placed still works."
                              onClick={() => p.magnetCtl.patch({ snap: 0 })}>Free</button>
                          </div>
                          <label className="magnet-pair" title="For a magnet on BOTH sides of the same wall — a lid that grabs from either face, say. The second pocket goes exactly opposite the first. Leave this off if the other magnet belongs to a separate part.">
                            <input type="checkbox" checked={p.magnetCtl.tool.pair} onChange={(e) => p.magnetCtl.patch({ pair: e.target.checked })} />
                            <span>Add one on the back too</span>
                          </label>
                          {p.magnetCtl.edit ? (
                            <>
                              <div className="paint-lbl">Editing this pocket</div>
                              <div className="hole-edit-actions">
                                <button className={`ghost sm${p.magnetCtl.edit.moving ? " on" : ""}`} onClick={p.magnetCtl.editMove} title="Re-place it: your next click on the model is its new home">{p.magnetCtl.edit.moving ? "Click the new spot…" : "Move"}</button>
                                <button className="ghost sm" onClick={p.magnetCtl.editDelete} title="Fill this pocket back in — the model rebuilds without it">Remove</button>
                                <button className="ghost sm" onClick={p.magnetCtl.editDone} title="Stop editing — clicks place new pockets again">Done</button>
                              </div>
                              <div className="magnet-hint">The options above show THIS pocket — change any of them to re-cut it in place. All undoable.</div>
                            </>
                          ) : (
                            <div className="magnet-hint">Hover the model, click to sink the pocket. Click an existing pocket to see and change it — resize, move or remove, nothing is baked in. Place one near another and it lines up square with it.</div>
                          )}
                          {/* The pockets themselves, newest-highest first: clicking a 3 mm
                              circle on the model is fiddly, and "take the top two off" is
                              a list job. Every row is an op, so all of this is undoable. */}
                          {p.magnetCtl.pockets.length > 0 && (
                            <>
                              <div className="paint-lbl">On the model · highest first</div>
                              <div className="pocket-list">
                                {[...p.magnetCtl.pockets].sort((a, b) => b.up - a.up).map((k) => (
                                  <div key={k.index} className={`pocket-row${p.magnetCtl.editIndex === k.index ? " on" : ""}`}>
                                    <button className="pocket-pick" title="Edit this pocket — the settings above become its own, so changing one re-cuts it in place"
                                      onClick={() => p.magnetCtl.selectPocket(k.index)}>
                                      <span className="pocket-size">{k.label}</span>
                                      <span className="pocket-where">{k.fit ? `${k.fit} · ` : ""}{fmtLen(k.up, p.units)} up</span>
                                    </button>
                                    <button className="x" aria-label={`Remove the ${k.label} pocket`} title="Fill this pocket back in — undoable"
                                      onClick={() => p.magnetCtl.removePocket(k.index)}><IconX /></button>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {p.magnetCtl.placedCount > 0 && !p.magnetCtl.edit && (
                            <div className="hole-edit-actions">
                              <button className="ghost sm" onClick={p.magnetCtl.recutAll}
                                title={`Re-cut every pocket to ${p.magnetCtl.tool.size.d}×${p.magnetCtl.tool.size.h} mm, ${p.magnetCtl.tool.fit === "press" ? "push fit" : "glued"}, at the seat chosen above — same spots, new bore. Undoable.`}>
                                Re-cut all ({p.magnetCtl.placedCount}) to {p.magnetCtl.tool.size.d}×{p.magnetCtl.tool.size.h}
                              </button>
                              <button className="ghost sm" onClick={p.magnetCtl.removeAll} title="Fill every magnet pocket back in — the model rebuilds without them (undoable)">
                                Remove all
                              </button>
                            </div>
                          )}
                          </>)}
                          {p.screwCtl.tool && (<>
                          <div className="paint-lbl">Screw size</div>
                          <div className="magnet-sizes" role="radiogroup" aria-label="Screw size">
                            {p.screwCtl.sizes.map((s) => {
                              const on = p.screwCtl.tool!.size.id === s.id;
                              const noInsert = p.screwCtl.tool!.fit === "insert" && !s.insertBore;
                              return (
                                <button key={s.id} role="radio" aria-checked={on} className={`msize${on ? " on" : ""}`}
                                  disabled={noInsert}
                                  title={noInsert ? `No standard heat-set insert for ${s.label}` : s.note ? `${s.label} — ${s.note}` : s.label}
                                  onClick={() => { p.screwCtl.patch({ size: s }); p.screwCtl.editApply({ size: s }); }}>
                                  {s.label}
                                </button>
                              );
                            })}
                          </div>
                          <div className="paint-lbl">What the hole does</div>
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="Hole type">
                            <button className={p.screwCtl.tool.fit === "bite" ? "on" : ""} role="radio" aria-checked={p.screwCtl.tool.fit === "bite"}
                              title="The screw threads INTO this part: the bore is the plastic tap size and the wall is ribbed at the thread pitch, so the screw cuts its own path and holds like a tapped hole."
                              onClick={() => { p.screwCtl.patch({ fit: "bite" }); p.screwCtl.editApply({ fit: "bite" }); }}>Bites in</button>
                            <button className={p.screwCtl.tool.fit === "through" ? "on" : ""} role="radio" aria-checked={p.screwCtl.tool.fit === "through"}
                              title="The screw slides through this part and tightens into the next one (or a nut) — a standard clearance bore, all the way through."
                              onClick={() => { p.screwCtl.patch({ fit: "through" }); p.screwCtl.editApply({ fit: "through" }); }}>Slides through</button>
                            <button className={p.screwCtl.tool.fit === "insert" ? "on" : ""} role="radio" aria-checked={p.screwCtl.tool.fit === "insert"}
                              title="Pocket for a heat-set brass insert (Ruthex-style) — melt it in with a soldering iron and the screw threads into brass, the strongest hold in plastic."
                              onClick={() => { const cur = p.screwCtl.tool!.size; const sz = cur.insertBore ? cur : p.screwCtl.sizes.find((x) => x.insertBore)!; p.screwCtl.patch({ fit: "insert", ...(cur.insertBore ? {} : { size: sz }) }); p.screwCtl.editApply({ fit: "insert", size: sz }); }}>Heat-set</button>
                          </div>
                          {p.screwCtl.tool.fit === "through" && (
                            <label className="magnet-pair" title="Widens the top of the hole into an 82° cone, so a flat (countersunk) screw head sits flush with the surface.">
                              <input type="checkbox" checked={p.screwCtl.tool.countersink} onChange={(e) => { p.screwCtl.patch({ countersink: e.target.checked }); p.screwCtl.editApply({ countersink: e.target.checked }); }} />
                              <span>Flush head (countersink)</span>
                            </label>
                          )}
                          <div className="paint-lbl">Placing</div>
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="Placement snapping">
                            <button className={p.screwCtl.tool.snap > 0 ? "on" : ""} role="radio" aria-checked={p.screwCtl.tool.snap > 0}
                              onClick={() => p.screwCtl.patch({ snap: 1 })}>1 mm grid</button>
                            <button className={p.screwCtl.tool.snap === 0 ? "on" : ""} role="radio" aria-checked={p.screwCtl.tool.snap === 0}
                              onClick={() => p.screwCtl.patch({ snap: 0 })}>Free</button>
                          </div>
                          {p.screwCtl.edit ? (
                            <>
                              <div className="paint-lbl">Editing this hole</div>
                              <div className="hole-edit-actions">
                                <button className={`ghost sm${p.screwCtl.edit.moving ? " on" : ""}`} onClick={p.screwCtl.editMove} title="Re-place it: your next click on the model is its new home">{p.screwCtl.edit.moving ? "Click the new spot…" : "Move"}</button>
                                <button className="ghost sm" onClick={p.screwCtl.editDelete} title="Fill this hole back in — the model rebuilds without it">Remove</button>
                                <button className="ghost sm" onClick={p.screwCtl.editDone} title="Stop editing — clicks cut new holes again">Done</button>
                              </div>
                              <div className="magnet-hint">Size and fit above now change THIS hole, in place. All undoable.</div>
                            </>
                          ) : (
                            <div className="magnet-hint">{p.screwCtl.cut ? p.screwCtl.cut.what : ""} Hover the model, click to cut. Click an existing hole to edit it — resize, move or remove, nothing is baked in.</div>
                          )}
                          {p.screwCtl.placedCount > 0 && !p.screwCtl.edit && (
                            <button className="ghost sm hole-clear" onClick={p.screwCtl.removeAll} title="Fill every screw hole back in — the model rebuilds without them (undoable)">
                              Remove all ({p.screwCtl.placedCount})
                            </button>
                          )}
                          </>)}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="rail-tool">
                    {/* Add Logo: opens a panel rather than a bare file dialog, so the
                        accepted formats and the "what happens next" step are visible
                        BEFORE the picker, and a file can be dropped straight onto it. */}
                    <button
                      className={`ghost sm iconbtn${logoOpen ? " on" : ""}`}
                      aria-pressed={logoOpen}
                      aria-label="Add Logo"
                      disabled={!p.geometry || p.tab !== "3d"}
                      title="Add a logo or emblem: drop an SVG, PNG or JPG. It arrives as its own layer you drag onto any face, then Merge (raised) or Engrave (carved)."
                      onClick={() => setLogoOpen((v) => !v)}
                    >
                      <IconBadge />
                    <span className="rail-name">Add Logo</span>
                    </button>
                    {logoOpen && (
                      <div className="rail-fly logo-fly">
                        <div
                          className={`logo-drop${logoOver ? " over" : ""}`}
                          onDragOver={(e) => { e.preventDefault(); setLogoOver(true); }}
                          onDragLeave={() => setLogoOver(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setLogoOver(false);
                            const f = e.dataTransfer.files?.[0];
                            if (f) { p.onAddLogo(f); setLogoOpen(false); }
                          }}
                          onClick={() => logoFileRef.current?.click()}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") logoFileRef.current?.click(); }}
                        >
                          <IconBadge size={20} />
                          <b>Drop a logo here</b>
                          <span>or click to choose a file</span>
                        </div>
                        <p className="fine">
                          <b>SVG</b> comes through exactly. <b>PNG</b> and <b>JPG</b> get traced — solid
                          dark art on a light background traces cleanest; photos and gradients don't.
                        </p>
                        <p className="fine">
                          It lands as its own layer. Drag it onto any face, then <b>Merge</b> to raise it
                          or <b>Engrave</b> to carve it in, from the Objects panel.
                        </p>
                      </div>
                    )}
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,.webp"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { p.onAddLogo(f); setLogoOpen(false); }
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                  {/* Point/pin: mark an exact spot and write a note for the AI. It was the
                      fifth option in Select's "what am I picking" row — sitting beside four
                      that pick geometry while doing something else entirely. With that row
                      gone it gets its own entry rather than disappearing. */}
                  {(p.activeKind === "replicad" || p.separatedKind === "replicad") && (
                    <div className="rail-tool">
                      <button
                        className={`ghost sm iconbtn${p.featureCtl.mode && p.featureCtl.kind === "point" ? " on" : ""}`}
                        aria-pressed={p.featureCtl.mode && p.featureCtl.kind === "point"}
                        aria-label="Note"
                        disabled={p.activeKind !== "replicad"}
                        title={p.activeKind !== "replicad"
                          ? "Notes work on the whole CAD model — Regroup parts to use it"
                          : "Note tool: click an exact spot to pin a marker there, then write what should change — the AI gets the coordinates, not a description"}
                        onClick={p.featureCtl.togglePin}
                      >
                        <IconPointSel size={19} />
                        <span className="rail-name">Note</span>
                      </button>
                    </div>
                  )}
                  <div className="rail-tool">
                    <button
                      className={`ghost sm iconbtn${markMode ? " on" : ""}`}
                      aria-pressed={markMode}
                      aria-label="Mark"
                      disabled={!p.geometry || p.tab !== "3d"}
                      title="Mark tool: draw around a part of the model — a marked screenshot attaches to the chat so the AI knows exactly where your change goes"
                      onClick={() => setMarkMode((v) => {
                        if (!v) {
                          if (p.featureCtl.mode) p.featureCtl.toggleMode();
                          if (p.measureCtl.mode) p.measureCtl.toggle();
                          if (p.transformCtl.mode !== "off") p.transformCtl.setMode("off");
                          if (p.paintCtl.mode) p.paintCtl.setMode(false);
                          if (p.magnetCtl.tool) p.magnetCtl.toggle();
                          if (p.screwCtl.tool) p.screwCtl.toggle();
                        }
                        return !v;
                      })}
                    >
                      <IconMarker />
                    <span className="rail-name">Mark</span>
                    </button>
                    {p.pins.length > 0 && (
                      <div className="rail-fly">
                        <button className="ghost sm" title={`Remove all ${p.pins.length} point${p.pins.length > 1 ? "s" : ""}`} onClick={p.pinCtl.clearAll}>Clear points ({p.pins.length})</button>
                      </div>
                    )}
                  </div>
                  <div className="rail-tool">
                    {/* Bambu-style colour painting: click a face region to fill it with a filament.
                        Works on any solid (best on meshes/imports — stable triangles). */}
                    <button
                      className={`ghost sm iconbtn${p.paintCtl.mode ? " on" : ""}`}
                      aria-pressed={p.paintCtl.mode}
                      aria-label="Paint"
                      disabled={!p.geometry || p.tab !== "3d"}
                      title="Colour Painting: pick a filament, then click a region of the model to fill it — the slicer prints that region in that filament colour"
                      onClick={() => p.paintCtl.setMode(!p.paintCtl.mode)}
                    >
                      <IconPaint />
                    <span className="rail-name">Paint</span>
                    </button>
                    {p.paintCtl.mode && (
                      <div className="rail-fly">
                        <div className="paint-fly">
                          <div className="seg sm mode-seg" role="radiogroup" aria-label="Paint tool">
                            <button className={p.paintCtl.tool === "fill" ? "on" : ""} role="radio" aria-checked={p.paintCtl.tool === "fill"} title="Fill: click a face region to flood-fill it" onClick={() => p.paintCtl.setTool("fill")}>Fill</button>
                            <button className={p.paintCtl.tool === "brush" ? "on" : ""} role="radio" aria-checked={p.paintCtl.tool === "brush"} title="Brush: press and drag to paint" onClick={() => p.paintCtl.setTool("brush")}>Brush</button>
                            <button className={p.paintCtl.tool === "pick" ? "on" : ""} role="radio" aria-checked={p.paintCtl.tool === "pick"} title="Eyedropper: click the model to adopt the filament under the cursor" onClick={() => p.paintCtl.setTool("pick")}>Pick</button>
                          </div>
                          <label className="magnet-pair" title="Symmetric models (helmets, characters): every fill and stroke also paints the X-mirrored spot on the other side. Best-effort — parts of the mesh with no mirror twin just don't mirror.">
                            <input type="checkbox" checked={p.paintCtl.mirror} onChange={(e) => p.paintCtl.setMirror(e.target.checked)} />
                            <span>Mirror both sides</span>
                          </label>
                          <div className="paint-lbl">Filament</div>
                          <div className="paint-swatches" role="radiogroup" aria-label="Filament">
                            {p.paintCtl.palette.map((c, i) => (
                              <button
                                key={c}
                                role="radio"
                                aria-checked={p.paintCtl.slot === i + 1}
                                className={`psw${p.paintCtl.slot === i + 1 ? " on" : ""}`}
                                style={{ background: c }}
                                title={`Filament ${i + 1} · ${c}`}
                                aria-label={`Filament ${i + 1}`}
                                onClick={() => p.paintCtl.setSlot(i + 1)}
                              />
                            ))}
                            <button
                              role="radio"
                              aria-checked={p.paintCtl.slot === 0}
                              className={`psw psw-erase${p.paintCtl.slot === 0 ? " on" : ""}`}
                              title="Eraser — remove paint from a region"
                              aria-label="Eraser"
                              onClick={() => p.paintCtl.setSlot(0)}
                            ><IconX size={11} /></button>
                          </div>
                          {p.paintCtl.slot > 0 && (
                            <label className="paint-hex" title="Set this filament to an exact colour — match the spool you'll actually load. Regions already painted with it follow.">
                              <input type="color" value={p.paintCtl.palette[p.paintCtl.slot - 1]} onChange={(e) => p.paintCtl.setSlotColor(p.paintCtl.slot - 1, e.target.value)} aria-label={`Exact colour for filament ${p.paintCtl.slot}`} />
                              <span>Filament {p.paintCtl.slot} · <b className="hex">{p.paintCtl.palette[p.paintCtl.slot - 1].toUpperCase()}</b></span>
                            </label>
                          )}
                          <FilamentCount facePaint={p.paintCtl.facePaint} />
                          {p.paintCtl.tool === "fill" ? (
                            <label className="paint-angle">
                              <span>Smart-fill angle — {p.paintCtl.angle}°</span>
                              <input type="range" min={0} max={89} step={1} value={p.paintCtl.angle} onChange={(e) => p.paintCtl.setAngle(parseInt(e.target.value))} aria-label="Smart-fill angle" />
                            </label>
                          ) : (
                            <label className="paint-angle">
                              <span>Brush size — {p.paintCtl.brushSize}%</span>
                              <input type="range" min={1} max={30} step={1} value={p.paintCtl.brushSize} onChange={(e) => p.paintCtl.setBrushSize(parseInt(e.target.value))} aria-label="Brush size" />
                            </label>
                          )}
                          <button className="ghost sm" disabled={!p.paintCtl.hasPaint} title="Remove all painted regions from the model" onClick={p.paintCtl.onEraseAll}>Erase all painting</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="rail-sep" aria-hidden="true" />
                  <MaterialMenu appearance={p.appearance} setAppearance={p.setAppearance} />
                  <SurfaceMenu disabled={!p.geometry || p.status === "generating"} isCad={p.activeKind === "replicad"} onApply={p.onApplySurface} />
                </div>
              )}
              {(p.tab === "3d" || p.tab === "params") && p.geometry && !p.showcase && (p.attachments.length > 0 || p.plateCtl.count > 1) && (
                <PlateBar
                  count={p.plateCtl.count}
                  names={p.plateCtl.names}
                  active={p.activePlate}
                  setActive={p.setActivePlate}
                  counts={plateCounts}
                  onAdd={() => p.plateCtl.add()}
                  onRemove={p.plateCtl.remove}
                  onRename={p.plateCtl.rename}
                  exportEach={p.plateCtl.exportEach}
                  exportProject={p.plateCtl.exportProject}
                />
              )}
              {/* Showcase scene bar: swap the stage while the turntable runs. Sits just
                  above the view snaps — the two read as one bottom-center cluster. */}
              {(p.tab === "3d" || p.tab === "params") && p.showcase && (
                <div className="showcase-bar seg sm" role="radiogroup" aria-label="Showcase scene">
                  {([
                    ["studio", "Studio", "Seamless backdrop, studio lights, soft shadow — the look of the project thumbnails."],
                    ["daylight", "Daylight", "Bright and airy, lit like a windowsill."],
                    ["dark", "Dark stage", "Charcoal backdrop, cool rim light — dramatic."],
                    ["workshop", "Workshop", "The plain viewport, just spinning."],
                  ] as const).map(([v, l, t]) => (
                    <button key={v} className={p.showcaseScene === v ? "on" : ""} role="radio" aria-checked={p.showcaseScene === v} title={t} onClick={() => p.setShowcaseScene(v)}>{l}</button>
                  ))}
                </div>
              )}
              {(p.tab === "3d" || p.tab === "params") && p.geometry && (
                <div className="view-snaps" role="group" aria-label="View angles">
                  {(["top", "front", "right", "iso"] as const).map((v) => (
                    <button key={v} onClick={() => p.viewerRef.current?.setView(v)} title={v === "iso" ? "3/4 view" : `Look at the ${v}`}>
                      {v === "top" ? "Top" : v === "front" ? "Front" : v === "right" ? "Right" : "3D"}
                    </button>
                  ))}
                </div>
              )}
              {/* Everything that docks to the canvas's top-right corner lives in ONE
                  stack. They used to be four independently absolute-positioned panels
                  all pinned to the same 10px corner, so any two open at once sat on
                  top of each other (Objects over the selection inspector, most
                  visibly). A flex column can't overlap itself. */}
              <div className="right-dock">
                {p.tab === "3d" && showStats && p.geometry && p.report && <MeshStats report={p.report} />}
                {showHelp && (p.tab === "3d" || p.tab === "params") && <HelpSheet onClose={() => setShowHelp(false)} />}
                {(p.tab === "3d" || p.tab === "params") && p.modelSelected && p.geometry && p.dims && (
                  <SelectionInspector dims={p.dims} units={p.units} busy={p.status === "generating"} canScale={p.activeKind !== "primitive"} onScale={p.onScaleTo} onDeselect={() => p.onModelSelect(false)} onAdjust={() => { setDockPanel("params"); setDockOpen(true); }} />
                )}
              </div>
              {/* NOT in the right-dock: that stack steps left to clear the Inspector
                  card, which left the zoom buttons floating mid-canvas. The corner
                  cluster stays glued to the bottom-right, above the orientation gizmo. */}
              {(p.tab === "3d" || p.tab === "params") && p.geometry && !p.showcase && (
                <div className="zoom-ctl" role="group" aria-label="Zoom">
                  <button title="Zoom in" aria-label="Zoom in" onClick={() => p.viewerRef.current?.zoomBy(1.3)}>+</button>
                  <button title="Frame the model in view" aria-label="Frame model" onClick={() => p.viewerRef.current?.resetView()}><IconFrame size={12} /></button>
                  <button title="Zoom out" aria-label="Zoom out" onClick={() => p.viewerRef.current?.zoomBy(1 / 1.3)}>−</button>
                </div>
              )}
              {p.pinCtl.active && (
                <div className="pin-panel">
                  <div className="pin-head">
                    <span>
                      Point {p.pinCtl.active.index + 1} · {p.pinCtl.active.face} face · {p.pinCtl.active.pin.x}, {p.pinCtl.active.pin.y}, {p.pinCtl.active.pin.z} mm
                    </span>
                    <button className="x" aria-label="Close point" onClick={p.pinCtl.close}><IconX /></button>
                  </div>
                  <textarea
                    rows={2}
                    value={p.pinCtl.text}
                    onChange={(e) => p.pinCtl.setText(e.target.value)}
                    placeholder="e.g. add a 5 mm hole here · this wall feels thin"
                  />
                  <div className="param-actions">
                    <button
                      className="primary sm"
                      disabled={!p.pinCtl.text.trim() || p.activeKind !== "replicad" || p.status === "generating"}
                      onClick={p.pinCtl.askAi}
                    >
                      Ask AI to change this
                    </button>
                    <button className="ghost sm" disabled={!p.pinCtl.text.trim()} onClick={p.pinCtl.saveNote}>Save note</button>
                    <button className="ghost sm danger" onClick={p.pinCtl.del}>Delete</button>
                  </div>
                  {p.activeKind !== "replicad" && <p className="fine">AI edits need a Precise (CAD) model — notes work everywhere.</p>}
                </div>
              )}
              {p.featureCtl.selected && p.activeKind === "replicad" && !p.modifyCtl.op && (
                <ContextBar
                  anchor={[p.featureCtl.selected.cx, p.featureCtl.selected.cy, p.featureCtl.selected.cz]}
                  away={p.featureCtl.pushArrow ? [
                    p.featureCtl.pushArrow.center[0] + p.featureCtl.pushArrow.normal[0] * 10,
                    p.featureCtl.pushArrow.center[1] + p.featureCtl.pushArrow.normal[1] * 10,
                    p.featureCtl.pushArrow.center[2] + p.featureCtl.pushArrow.normal[2] * 10,
                  ] : null}
                  viewerRef={p.viewerRef}>
                  <DirectOpBar
                    kind={p.featureCtl.selected.kind}
                    busy={p.status === "generating"}
                    onApply={p.featureCtl.directOp}
                    liveSize={p.featureCtl.liveMm}
                    onHole={p.holeCtl.canStart ? p.holeCtl.start : undefined}
                  />
                  <button className="x" aria-label="Clear selection" onClick={p.featureCtl.clear}><IconX /></button>
                </ContextBar>
              )}
              {p.holeCtl.draft && <HolePanel ctl={p.holeCtl} busy={p.status === "generating"} />}
              {p.facesCtl.faces.length > 0 && p.activeKind === "replicad" && (
                <ContextBar
                  anchor={[
                    p.facesCtl.faces.reduce((a, f) => a + f.cx, 0) / p.facesCtl.faces.length,
                    p.facesCtl.faces.reduce((a, f) => a + f.cy, 0) / p.facesCtl.faces.length,
                    p.facesCtl.faces.reduce((a, f) => a + f.cz, 0) / p.facesCtl.faces.length,
                  ]}
                  viewerRef={p.viewerRef}
                >
                  <MultiFaceOpRow count={p.facesCtl.faces.length} busy={p.status === "generating"} isCad={p.activeKind === "replicad"} onApply={p.facesCtl.directOp} />
                  <button className="x" aria-label="Clear selection" onClick={p.facesCtl.clear}><IconX /></button>
                </ContextBar>
              )}
              {p.featureCtl.mode && !p.modifyCtl.op && p.featureCtl.kind !== "point" && p.facesCtl.faces.length === 0 && !p.featureCtl.selected && (
                <div className="box-hint">Shift-click faces to build a selection · shift-drag to box-select</div>
              )}
              {p.measureCtl.mode && !p.measureCtl.draft && (
                <div className="box-hint">
                  {p.measureCtl.pending ? "Click the second point. Hover the opposite face and it snaps square across the part — the true wall-to-wall width." : "Click two points, or press and drag a tape line — ends snap to corners, edges, hole centres and rims. Click a circular rim once for its true diameter; hole-to-hole clicks measure centre to centre. Tap a label to delete that measure."}
                </div>
              )}
              {p.measureCtl.mode && p.measureCtl.draft && (() => {
                const dm = p.measureCtl.draft;
                const mm = Math.hypot(dm.a[0] - dm.b[0], dm.a[1] - dm.b[1], dm.a[2] - dm.b[2]);
                const dist = p.units === "in" ? `${(mm / 25.4).toFixed(2)}″` : `${Math.round(mm * 10) / 10} mm`;
                return (
                  <div className="measure-confirm" role="group" aria-label="Confirm measurement">
                    <span className="mc-dist">{dist}</span>
                    <span className="mc-tip">Tap near either end to move it — ends snap to corners &amp; edges</span>
                    <button className="primary sm" onClick={p.measureCtl.saveDraft} title="Keep this measurement">Save</button>
                    <button className="ghost sm" onClick={p.measureCtl.discardDraft} title="Throw this measurement away">Discard</button>
                  </div>
                );
              })()}
              {p.tab === "3d" && p.splitCtl.pieces && p.splitCtl.pieces.length > 0 && (
                <SplitPiecesPanel splitCtl={p.splitCtl} />
              )}
              {p.booting && (
                <div className="viewer-overlay">
                  <Spinner /> Starting the CAD engine…
                  <br />
                  <small>loading OpenCascade (WASM)</small>
                </div>
              )}
              {/* A build in flight owns the canvas: what is being made, which phase it
                  is in, and a part visibly assembling itself. The bare "describe
                  something" line stayed up through the whole generation — the one
                  moment the user is definitely watching. */}
              {p.genProgress ? (
                <BuildStage progress={p.genProgress} />
              ) : (
                !p.booting && !p.geometry && <div className="viewer-overlay muted">Describe something or drop a photo to see it here.</div>
              )}
            </div>
            {/* Sibling of .right-dock, never a child: `.right-dock:empty { display: none }`
                is the only thing that hides that stack, so an always-rendered child there
                would leave an invisible box capturing clicks over the canvas. */}
            {!dockOpen && (
              <button className="dock-rail" title="Show inspector" aria-label="Show inspector" onClick={() => setDockOpen(true)}>
                <span className="dock-rail-label">‹ Inspector</span>
              </button>
            )}
            <aside className="inspector-dock" role="region" aria-label="Inspector" style={dockOpen ? ({ width: dockW } as CSSProperties) : { display: "none" }}>
              {/* Same separator the chat has, on the Inspector's outer (left) edge.
                  Dragging LEFT grows the panel, so the delta is negated. */}
              <div
                className="dock-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector"
                title="Drag to resize — double-click to reset"
                onPointerDown={(e) => {
                  e.preventDefault();
                  dockResize.current = { startX: e.clientX, startW: dockWRef.current };
                  try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
                }}
                onPointerMove={(e) => {
                  const r = dockResize.current;
                  if (!r) return;
                  setDockW(clampDockW(r.startW - (e.clientX - r.startX)));
                }}
                onPointerUp={(e) => {
                  if (!dockResize.current) return;
                  dockResize.current = null;
                  try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* already lost */ }
                  saveDockW(dockWRef.current);
                }}
                onPointerCancel={() => { dockResize.current = null; }}
                onDoubleClick={() => { setDockW(DOCK_W_DEFAULT); saveDockW(DOCK_W_DEFAULT); }}
              />
              <div className="dock-head">
                <p className="dock-eyebrow">Inspector</p>
                <button className="panel-collapse" aria-label="Hide inspector" title="Hide inspector" onClick={() => setDockOpen(false)}><IconChevron size={14} /></button>
              </div>
              {/* The section switcher, then one body underneath labelled with the active
                  section. Named rows cost ~300px — 40% of the dock — and pushed
                  Printability's own numbers off the bottom of a 900px window, so the
                  list packs down to a single icon row once you have picked a section.
                  Switching stays one tap; the body's uppercase label is what names
                  where you are. `dockPanel` and everything that drives it (a pick, the
                  Export button, Path to print) are unchanged. */}
              <div className={`dock-list${navNames ? "" : " icons"}`}>
                {DOCK_ITEMS.map(({ key, label, icon }) => (
                  <button key={key} className={`dock-item${dockPanel === key ? " on" : ""}`} aria-pressed={dockPanel === key}
                    title={navNames ? undefined : label} aria-label={label}
                    onClick={() => { setDockPanel(key); if (navNames) setNavNames(false); }}>
                    <span className="dock-ico" aria-hidden>{icon}</span>
                    {navNames && label}
                  </button>
                ))}
              </div>
              <div className="dock-body" role="region" aria-label={dockLabel}>
                <p className="dock-sec-label">
                  {dockLabel}
                  <button className="dock-names" aria-pressed={navNames} title={navNames ? "Pack the section list down to icons" : "Show the section names"} onClick={() => setNavNames(!navNames)}>
                    {navNames ? "Icons" : "Names"}
                  </button>
                </p>
                {dockPanel === "selection" && (
                  <DockSelection
                    feature={p.featureCtl.selected}
                    dims={p.dims}
                    units={p.units}
                    modelSelected={p.modelSelected}
                    modifying={!!p.modifyCtl.op}
                    onRestFace={(normal) => p.printPrep.orient.face(normal)}
                    ask={
                      p.facesCtl.faces.length > 0
                        ? {
                          text: p.facesCtl.text, setText: p.facesCtl.setText, onAsk: p.facesCtl.askAi, onClear: p.facesCtl.clear,
                          canAsk: p.activeKind === "replicad", busy: p.status === "generating",
                          placeholder: "e.g. add a 3 mm fillet to these · shell these 2 mm", count: p.facesCtl.faces.length,
                          kinds: p.facesCtl.faces.reduce((a, f) => ({ ...a, [f.kind]: (a[f.kind] ?? 0) + 1 }), {} as Record<string, number>),
                          applyAll: p.modifyCtl.op
                            ? {
                              label: p.modifyCtl.op.op === "push" ? "Push/Pull" : p.modifyCtl.op.op === "round" ? "Round" : "Angle",
                              size: Math.abs(p.modifyCtl.op.size),
                              run: () => p.facesCtl.directOp(p.modifyCtl.op!.size),
                            }
                            : undefined,
                        }
                        : p.featureCtl.selected
                          ? { text: p.featureCtl.text, setText: p.featureCtl.setText, onAsk: p.featureCtl.askAi, onClear: p.featureCtl.clear, canAsk: p.activeKind === "replicad", busy: p.status === "generating", placeholder: p.featureCtl.selected.kind === "edge" ? "e.g. add a 2 mm fillet · chamfer this edge 1 mm" : p.featureCtl.selected.kind === "vertex" ? "e.g. round this corner 3 mm" : "e.g. add two 4 mm screw holes · pocket 3 mm deep" }
                          : undefined
                    }
                  />
                )}
                {dockPanel === "objects" && objectsPanel}
                {dockPanel === "params" && (
                  <ParamsPanel defaults={p.cadDefaults} values={p.paramValues} busy={p.status === "generating"} isCad={p.activeKind === "replicad"} onApply={p.onApplyParams} onLive={p.onLiveParams} onSave={p.onSaveParams} onPeek={p.onPeekParam} onPeekEnd={p.onPeekParamEnd} />
                )}
                {dockPanel === "print" && (
                  <PrintabilityPanel report={p.report} canRepair={p.activeKind !== "replicad" && !!p.geometry} busy={p.status === "generating"} onRepair={p.onRepair} onSimplify={p.onSimplify} onSplit={p.onSplit} onFitToPlate={p.onFitToPlate} prep={p.printPrep} nozzleMM={p.printer.nozzleMM} pockets={p.pockets} />
                )}
                {dockPanel === "code" && (
                  <CodePanel activeKind={p.activeKind} codeText={p.codeText} streamingText={p.streamingText} generating={p.status === "generating"} onRerun={p.onRerun} />
                )}
                {dockPanel === "history" && <VersionHistory versions={p.versions} headId={p.headId} restoringId={p.restoringId} onRestore={p.onRestore} />}
                {dockPanel === "export" && <ExportPanel p={p} busy={!!p.exporting || p.status === "generating"} />}
              </div>
            </aside>
          </div>

          <div className="statusbar">
            <span className="dims">{p.dims ? fmtDims(p.dims, p.units) : "—"}</span>
            <button
              className="bedchip"
              title={`3D printer plate: ${p.printer.name ?? "generic"} — ${p.printer.bed.x} × ${p.printer.bed.y} × ${p.printer.bed.z} mm build volume. Tap to change printers.`}
              onClick={p.onOpenPrinterSettings}
            >
              <IconPrinter size={13} />
              {p.printer.name && <span className="bedchip-name">{p.printer.name}</span>}
              <span>{p.printer.bed.x}×{p.printer.bed.y}×{p.printer.bed.z} mm</span>
            </button>
            <PathToPrint hasModel={!!p.geometry} report={p.report} onOpenCheck={() => { setDockPanel("print"); setDockOpen(true); }} />
            {p.status === "generating" && <GenTimer />}
            <BuildTag />
            <DesktopUpdateChip />
            {/* Opens the Export panel in the dock rather than a dropdown of its own. The
                old .export-menu opted out of the app's solo-menu invariant and had no
                Escape or outside-click dismissal — it closed on re-click, onMouseLeave,
                or picking an item, and mouse-leave is unreachable on touch. */}
            <div className="export-wrap">
              <button className={`primary export-cta${dockPanel === "export" && dockOpen ? " on" : ""}`} disabled={!p.geometry} onClick={() => { setDockPanel("export"); setDockOpen(true); }}><IconExport size={14} /> Export</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// Desktop app only (never renders on the web, which is a self-updating PWA): the app
// installs new builds in the background and this chip narrates it. Only the restart is
// the user's call — nothing interrupts work mid-model.
function DesktopUpdateChip() {
  const [u, setU] = useState<UpdateState | null>(null);
  useEffect(() => {
    const build = Number(__BUILD_STAMP__);
    const off = watchDesktopUpdate(build, setU);
    const id = setInterval(() => void checkForUpdate(build), 6 * 3600_000); // long-lived windows still pick updates up
    return () => { off(); clearInterval(id); };
  }, []);
  if (!u) return null;
  if (u.phase === "installing") {
    return <span className="update-chip installing" title="Downloading and installing the new version in the background — keep working, nothing will interrupt you.">Updating…</span>;
  }
  if (u.phase === "ready") {
    return (
      <button className="update-chip" title={`Moldable ${u.version} is installed. Restart to start using it — your work is saved.`} onClick={() => void restartApp()}>
        Restart to update
      </button>
    );
  }
  return (
    <button
      className="update-chip"
      title={`Moldable v${u.version} is out (you're on v${__BUILD_STAMP__}). Downloads the installer — then drag Moldable to Applications (Mac) or run it (Windows).`}
      onClick={() => void openDownload(u.url)}
    >
      Update to v{u.version}
    </button>
  );
}

// Split a "provider|model" select value.
function splitVal(v: string): [string, string] {
  const i = v.indexOf("|");
  return i < 0 ? [v, ""] : [v.slice(0, i), v.slice(i + 1)];
}

// Split a model label like "Claude Fable 5 (most capable · ~10¢ per part)" into
// a short name + a muted sub-label. Native <select> could only show the whole
// long string; the custom menu shows the name big and the cost quiet.
function splitLabel(label: string): [string, string | undefined] {
  const i = label.indexOf(" (");
  if (i === -1) return [label, undefined];
  return [label.slice(0, i), label.slice(i + 2).replace(/\)\s*$/, "")];
}

type PickItem = { value: string; name: string; sub?: string; disabled?: boolean };
type PickGroup = { label: string; items: PickItem[] };

/** Compact, quiet model picker — a short-name trigger that opens a styled
 *  popover (bold name + muted sub-label), matching the export menu so the two
 *  read as one system. Replaces the native <select>, whose long label looked
 *  orphaned wrapping onto its own row. */
function ModelMenu({ value, groups, title, onPick, label }: { value: string; groups: PickGroup[]; title: string; onPick: (value: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const wrap = useRef<HTMLDivElement>(null);
  const current = groups.flatMap((g) => g.items).find((i) => i.value === value);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  // Position as a viewport-anchored popover: flip up/down to whichever side has
  // more room, clamp the height to that room, and clamp horizontally — so the
  // menu never runs off any edge, at any viewport size.
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const place = () => {
      const t = wrap.current!.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const width = Math.min(264, vw - 16);
      const above = t.top - 12, below = vh - t.bottom - 12;
      const up = above >= below;
      const maxHeight = Math.max(140, Math.min(380, up ? above : below));
      const left = Math.max(8, Math.min(t.left, vw - width - 8));
      setMenuStyle({
        position: "fixed", left, right: "auto", width, maxHeight,
        top: up ? "auto" : t.bottom + 6,
        bottom: up ? vh - t.top + 6 : "auto",
        transformOrigin: up ? "bottom left" : "top left",
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  return (
    <div className={label ? "modelpick2 mp-inline" : "modelpick2"} ref={wrap}>
      {label ? (
        <button type="button" className="msg-act mp-linktrigger" title={title} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {label} <IconChevron size={11} />
        </button>
      ) : (
        <button type="button" className="mp-trigger" title={title} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="mp-cur">{current?.name ?? "Choose model"}</span>
          <IconChevron size={13} />
        </button>
      )}
      {open && (
        <div className="mp-menu" role="listbox" style={menuStyle}>
          {groups.map((g) => (
            <div className="mp-group" key={g.label}>
              <div className="mp-glabel">{g.label}</div>
              {g.items.map((it) => (
                <button
                  type="button"
                  key={it.value}
                  role="option"
                  aria-selected={it.value === value}
                  className={`mp-item${it.value === value ? " on" : ""}`}
                  disabled={it.disabled}
                  onClick={() => { setOpen(false); onPick(it.value); }}
                >
                  <span className="mp-text">
                    <span className="mp-name">{it.name}</span>
                    {it.sub && <span className="mp-sub">{it.sub}</span>}
                  </span>
                  <span className="mp-ck">{it.value === value && <IconCheck size={12} />}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** First-class FDM fit control — how loose the fitted features should be.
 *  Snug is the sensible default; re-fitting is one click, not a reprint. */
const FIT_WHAT =
  "Only matters when a part has to mate with something — a lid on a box, a peg in a hole, a slot over a tab, the pins that hold two cut halves together. " +
  "FDM printers lay down plastic slightly wider than the model, so two parts printed at exactly the same size seize up. " +
  "This is the gap left on each side to compensate: Loose slides freely, Snug goes together by hand, Press needs a firm push and holds without glue. " +
  "It has nothing to do with whether the part fits your print bed — that is the 'Fits bed' check on the model. " +
  "Print the Tolerance test coupon (Templates) and enter what actually fit: this number becomes your printer's measurement instead of an estimate, and every hole the app drills — screw, magnet, insert — shifts by the same amount.";
const FIT_OPTS: { id: FitId; label: string; plain: string }[] = [
  // No millimetres in the hint: the real number comes from fitClearance(), which moves
  // with calibration. Baking one in here is how the tooltips came to disagree with it.
  { id: "loose", label: "Loose", plain: "Slides in and out freely" },
  { id: "snug", label: "Snug", plain: "Goes together by hand and stays put" },
  { id: "press", label: "Press", plain: "Needs a firm push, holds without glue" },
];
// Group builders shared by the composer pickers AND the per-message retry menu.
function brainValue(brain: { provider: LlmProviderId; model: string }): string {
  return brain.provider === "anthropic" ? `anthropic|${brain.model}` : `${brain.provider}|`;
}
function brainGroups(hasKey: (p: LlmProviderId) => boolean, brain?: { provider: LlmProviderId; model: string }): PickGroup[] {
  const claudeKey = hasKey("anthropic");
  return [
    {
      label: `Claude — most accurate${claudeKey ? "" : " · add key"}`,
      items: MODELS.map((mm) => { const [name, sub] = splitLabel(mm.label); return { value: `anthropic|${mm.id}`, name, sub }; }),
    },
    {
      label: "Other providers",
      // "house" (the site's sponsored built-in AI) is only offered once the relay's
      // health check confirmed it — hasKey("house") carries that answer.
      // "local" (on-device WebLLM) needs WebGPU — hidden on browsers without it.
      items: LLM_PRESETS.filter((pr) => pr.id !== "anthropic" && (pr.id !== "house" || hasKey("house")) && (pr.id !== "local" || localSupported())).map((pr) => {
        const needs = pr.needsKey && !hasKey(pr.id);
        const base = pr.label.split(" — ")[0];
        // Surface the active model on the current provider so the picker trigger
        // reads e.g. "OpenRouter · claude-sonnet-4.5" instead of just "OpenRouter".
        const active = brain?.provider === pr.id && brain.model ? shortModelName(brain.model) : "";
        const sub = [active, pr.free ? "free" : "", needs ? "add key" : ""].filter(Boolean).join(" · ") || undefined;
        return { value: `${pr.id}|`, name: active ? `${base} · ${active}` : base, sub };
      }),
    },
  ];
}
function engineGroups(hasKey: (p: string) => boolean): PickGroup[] {
  const auto: PickGroup = { label: "Automatic", items: [{ value: "auto|auto", name: "Auto", sub: "best engine for the job — picked per request" }] };
  return [auto, ...PROVIDERS.map((pv) => {
    const needs = pv.needsKey && !hasKey(pv.id);
    return {
      label: `${pv.label}${pv.free ? " · free" : ""}${needs ? " · add key" : ""}`,
      items: pv.models.map((mm) => {
        const [name, sub] = splitLabel(mm.label);
        // Price tag on every model — but not twice when the label already carries it.
        const cost = /\$|free/i.test(mm.label) ? "" : costLabel(pv.id, mm.id);
        return { value: `${pv.id}|${mm.id}`, name, sub: cost ? (sub ? `${sub} · ${cost}` : cost) : sub };
      }),
    };
  })];
}

/** In-chat quick switch for the Precise (CAD) AI brain. */
function BrainPicker({ brain, hasKey, onPick }: { brain: { provider: LlmProviderId; model: string }; hasKey: (p: LlmProviderId) => boolean; onPick: (p: LlmProviderId, m: string) => void }) {
  return <ModelMenu value={brainValue(brain)} groups={brainGroups(hasKey, brain)} title="Which AI writes the CAD — switch models on the fly" onPick={(v) => { const [prov, m] = splitVal(v); onPick(prov as LlmProviderId, m); }} />;
}

/** In-chat quick switch for the Generative (AI mesh) engine + model. */
function EnginePicker({ provider, model, hasKey, onPick }: { provider: string; model: string; hasKey: (p: string) => boolean; onPick: (p: string, m: string) => void }) {
  return <ModelMenu value={`${provider}|${model}`} groups={engineGroups(hasKey)} title="Which engine turns a photo or text into a mesh" onPick={(v) => { const [prov, m] = splitVal(v); onPick(prov, m); }} />;
}

/** Per-message "retry with a different model" — Perplexity-style. */
function RetryMenu({ mode, brain, hasBrainKey, genProvider, genModel, hasGenKey, onPick }: {
  mode: Mode; brain: { provider: LlmProviderId; model: string }; hasBrainKey: (p: LlmProviderId) => boolean;
  genProvider: string; genModel: string; hasGenKey: (p: string) => boolean; onPick: (value: string) => void;
}) {
  const value = mode === "generative" ? `${genProvider}|${genModel}` : brainValue(brain);
  const groups = mode === "generative" ? engineGroups(hasGenKey) : brainGroups(hasBrainKey, brain);
  return <ModelMenu value={value} groups={groups} title="Retry with a different model" onPick={onPick} label="Retry" />;
}

function Messages({ messages, thinking, onChip, onExample, onTemplate, onOpenTemplates, onStartGuided, resume, onResume, status, brain, hasBrainKey, genProvider, genModel, hasGenKey, onRetryModel, clarifyCtl, confirmCtl, planCtl, onDeleteMessage, selecting, onToggleSelect }: {
  messages: ChatMessage[]; thinking: string; onChip: (s: string, forceMode?: Mode) => void; onExample: () => void; onTemplate: (t: Template) => void; onOpenTemplates: () => void; onStartGuided: () => void; resume: string | null; onResume: () => void; status: "idle" | "generating";
  brain: { provider: LlmProviderId; model: string }; hasBrainKey: (p: LlmProviderId) => boolean; genProvider: string; genModel: string; hasGenKey: (p: string) => boolean;
  onRetryModel: (text: string, mode: Mode, value: string) => void;
  clarifyCtl: Props["clarifyCtl"];
  planCtl: Props["planCtl"];
  onDeleteMessage: (id: string) => void;
  confirmCtl: Props["confirmCtl"];
  /** Multi-select sweep: null = off; the Set while picking (owned by the chat bar). */
  selecting: Set<string> | null;
  onToggleSelect: (id: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  // Click-to-expand for photos in the transcript. One viewer for every image kind —
  // the row hands the URL up, Esc or any click dismisses.
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  useEffect(() => {
    if (!zoomImg) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoomImg(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomImg]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const lastText = messages[messages.length - 1]?.text;
  useEffect(() => {
    // No messages = the empty state (templates + suggestions): stay scrolled to its top.
    if (messages.length) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, lastText]);

  const busy = status === "generating";
  function startEdit(m: ChatMessage) {
    setEditingId(m.id);
    setEditText(m.text);
  }
  function submitEdit(m: ChatMessage) {
    const t = editText.trim();
    setEditingId(null);
    if (t) onChip(t, m.mode);
  }
  // Identity-stable handlers for the memoised rows below: the parent hands us fresh
  // closures on every keystroke, so route through a ref instead of passing them down
  // (a changing function prop would defeat the memo for every row).
  const rowCb = useRef({ startEdit, submitEdit, setEditingId, setEditText, onRetryModel, hasBrainKey, hasGenKey, clarifyCtl, confirmCtl, planCtl, onDeleteMessage, zoom: setZoomImg as (u: string) => void, toggle: onToggleSelect });
  rowCb.current = { startEdit, submitEdit, setEditingId, setEditText, onRetryModel, hasBrainKey, hasGenKey, clarifyCtl, confirmCtl, planCtl, onDeleteMessage, zoom: setZoomImg, toggle: onToggleSelect };
  const rowApi = useMemo(() => ({
    startEdit: (m: ChatMessage) => rowCb.current.startEdit(m),
    submitEdit: (m: ChatMessage) => rowCb.current.submitEdit(m),
    cancelEdit: () => rowCb.current.setEditingId(null),
    setEditText: (s: string) => rowCb.current.setEditText(s),
    onRetryModel: (text: string, mode: Mode, value: string) => rowCb.current.onRetryModel(text, mode, value),
    // App rebuilds these arrows every render; the rows must not see that churn.
    hasBrainKey: (p: LlmProviderId) => rowCb.current.hasBrainKey(p),
    hasGenKey: (p: string) => rowCb.current.hasGenKey(p),
    clarifyAnswer: (msgId: string, qid: string, v: string) => rowCb.current.clarifyCtl.answer(msgId, qid, v),
    clarifyBuild: (msgId: string, withAnswers: boolean) => rowCb.current.clarifyCtl.build(msgId, withAnswers),
    planChoose: (msgId: string, choice: "build" | "skip", edited?: BuildPlan) => rowCb.current.planCtl.choose(msgId, choice, edited),
    deleteMessage: (msgId: string) => rowCb.current.onDeleteMessage(msgId),
    confirmChoose: (msgId: string, yes: boolean) => rowCb.current.confirmCtl.choose(msgId, yes),
    offerChoose: (msgId: string, accepted: boolean) => rowCb.current.confirmCtl.offer(msgId, accepted),
    zoomImage: (url: string) => rowCb.current.zoom(url),
    toggleSelect: (msgId: string) => rowCb.current.toggle(msgId),
  }), []);

  // How many messages were already on screen when this list first mounted.
  const baseCountRef = useRef<number | null>(null);
  if (baseCountRef.current === null) baseCountRef.current = messages.length;
  const baseCount = baseCountRef.current;

  return (
    <div className={`messages${selecting ? " selecting" : ""}`}>
      {messages.length === 0 && (
        <div className="empty">
          <p className="empty-q">What do you want to make?</p>
          <p className="empty-sub">Type a description, attach a photo, or drop an SVG to extrude — plus 3D files: .step imports as editable CAD, .glb/.stl as a mesh.</p>
          <TemplateStrip onPick={onTemplate} onMore={onOpenTemplates} busy={busy} />
          <button className="guided-cta" onClick={onStartGuided}>
            <span className="gc-title">Fix a broken part</span>
            <span className="gc-sub">Photo → a dimension-accurate replacement that fits</span>
          </button>
          <div className="chips">
            {resume && (
              <button className="chip resume" onClick={onResume}>
                Continue where you left off — {resume}
              </button>
            )}
            {SUGGESTIONS.map((s) => (
              <button key={s.text} className="chip" onClick={() => onChip(s.text, s.gen ? "generative" : undefined)}>{s.text}</button>
            ))}
            <button className="chip subtle" onClick={onExample}>Try the built-in example (no API spend)</button>
          </div>
        </div>
      )}
      {messages.map((m, i) => (
        <Fragment key={m.id}>
          {/* Day separator wherever the calendar date changes between stamped
              messages — the transcript spans weeks of a project's life. */}
          {m.ts != null && new Date(m.ts).toDateString() !== new Date(messages[i - 1]?.ts ?? 0).toDateString() && (
            <div className="day-sep" role="separator">
              {new Date(m.ts).toLocaleDateString([], {
                month: "long", day: "numeric",
                year: new Date(m.ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
              })}
            </div>
          )}
        <MessageRow
          m={m}
          // Only replies that ARRIVE while you're watching get the type-on reveal.
          // Everything already in the transcript at mount (a reopened project, a
          // restored session) renders instantly — a whole history typing itself out
          // on load would be intolerable.
          fresh={i >= baseCount}
          // Narrowed on purpose: only the row being edited sees editText, and only the
          // streaming row sees `thinking` — so a keystroke or a token re-renders ONE
          // bubble instead of re-parsing every message's markdown.
          editing={editingId === m.id}
          editText={editingId === m.id ? editText : ""}
          thinking={m.streaming ? thinking : ""}
          busy={busy}
          // Primitives, not the `brain` object App rebuilds on every render.
          brainProvider={brain.provider}
          brainModel={brain.model}
          genProvider={genProvider}
          genModel={genModel}
          selectMode={!!selecting}
          selected={selecting?.has(m.id) ?? false}
          api={rowApi}
        />
        </Fragment>
      ))}
      <div ref={endRef} />
      {/* Enlarged photo, portal'd to the body so no card transform can clip it. */}
      {zoomImg && createPortal(
        <div className="img-lightbox" role="dialog" aria-label="Enlarged photo — click anywhere or press Esc to close" onClick={() => setZoomImg(null)}>
          <img src={zoomImg} alt="enlarged reference" />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A request the app could not build confidently, answered in place.
 *
 *  It opens with every question already carrying its recommended answer, so **Build it**
 *  works before the user touches anything. That is the whole design: the card exists to
 *  SHOW what the app was about to assume and let you correct it — not to make you fill
 *  in a form before it will work. Hence the second button, which builds the request
 *  exactly as typed and ignores the questions entirely.
 *
 *  Answered or skipped, the card freezes instead of vanishing, so the transcript still
 *  says which numbers the part was actually built from. */
/** The build plan, before anything is generated. Every line is editable in place —
 *  correcting "3 mm wall" to "2 mm" here costs a keystroke, whereas discovering it in
 *  the finished model costs another whole build (and on a mesh engine, real money).
 *  The assumptions block is deliberately loudest: unstated guesses are what produce a
 *  confidently wrong first model. */
function PlanCard({ msgId, st, busy, api }: {
  msgId: string;
  st: NonNullable<ChatMessage["plan"]>;
  busy: boolean;
  api: { planChoose: (msgId: string, choice: "build" | "skip", edited?: BuildPlan) => void };
}) {
  const [draft, setDraft] = useState<BuildPlan>(st.plan);
  const [editing, setEditing] = useState(false);
  const p = st.done ? st.plan : draft;
  const setLine = (key: "steps" | "assumptions", i: number, v: string) =>
    setDraft((d) => ({ ...d, [key]: d[key]!.map((x, j) => (j === i ? v : x)) }));
  const list = (key: "steps" | "assumptions", label: string, items: string[]) => (
    !!items.length && (
      <div className="plan-sect">
        <div className="plan-label">{label}</div>
        <ul className="plan-list">
          {items.map((x, i) => (
            <li key={i}>
              {editing
                ? <input className="plan-edit" value={x} onChange={(e) => setLine(key, i, e.target.value)} aria-label={`${label} ${i + 1}`} />
                : x}
            </li>
          ))}
        </ul>
      </div>
    )
  );
  return (
    <div className={`bubble plan-card${st.done ? " done" : ""}`}>
      <div className="plan-head">
        <span className="plan-kicker">Build plan</span>
        <b className="plan-title">{p.title}</b>
      </div>
      {p.summary && <p className="plan-sum">{p.summary}</p>}
      {p.size && <div className="plan-size">{p.size.x} × {p.size.y} × {p.size.z} mm</div>}
      {list("steps", "What gets built", p.steps)}
      {list("assumptions", "Assuming (change anything that's wrong)", p.assumptions)}
      {!!p.printNotes?.length && (
        <div className="plan-sect">
          <div className="plan-label">Printing</div>
          <ul className="plan-list">{p.printNotes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {st.done ? (
        <p className="fine">{st.chose === "build" ? "→ built from this plan" : "→ built from the original request"}</p>
      ) : (
        <div className="plan-actions">
          <button className="primary sm" disabled={busy} onClick={() => api.planChoose(msgId, "build", draft)}>Build this</button>
          <button className="ghost sm" disabled={busy} onClick={() => setEditing((v) => !v)}>{editing ? "Done editing" : "Edit plan"}</button>
          <button className="link" disabled={busy} onClick={() => api.planChoose(msgId, "skip")}>Skip the plan</button>
        </div>
      )}
    </div>
  );
}

function ClarifyCard({ msgId, c, busy, api }: {
  msgId: string; c: ClarifyState; busy: boolean;
  api: {
    clarifyAnswer: (msgId: string, qid: string, v: string) => void;
    clarifyBuild: (msgId: string, withAnswers: boolean) => void;
    planChoose: (msgId: string, choice: "build" | "skip", edited?: BuildPlan) => void;
    deleteMessage: (msgId: string) => void;
  };
}) {
  // Free-text lives here rather than in the message: an answer only becomes the message's
  // answer once it is non-empty, so clearing the box cannot silently blank a question.
  const [typed, setTyped] = useState<Record<string, string>>({});
  return (
    <div className={`clarify${c.done ? " done" : ""}`}>
      <p className="clarify-head">
        <IconSparkle size={14} />
        {c.done ? "Built with these" : "Two or three details and this will fit properly"}
      </p>
      {c.questions.map((q) => {
        const picked = c.answers[q.id] ?? "";
        return (
          <div className="clarify-q" key={q.id}>
            <p className="clarify-ask">{q.ask}</p>
            {q.why && <p className="clarify-why">{q.why}</p>}
            <div className="clarify-opts" role="radiogroup" aria-label={q.ask}>
              {q.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={picked === o.value}
                  className={`clarify-chip${picked === o.value ? " on" : ""}`}
                  disabled={c.done || busy}
                  onClick={() => {
                    setTyped((s) => ({ ...s, [q.id]: "" }));
                    api.clarifyAnswer(msgId, q.id, o.value);
                  }}
                >
                  {o.label}
                  {o.recommended && <span className="clarify-rec">suggested</span>}
                </button>
              ))}
            </div>
            {q.allowText && !c.done && (
              <input
                className="clarify-text"
                value={typed[q.id] ?? ""}
                placeholder="or type the exact measurement…"
                aria-label={`${q.ask} — type your own answer`}
                onChange={(e) => {
                  const v = e.target.value;
                  setTyped((s) => ({ ...s, [q.id]: v }));
                  if (v.trim()) api.clarifyAnswer(msgId, q.id, v.trim());
                }}
              />
            )}
          </div>
        );
      })}
      {!c.done && (
        <div className="clarify-actions">
          <button className="primary sm" disabled={busy} onClick={() => api.clarifyBuild(msgId, true)}>Build it</button>
          <button className="ghost sm" disabled={busy} onClick={() => api.clarifyBuild(msgId, false)}>Build what I asked for</button>
        </div>
      )}
    </div>
  );
}

/** One chat bubble. Memoised: chat history is immutable once written, so a row only
    re-renders when something about THAT message changes. */
const MessageRow = memo(function MessageRow({ m, fresh, editing, editText, thinking, busy, brainProvider, brainModel, genProvider, genModel, selectMode, selected, api }: {
  m: ChatMessage; fresh: boolean; editing: boolean; editText: string; thinking: string; busy: boolean;
  brainProvider: LlmProviderId; brainModel: string; genProvider: string; genModel: string;
  selectMode: boolean; selected: boolean;
  api: {
    startEdit: (m: ChatMessage) => void; submitEdit: (m: ChatMessage) => void;
    cancelEdit: () => void; setEditText: (s: string) => void;
    onRetryModel: (text: string, mode: Mode, value: string) => void;
    hasBrainKey: (p: LlmProviderId) => boolean; hasGenKey: (p: string) => boolean;
    clarifyAnswer: (msgId: string, qid: string, v: string) => void;
    clarifyBuild: (msgId: string, withAnswers: boolean) => void;
    planChoose: (msgId: string, choice: "build" | "skip", edited?: BuildPlan) => void;
    deleteMessage: (msgId: string) => void;
    confirmChoose: (msgId: string, yes: boolean) => void;
    offerChoose: (msgId: string, accepted: boolean) => void;
    zoomImage: (url: string) => void;
    toggleSelect: (msgId: string) => void;
  };
}) {
  const setEditingId = api.cancelEdit;
  const setEditText = api.setEditText;
  const submitEdit = api.submitEdit;
  const startEdit = api.startEdit;
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const onRetryModel = api.onRetryModel;
  const brain = useMemo(() => ({ provider: brainProvider, model: brainModel }), [brainProvider, brainModel]);
  const hasBrainKey = api.hasBrainKey;
  const hasGenKey = api.hasGenKey;
  return (
        <div
          className={`msg ${m.role} ${m.error ? "err" : ""}${selectMode ? " selectable" : ""}${selected ? " selected" : ""}`}
          onClick={selectMode ? () => api.toggleSelect(m.id) : undefined}
        >
          {/* In select mode the WHOLE row is the tap target — the mark just shows state. */}
          {selectMode && <span className="sel-mark" aria-hidden="true">{selected && <IconCheck size={11} />}</span>}
          <span className="who">
            {m.role === "user" ? "You" : "Moldable"}
            {m.ts != null && (
              <time className="msg-time" dateTime={new Date(m.ts).toISOString()}>
                {new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time>
            )}
          </span>
          {m.plan ? (
            <PlanCard msgId={m.id} st={m.plan} busy={busy} api={api} />
          ) : m.clarify ? (
            <ClarifyCard msgId={m.id} c={m.clarify} busy={busy} api={api} />
          ) : m.confirm ? (
            <div className="bubble confirm-card">
              <p className="cc-text">{m.confirm.text}</p>
              {m.confirm.done ? (
                <p className="fine">{m.confirm.chose === "mesh" ? "→ generating the mesh" : "→ building it as a free CAD part"}</p>
              ) : (
                <div className="edit-actions">
                  <button className="primary sm" disabled={busy} onClick={() => api.confirmChoose(m.id, true)}>{m.confirm.yes}</button>
                  <button className="ghost sm" disabled={busy} onClick={() => api.confirmChoose(m.id, false)}>{m.confirm.no}</button>
                </div>
              )}
            </div>
          ) : m.offer ? (
            <div className="bubble confirm-card">
              <p className="cc-text">{m.offer.text}</p>
              {m.offer.done ? (
                <p className="fine">{m.offer.accepted ? `→ ${m.offer.yes}` : `→ ${m.offer.no}`}</p>
              ) : (
                <div className="edit-actions">
                  <button className="primary sm" disabled={busy} onClick={() => api.offerChoose(m.id, true)}>{m.offer.yes}</button>
                  <button className="ghost sm" disabled={busy} onClick={() => api.offerChoose(m.id, false)}>{m.offer.no}</button>
                </div>
              )}
            </div>
          ) : editing ? (
            <div className="bubble-edit">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(m); }
                  if (e.key === "Escape") setEditingId();
                }}
              />
              <div className="edit-actions">
                <button className="ghost sm" onClick={() => setEditingId()}>Cancel</button>
                <button className="primary sm" disabled={!editText.trim() || busy} onClick={() => submitEdit(m)}>Send</button>
              </div>
            </div>
          ) : (
            <>
              {/* The working state is NOT a bubble: while it's thinking there's no reply
                  to contain, and the grey slab made the timeline read as an answer. The
                  checks and step text sit straight on the chat background (both themes
                  carry enough contrast), and the bubble arrives with the reply itself. */}
              <div className={m.role === "assistant" && m.streaming ? "bubble-open" : `bubble ${m.streaming ? "muted" : ""}`}>
                {m.image && <img className="bubble-img zoomable" src={m.image} alt="reference — click to enlarge" title="Click to enlarge" onClick={() => !selectMode && api.zoomImage(m.image!)} />}
                {/* Every photo travelling with this message, INSIDE the bubble: extra
                    uploads on a user message, product photos found online on a research
                    note. A thumb that 404s or blocks hotlinking hides itself. */}
                {!!m.images?.length && (
                  <div className="ref-strip">
                    {m.images.map((u, i) => (
                      // Attached photos enlarge in place; web finds still open their page.
                      <a key={i} href={u.startsWith("data:") ? undefined : u} target="_blank" rel="noopener noreferrer"
                        title={u.startsWith("data:") ? "Attached reference photo — click to enlarge" : "Product photo found online — open full size"}
                        onClick={u.startsWith("data:") ? () => !selectMode && api.zoomImage(u) : undefined}>
                        <img className={u.startsWith("data:") ? "zoomable" : undefined} src={u} alt="reference photo" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                      </a>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && m.streaming ? (
                  /* Working reply: a step timeline — done stages check off and draw a
                     connector line down to the next; `text` is the live (shimmering) one. */
                  <ThinkSteps steps={m.steps ?? []} active={m.text} />
                ) : (
                  m.text && (m.role === "assistant" && !m.error
                    ? <Reveal text={m.text} animate={fresh} />
                    : <span>{m.text}</span>)
                )}
                {/* A web lookup, said out loud. The globe spins while the request is
                    actually in flight and the pages it used arrive as chips — the
                    difference between "the app is online for me" and "the app hung". */}
                {m.web && (
                  <div className={`web-live${m.web.done ? " done" : ""}`}>
                    <span className="web-live-head">
                      <span className="web-live-globe"><IconGlobe size={13} /></span>
                      {m.web.done
                        ? m.web.found
                          ? `Searched the web · ${m.web.sources?.length ?? 0} source${m.web.sources?.length === 1 ? "" : "s"}`
                          : "Searched the web · nothing solid found"
                        : "Searching the web…"}
                    </span>
                    <span className="web-live-q">{m.web.query}</span>
                    {!!m.web.sources?.length && (
                      <span className="web-live-src">
                        {m.web.sources.map((sc, i) => (
                          <a key={i} className="src-chip" href={sc.url} target="_blank" rel="noopener noreferrer" title={sc.title ?? sc.url}>{hostOf(sc.url)}</a>
                        ))}
                      </span>
                    )}
                  </div>
                )}
                {/* The model's own reasoning, streaming under the timeline. */}
                {m.streaming && thinking && (
                  <div className="think-live">
                    <span className="think-title">Model reasoning</span>
                    <ThinkScroll text={thinking} />
                  </div>
                )}
              </div>
              {/* Finished reply: reasoning kept, collapsed; sources; which model wrote it. */}
              {!m.streaming && m.thinking && (
                <details className="think-done">
                  <summary>Thought process</summary>
                  <div className="think-body">{m.thinking}</div>
                </details>
              )}
              {!!m.sources?.length && (
                <div className="src-row">
                  {m.sources.map((sc, i) => (
                    <a key={i} className="src-chip" href={sc.url} target="_blank" rel="noopener noreferrer" title={sc.title ?? sc.url}>
                      {hostOf(sc.url)}
                    </a>
                  ))}
                </div>
              )}
              {m.role === "assistant" && !m.streaming && m.model && (
                <span className="msg-model">
                  {m.model}
                  {/* Beta cost meter, small print: tokens and dollars this reply cost
                      (summed over retries). ≈ marks estimated figures — see pricing.ts. */}
                  {m.usage && ` · ${fmtTok(m.usage.inTok + m.usage.outTok)} tok · ${fmtUSD(m.usage.usd, m.usage.est)}`}
                </span>
              )}
              {/* Retry / edit any typed prompt — including one sent with a photo, so
                  a failed generation can be re-run (the attached photo, if still in
                  the composer, rides along). */}
              {(m.role === "user" ? !!m.text : !m.streaming) && (
                <div className="msg-actions">
                  {m.role === "user" && m.text && (
                    <>
                      {busy ? (
                        <span className="msg-act" style={{ opacity: 0.4 }}>Retry</span>
                      ) : (
                        <RetryMenu mode={m.mode ?? "precise"} brain={brain} hasBrainKey={hasBrainKey} genProvider={genProvider} genModel={genModel} hasGenKey={hasGenKey}
                          onPick={(value) => onRetryModel(m.text, m.mode ?? "precise", value)} />
                      )}
                      <button className="msg-act" disabled={busy} title="Edit this message and resend" onClick={() => startEdit(m)}>Edit</button>
                    </>
                  )}
                  {/* Two-step rather than a dialog: a transcript line is small enough
                      that a modal over the whole app is heavier than the thing being
                      deleted, but it still can't go on one stray click. */}
                  {confirmDel === m.id ? (
                    <>
                      <button className="msg-act danger" onClick={() => { setConfirmDel(null); api.deleteMessage(m.id); }}>Delete?</button>
                      <button className="msg-act" onClick={() => setConfirmDel(null)}>Keep</button>
                    </>
                  ) : (
                    <button className="msg-act" title="Delete this message" onClick={() => setConfirmDel(m.id)}>Delete</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
  );
});

/** Domain label for a source chip ("support.apple.com" → "apple.com"). */
function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const parts = h.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : h;
  } catch {
    return url.slice(0, 24);
  }
}

/** A reply arriving: the opening runs out character by character under a caret, and
 *  about a third of the way in the rest of the answer fades up into place behind it.
 *  Typing the WHOLE thing would make a long reply slower to appear than to read, and
 *  fading the whole thing has no sense of something being written — the handoff is the
 *  point. Rendered as plain text while typing and as markdown from the handoff on, so
 *  no half-parsed `**` is ever on screen. Honours prefers-reduced-motion. */
function Reveal({ text, animate }: { text: string; animate: boolean }) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [typed, setTyped] = useState(() => (animate && !reduced ? 0 : -1)); // -1 = done
  // Deliberately NOT keyed on `typed`: depending on the state the loop sets makes the
  // effect's own cleanup cancel the frame it just scheduled, and the text freezes one
  // character in. One run per message, one rAF loop, driven to completion.
  useEffect(() => {
    if (!animate || reduced) return;
    const target = Math.max(1, Math.round(text.length * 0.35));
    const dur = Math.min(900, 120 + target * 11); // long replies don't type for longer
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      if (k >= 1) { setTyped(-1); return; }
      setTyped(Math.max(1, Math.round(target * k)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, animate, reduced]);
  if (typed < 0) return <div className={animate && !reduced ? "reveal-rest" : undefined}><Markdown text={text} /></div>;
  return <span className="reveal-type">{text.slice(0, typed)}</span>;
}

/** The working reply as a step timeline: every completed stage keeps its row (check
 *  + a connector line drawn down to the next), the active stage shimmers under a
 *  pulsing dot. Keys matter: when a stage completes, the active row remounts as a
 *  done row, which is what replays the check-pop → line-draw → next-step-fade-in
 *  sequence on every advance. */
function ThinkSteps({ steps, active }: { steps: string[]; active: string }) {
  return (
    <div className="think-steps" role="status" aria-label="Working">
      {steps.map((s, i) => (
        <div key={i} className="tstep done">
          <span className="tstep-rail">
            <span className="tstep-dot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span className="tstep-line" />
          </span>
          <span className="tstep-label">{s}</span>
        </div>
      ))}
      <div key={`live-${steps.length}`} className="tstep active">
        <span className="tstep-rail">
          <span className="tstep-dot"><i className="tstep-pulse" /></span>
        </span>
        <span className="tstep-label">{active}</span>
      </div>
    </div>
  );
}

/** The live reasoning text, auto-pinned to its newest line as it streams. */
function ThinkScroll({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [text]);
  return <div ref={ref} className="think-body live">{text}</div>;
}

/** Live elapsed-time pill while the AI/kernel is working. */
function GenTimer() {
  const [t0] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const secs = Math.floor((Date.now() - t0) / 1000);
  const label = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  return (
    <span className="pill gen-pill" role="timer">
      <span className="spinner sm" /> generating · {label}
    </span>
  );
}

function CodePanel({ activeKind, codeText, streamingText, generating, onRerun }: { activeKind: EngineKind; codeText: string; streamingText: string; generating: boolean; onRerun: (s: string) => void }) {
  const [buf, setBuf] = useState(codeText);
  useEffect(() => setBuf(codeText), [codeText]);
  const shown = generating && streamingText ? streamingText : buf;
  const canRerun = activeKind === "replicad" || activeKind === "primitive";
  const label = activeKind === "replicad" ? "replicad (JavaScript)" : activeKind === "generative" ? "generative source (read-only)" : "primitive spec (JSON)";
  return (
    <div className="code-panel">
      <div className="code-head">
        <span>{label}</span>
        {canRerun && (
          <button className="primary sm" disabled={generating} onClick={() => onRerun(buf)}>Re-run</button>
        )}
      </div>
      <textarea className="code" spellCheck={false} value={shown} readOnly={generating || !canRerun} onChange={(e) => setBuf(e.target.value)} />
    </div>
  );
}

function PrintabilityPanel({ report, canRepair, busy, onRepair, onSimplify, onSplit, onFitToPlate, prep, nozzleMM, pockets }: { report: PrintabilityReport | null; canRepair: boolean; busy: boolean; onRepair: () => void; onSimplify: () => void; onSplit: () => void; onFitToPlate: () => void; prep: PrintPrepCtl; nozzleMM: number; pockets: PocketFacing | null }) {
  if (!report) return <div className="panel muted">No model analysed yet.</div>;
  const sug = prep.orient.suggestion;
  const thin = prep.thin.report;
  const row = (label: string, value: string, ok?: boolean) => (
    <div className="prow">
      <span>{label}</span>
      <span className={ok === undefined ? "" : ok ? "ok" : "no"}>{value}</span>
    </div>
  );
  return (
    <div className="panel">
      <h3>Printability</h3>
      {row("Fits the bed", report.bedFit.fitsAsIs ? "yes" : report.bedFit.fitsWithRotation ? "rotated" : "no", report.bedFit.fitsRotated)}
      {row("Watertight / manifold", report.manifold.isWatertight ? "yes" : `${report.manifold.boundaryEdges} open edge(s)`, report.manifold.isWatertight)}
      {row("Bounding box", `${report.boundingBox.size.x} × ${report.boundingBox.size.y} × ${report.boundingBox.size.z} mm`)}
      {row("Triangles", report.triangleCount.toLocaleString())}
      {row("Approx. volume", `${(report.volume.approxVolume / 1000).toFixed(1)} cm³`)}
      {row(`Overhangs > ${report.overhangs.thresholdDeg}°`, report.overhangs.overhangTriangleCount > 0 ? `${(report.overhangs.ratio * 100).toFixed(0)}% of faces` : "none", report.overhangs.overhangTriangleCount === 0)}
      {report.warnings.length > 0 && (
        <ul className="warns">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {canRepair && (
        <div className="param-actions" style={{ flexWrap: "wrap" }}>
          {!report.manifold.isWatertight && (
            <button className="primary sm" disabled={busy} onClick={onRepair}>
              Fix model — make it watertight
            </button>
          )}
          <button className="ghost sm" disabled={busy} onClick={onSimplify}>
            Simplify model — halve triangles
          </button>
        </div>
      )}
      {!report.bedFit.fitsRotated && (
        <div className="param-actions" style={{ flexWrap: "wrap" }}>
          <button className="primary sm" disabled={busy} onClick={onFitToPlate} title="Uniformly shrink the model until it fits the plate — one tap, undoable">
            Scale to fit bed
          </button>
          <button className="ghost sm" disabled={busy} onClick={onSplit}>
            Split to fit bed — print in pieces
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 14 }}>Print prep</h3>
      <div className="param-actions" style={{ flexWrap: "wrap" }}>
        <button className="ghost sm" onClick={prep.toggleOverhang} title="Paint every face steeper than the printer's overhang limit — amber at the limit, red for ceilings that definitely need support">
          {prep.overhangOn ? "✓ Overhang heatmap" : "Overhang heatmap"}
        </button>
        <button className="ghost sm" disabled={busy} onClick={prep.orient.auto} title="Score every big face as a base, rotate the part to the one needing the least support, and rest it flat on the plate — one click, undoable">
          Lay flat — best orientation
        </button>
        <button className="ghost sm" disabled={busy || prep.thin.busy} onClick={prep.thin.run} title={`Sample the surface and measure wall thickness by ray-casting — flags walls under ${Math.round(nozzleMM * 2 * 100) / 100} mm (2 perimeters at your ${nozzleMM} mm nozzle)`}>
          {prep.thin.busy ? "Checking walls…" : "Check wall thickness"}
        </button>
        {prep.chamfer.can && (
          <button className="ghost sm" disabled={busy || prep.chamfer.done} onClick={() => prep.chamfer.apply(0.4)} title="Bevel every bottom edge by 0.4 mm so the squished first layer (elephant foot) doesn't bulge past the true footprint">
            {prep.chamfer.done ? "✓ Elephant-foot bevel" : "Elephant-foot bevel"}
          </button>
        )}
      </div>
      {sug && (
        <div className="prow-note">
          <p className="fine" style={{ margin: "6px 0 4px" }}>
            {sug.improved
              ? `Better orientation found: rotate ${sug.angleDeg}°. ${sug.reason}`
              : sug.reason}
          </p>
          {sug.improved && (
            <div className="param-actions">
              <button className="primary sm" disabled={busy} onClick={prep.orient.apply}>Apply rotation</button>
            </div>
          )}
        </div>
      )}
      {thin && (
        <div className="prow-note">
          <p className="fine" style={{ margin: "6px 0 4px" }}>
            {thin.thinSamples > 0
              ? `⚠️ ${thin.thinSamples} of ${thin.sampled} sampled spots are under ${thin.thresholdMM} mm (thinnest ≈ ${thin.minThicknessMM} mm) — they may print fragile or vanish. Thicken them${nozzleMM > 0.25 ? ", or fit a smaller nozzle" : ""}.`
              : thin.sampled > 0
                ? `No thin walls in ${thin.sampled} sampled spots — thinnest measured ≈ ${thin.minThicknessMM} mm (limit ${thin.thresholdMM} mm). A sample, not a proof: a sliver smaller than the sampling grid can still slip through.`
                : "Couldn't measure walls here (open surfaces) — run Fix model first."}
          </p>
          {thin.thinSamples > 0 && (
            <div className="param-actions">
              <button className="ghost sm" onClick={prep.thin.toggleShown}>{prep.thin.shown ? "Hide highlight" : "Show on model"}</button>
            </div>
          )}
        </div>
      )}
      {pockets && pocketAdvice(pockets) && <p className="fine">⚠️ Pockets: {pocketAdvice(pockets)}</p>}
      <p className="fine">Generated meshes are often not watertight — that's expected. Simplify when a slicer (e.g. Bambu Studio) chokes on the triangle count. Wall/overhang are heuristics; bed-fit &amp; watertight are exact for this mesh.</p>
    </div>
  );
}

/** Restoring records a new version whose summary quotes the old one — restore twice
 *  and every row reads `Restored "Restored "Adjusted…""`, which is how a history panel
 *  ends up looking like the same row eight times. Unwrap to the change that actually
 *  happened and carry "restored" as a tag instead. */
function versionLabel(summary: string): { text: string; restored: boolean } {
  let text = summary;
  let restored = false;
  for (;;) {
    const m = text.match(/^Restored\s+[“"](.*)[”"]$/s);
    if (!m) break;
    text = m[1];
    restored = true;
  }
  return { text, restored };
}

/** "just now" / "14m ago" / a clock time once it stops being about recency. */
function whenLabel(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

const VersionHistory = memo(function VersionHistory({ versions, headId, restoringId, onRestore }: {
  versions: Version[];
  headId?: string; // where the model actually IS — undo moves this without touching the list
  restoringId: string | null;
  onRestore: (id: string) => void;
}) {
  if (versions.length === 0) return <div className="panel muted">No versions yet — each change is saved here.</div>;
  // Newest first, the way every history panel works — and each row carries its step
  // NUMBER counted from the first version, so "which came before which" is readable
  // without doing arithmetic on timestamps.
  const list = versions.map((v, i) => ({ v, step: i + 1 })).reverse();
  // "Current" is HEAD, not the newest row. After an undo those differ, and marking
  // the tip current put a Restore button on the state you were already in — press it
  // and the model rebuilds to exactly what's on screen, which reads as a dead button.
  const head = headId && versions.some((v) => v.id === headId) ? headId : versions[versions.length - 1]?.id;
  return (
    <div className="panel vhistory">
      <div className="vhead">
        <h3>History</h3>
        <span className="fine">{versions.length} step{versions.length === 1 ? "" : "s"} · newest first</span>
      </div>
      <div className="vlist">
        {list.map(({ v, step }) => {
          const { text, restored } = versionLabel(v.summary);
          const isHead = v.id === head;
          const busy = restoringId === v.id;
          const meta = `${step} · ${whenLabel(v.createdAt)}${v.dims ? ` · ${v.dims.x}×${v.dims.y}×${v.dims.z} mm` : ` · ${v.engine}`}`;
          // The ROW is the control. A separate Restore button next to a big thumbnail
          // left about seventy pixels for the summary in a 262px dock, which clipped
          // every label to two characters — and "click the version you want" is what
          // people try first anyway.
          return (
            <button
              key={v.id}
              type="button"
              className={`vrow${isHead ? " current" : ""}${busy ? " loading" : ""}`}
              disabled={isHead || !!restoringId}
              title={isHead ? `${text} — this is what you're looking at` : `Go back to: ${text}`}
              onClick={() => onRestore(v.id)}
            >
              {v.thumb
                ? <img className="vthumb" src={v.thumb} alt="" aria-hidden loading="lazy" decoding="async" />
                : <span className="vthumb vthumb-empty" aria-hidden />}
              <span className="vbody">
                <span className="vsum">{text}</span>
                <span className="vmeta">{meta}</span>
                <span className="vstate">
                  {isHead ? <span className="vtag now">Current</span>
                    : busy ? <span className="vtag">Loading…</span>
                      : <><span className="vgo">Go back to this</span>{restored && <span className="vtag">restored</span>}</>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="fine">Restoring adds a step rather than deleting any — nothing is lost. The oldest steps drop off past {MAX_VERSIONS}.</p>
    </div>
  );
});
/** Hole tool: exact placement (typed offsets + magnet snap) and alignment against an
    existing hole — pick its rim/wall, then zero a delta or type the exact spacing. */
function HolePanel({ ctl, busy }: { ctl: Props["holeCtl"]; busy: boolean }) {
  const d = ctl.draft!;
  const axes = ctl.axes ?? [0, 1];
  const AX = "XYZ";
  const r1 = (v: number) => Math.round(v * 100) / 100;
  // Fastener presets: the current draft matches a preset when ⌀+depth agree.
  const preset = fastenerFor(d.diameter, d.depth);
  const activePreset = preset?.id ?? "";
  const bossHint = preset ? insertBossHint(preset) : null;
  const calNote = fastenerCalNote();
  const spacing = d.ref ? Math.hypot(d.at[axes[0]] - d.ref.center[axes[0]], d.at[axes[1]] - d.ref.center[axes[1]]) : 0;
  const setSpacing = (target: number) => {
    if (!d.ref || spacing < 0.01 || target <= 0) return;
    const k = target / spacing;
    ctl.setAxis(axes[0], d.ref.center[axes[0]] + (d.at[axes[0]] - d.ref.center[axes[0]]) * k);
    ctl.setAxis(axes[1], d.ref.center[axes[1]] + (d.at[axes[1]] - d.ref.center[axes[1]]) * k);
  };
  return (
    <div className="pin-panel hole-panel">
      <div className="pin-head">
        <span>Drill a hole — free, no AI</span>
        <button className="x" aria-label="Cancel hole" onClick={ctl.cancel}><IconX /></button>
      </div>
      <div className="hp-row">
        <label>for</label>
        <select
          value={activePreset}
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Fastener preset"
          title="Fastener presets — sets the right hole size for heat-set inserts, screw clearance, or screws that thread into the plastic"
          onChange={(e) => {
            const f = findFastener(e.target.value);
            if (f) ctl.patch(fastenerHole(f));
          }}
        >
          <option value="">Custom size…</option>
          {FASTENER_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((i) => (
                <option key={i.id} value={i.id}>{fastenerLabel(i)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {calNote && <div className="fine" style={{ margin: "2px 0 4px" }}>{calNote}</div>}
      {bossHint && <div className="fine" style={{ margin: "2px 0 4px" }}>{bossHint}</div>}
      <div className="hp-row">
        <label>⌀</label>
        <input type="number" min={0.5} max={100} step={0.1} value={d.diameter} onChange={(e) => ctl.patch({ diameter: Math.max(0.5, Number(e.target.value) || 0) })} aria-label="Hole diameter (mm)" />
        <span className="fine">mm</span>
        <label className="hp-through">
          <input type="checkbox" checked={d.depth === 0} onChange={(e) => ctl.patch({ depth: e.target.checked ? 0 : 5 })} /> through
        </label>
        {d.depth > 0 && (
          <>
            <input type="number" min={0.5} step={0.5} value={d.depth} onChange={(e) => ctl.patch({ depth: Math.max(0.5, Number(e.target.value) || 0) })} aria-label="Hole depth (mm)" />
            <span className="fine">mm deep</span>
          </>
        )}
      </div>
      <div className="hp-row">
        <label>at</label>
        {axes.map((ax) => (
          <span className="hp-axis" key={ax}>
            <b>{AX[ax]}</b>
            <input type="number" step={d.snap || 0.1} value={r1(d.at[ax])} onChange={(e) => ctl.setAxis(ax, Number(e.target.value) || 0)} aria-label={`Hole ${AX[ax]} position (mm)`} />
          </span>
        ))}
        <select value={d.snap} onChange={(e) => ctl.patch({ snap: Number(e.target.value) })} title="Magnet: typed and aligned positions snap to this increment" aria-label="Magnet increment">
          <option value={0}>free</option>
          <option value={0.5}>0.5 mm</option>
          <option value={1}>1 mm</option>
          <option value={2.5}>2.5 mm</option>
          <option value={5}>5 mm</option>
        </select>
      </div>
      {!d.ref ? (
        <button className={`ghost sm${d.picking ? " on" : ""}`} style={{ width: "100%" }} onClick={() => ctl.patch({ picking: !d.picking })}>
          {d.picking ? "Now click the other hole (its rim or inner wall)…" : "Align with another hole…"}
        </button>
      ) : (
        <div className="hp-ref">
          <div className="fine">Reference hole{d.ref.diameter ? ` ⌀${d.ref.diameter} mm` : ""} · centre {axes.map((ax) => `${AX[ax]} ${r1(d.ref!.center[ax])}`).join(", ")}</div>
          <div className="hp-row">
            {axes.map((ax) => (
              <span className="hp-axis" key={ax}>
                <b>Δ{AX[ax]}</b>
                <input type="number" step={d.snap || 0.1} value={r1(d.at[ax] - d.ref!.center[ax])} onChange={(e) => ctl.setAxis(ax, d.ref!.center[ax] + (Number(e.target.value) || 0))} aria-label={`Offset from reference in ${AX[ax]} (mm)`} />
                <button className="ghost sm" title={`Align ${AX[ax]} with the reference hole (Δ${AX[ax]} = 0)`} onClick={() => ctl.setAxis(ax, d.ref!.center[ax])}>=</button>
              </span>
            ))}
          </div>
          <div className="hp-row">
            <label>spacing</label>
            <input type="number" min={0} step={d.snap || 0.1} value={r1(spacing)} onChange={(e) => setSpacing(Number(e.target.value) || 0)} aria-label="Centre-to-centre spacing (mm)" />
            <span className="fine">mm centre-to-centre</span>
            <button className="ghost sm" title="Forget the reference" onClick={() => ctl.patch({ ref: null })}>×</button>
          </div>
        </div>
      )}
      <div className="param-actions">
        <button className="primary sm" disabled={busy || d.diameter <= 0} onClick={ctl.apply}>Drill hole</button>
        <button className="ghost sm" onClick={ctl.cancel}>Cancel</button>
      </div>
      <p className="fine">Hover the face to preview, click to set — guide lines light up solid when the hole lines up with the reference. {AX[3 - axes[0] - axes[1]]} is locked — the hole sits on the picked face.</p>
    </div>
  );
}

/** Multi-face quick edit: one distance, applied to EVERY selected face — local, no AI. */
function MultiFaceOpRow({ count, busy, isCad, onApply }: { count: number; busy: boolean; isCad: boolean; onApply: (size: number) => void }) {
  const [size, setSize] = useState(2);
  if (!isCad) return null;
  return (
    <div className="directop">
      <span className="directop-label">Quick edit — free, no AI</span>
      <div className="directop-row">
        <input type="number" min={-50} max={50} step={0.2} value={size} onChange={(e) => setSize(Number(e.target.value) || 0)} aria-label="size in mm" />
        <span className="fine">mm</span>
        <button className="ghost sm" disabled={busy || !size} onClick={() => onApply(size)} title={`Push all ${count} faces out (+) or in (−) by ${size} mm — no tokens`}>
          Push / Pull all {count}
        </button>
      </div>
    </div>
  );
}

// Free, instant geometry ops on the picked edge/corner/face — computed locally by
// replicad, no AI call. Faces also get Push / Pull.
function DirectOpBar({ kind, busy, onApply, liveSize, onHole }: { kind: SelectKind; busy: boolean; onApply: (type: PointOp["type"], size: number) => void; liveSize?: number | null; onHole?: () => void }) {
  const [size, setSize] = useState(2);
  // Dragging the on-model arrow mirrors its live value into the box, so the number
  // visibly follows the drag (and is ready to fine-tune or re-apply).
  useEffect(() => { if (liveSize != null) setSize(liveSize); }, [liveSize]);
  const face = kind === "face";
  const what = kind === "vertex" ? "corner" : kind === "face" ? "face" : "edge";
  const round: PointOp["type"] = face ? "face-fillet" : "fillet";
  const chamfer: PointOp["type"] = face ? "face-chamfer" : "chamfer";
  return (
    <div className="directop">
      <span className="directop-label">Quick edit — free, no AI</span>
      <div className="directop-row">
        <input
          type="number" min={face ? -50 : 0.2} max={50} step={0.2} value={size}
          onChange={(e) => setSize(Number(e.target.value) || 0)}
          aria-label="size in mm"
        />
        <span className="fine">mm</span>
        <button className="ghost sm" disabled={busy || !size} onClick={() => onApply(round, Math.abs(size))} title={`Round the ${what}'s edges by ${Math.abs(size)} mm — no tokens`}>Round</button>
        <button className="ghost sm" disabled={busy || !size} onClick={() => onApply(chamfer, Math.abs(size))} title={`Bevel the ${what}'s edges by ${Math.abs(size)} mm — no tokens`}>Bevel</button>
        {face && <button className="ghost sm" disabled={busy || !size} onClick={() => onApply("extrude", size)} title={`Push this face out (+) or in (−) by ${size} mm — no tokens`}>Push / Pull</button>}
        {face && onHole && <button className="ghost sm" disabled={busy} onClick={onHole} title="Drill a hole at this spot — with exact offsets, magnet snapping, and alignment to another hole">Hole…</button>}
      </div>
      {face && <p className="fine">Positive pushes the face out, negative pulls it in — or drag the blue arrow on the face.</p>}
      {kind === "edge" && <p className="fine">Or drag the blue arrow to round this edge live.</p>}
    </div>
  );
}

function SplitPiecesPanel({ splitCtl }: { splitCtl: Props["splitCtl"] }) {
  const [format, setFormat] = useState<"stl" | "3mf">("stl");
  const pieces = splitCtl.pieces ?? [];
  return (
    <div className="split-panel">
      <div className="pin-head">
        <span>{pieces.length} pieces</span>
        <button className="x" aria-label="Hide pieces list" onClick={splitCtl.clear}><IconX /></button>
      </div>
      <p className="fine">Export them from the <b>Export</b> panel — one zip, or per piece.</p>
      {!splitCtl.plated ? (
        <button
          className="ghost sm"
          title="Assign every piece its own build plate — Export → Project 3MF then opens in Bambu/Orca with one plate per piece (centred), and One-file-per-plate writes a 3MF each"
          onClick={splitCtl.toPlates}
        >
          Each piece → its own plate
        </button>
      ) : (
        <p className="fine">On separate plates — <b>Export → Project 3MF</b> (or one file per plate) writes them that way.</p>
      )}
      <div className="split-list">
        {pieces.map((pc, i) => (
          <div className="split-row" key={i}>
            <span className="split-swatch" style={{ background: pc.color }} />
            <span className="split-label">Part {i + 1}<span className="fine"> · {pc.dims.x} × {pc.dims.y} × {pc.dims.z} mm{pc.plate != null ? ` · Plate ${pc.plate}` : ""}</span></span>
            <button className="ghost sm" title={`Download part ${i + 1} as ${format.toUpperCase()}`} onClick={() => splitCtl.exportPiece(i, format)}>{format.toUpperCase()}</button>
          </div>
        ))}
      </div>
      <p className="fine">Each piece is a separate printable island. Print them, then glue or pin together.</p>
    </div>
  );
}

function ParamsPanel({ defaults, values, busy, isCad, onApply, onLive, onSave, onPeek, onPeekEnd }: { defaults: CadParams | null; values: CadParams; busy: boolean; isCad: boolean; onApply: (v: CadParams, editedKey?: string) => void; onLive: (v: CadParams) => void; onSave: () => void; onPeek: (k: string) => void; onPeekEnd: () => void }) {
  const [local, setLocal] = useState<CadParams>(values);
  const [editing, setEditing] = useState<Record<string, string>>({});
  // The scrub's pointermove/pointerup handlers outlive the render that attached them,
  // so they must read CURRENT state through a ref — closing over `local` committed the
  // value from drag-start and the number snapped back on release.
  const localRef = useRef(local);
  localRef.current = local;
  // A drag is the authority on its own row. Live rebuilds echo back the params the
  // BUILD used, which lag the cursor by the throttle plus kernel time — syncing those
  // in mid-drag snapped the number backwards, and the next move pushed it forward
  // again, so the readout and meter jittered between two values the whole way.
  const draggingRef = useRef(false);
  // Set by Escape, read by the onBlur it triggers synchronously in the same turn.
  const cancelRef = useRef<string | null>(null);
  useEffect(() => {
    if (draggingRef.current) return; // a drag is the authority on its own row
    const q = outstanding.current;
    const same = (a: CadParams, b: CadParams) => {
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
    };
    if (q.length && same(values, q[0])) {
      // Our own commit coming back. If newer commits are still in flight, the panel
      // already shows their numbers — adopting this older echo would flash the value
      // BACKWARDS for a build's length (the rubber band), so hold what the user typed.
      q.shift();
      if (q.length) return;
    } else if (q.length) {
      // The app answered with something we didn't send — a rollback, a radius rescue,
      // an undo. Its values are the truth now, and whatever we still had queued
      // described a model that no longer exists.
      q.length = 0;
    }
    setLocal(values);
  }, [values]);
  // One scrub, two surfaces (the name AND the whole value meter): pointer capture keeps
  // the drag alive however far the cursor travels, the model rebuilds LIVE (throttled —
  // the live path never flips global status, so rows stay enabled mid-drag), and a tap
  // that never moved falls through to `onTap` (focus the number for typing).
  const scrub = (
    e: React.PointerEvent<HTMLElement>,
    k: string,
    v0: number,
    o: { step: number; isInt: boolean; min: number; max: number; onTap?: () => void },
  ) => {
    if (busy) return;
    onPeekEnd(); // a press cancels the hover-intent probe — it must not build mid-drag
    const el = e.currentTarget;
    const id = e.pointerId;
    el.setPointerCapture(id);
    e.preventDefault(); // keeps the input from grabbing focus until we know it's a tap
    draggingRef.current = true;
    const x0 = e.clientX;
    let latest = v0;
    let moved = false;
    let lastLive = 0;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return; // a second finger must not drive this drag
      const dx = ev.clientX - x0;
      if (Math.abs(dx) < 3 && !moved) return;
      // A drag supersedes any half-typed draft — the input renders `editing[k] ?? value`,
      // so leaving one behind would freeze the readout at the abandoned text.
      if (!moved) setEditing((e) => { if (!(k in e)) return e; const n = { ...e }; delete n[k]; return n; });
      moved = true;
      // Fine scrub while Shift is held, as every 3D tool does.
      const scale = (ev.shiftKey ? 0.25 : 1) * o.step;
      const raw = Math.min(o.max, Math.max(o.min, v0 + dx * scale * 0.5));
      latest = o.isInt ? Math.round(raw) : +(Math.round(raw / o.step) * o.step).toFixed(4);
      if ((localRef.current[k] ?? v0) === latest) return;
      setLocal((prev) => ({ ...prev, [k]: latest }));
      const now = performance.now();
      if (now - lastLive > 150) { lastLive = now; onLive({ ...localRef.current, [k]: latest }); }
    };
    // ONE teardown for every way a drag can end. Without a pointercancel path, an
    // aborted drag (element unmounted, window blurred, context menu, palm rejection)
    // left `move` attached for good — after which merely HOVERING the row changed the
    // value, because move never checks whether a button is still down.
    const done = (tapCounts: boolean) => (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== id) return;
      try { el.releasePointerCapture(id); } catch { /* the cancel already released it */ }
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", abort);
      el.removeEventListener("lostpointercapture", abort);
      draggingRef.current = false;
      // Whatever was dragged is committed either way — it's real work the user did.
      // Only the no-movement case differs: a real release is a tap (focus the number),
      // an interrupted drag is not.
      if (moved) commit({ ...localRef.current, [k]: latest }, k);
      else if (tapCounts) o.onTap?.();
    };
    const finish = done(true);
    const abort = done(false);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", abort);
    el.addEventListener("lostpointercapture", abort);
  };
  if (!isCad || !defaults) {
    return (
      <div className="panel muted">
        {isCad
          ? "Nothing adjustable in this design yet — ask for a change and the AI will define the sizes you can tweak here."
          : "Adjust works on Precise (CAD) models — generative meshes don't have editable dimensions."}
      </div>
    );
  }
  // EVERY commit is sent — App queues one while a build runs and applies it after.
  // The old `if (!busy)` guard silently swallowed a number typed during a build: the
  // input showed it, the model never got it, and the next sync snapped the panel back.
  // The outstanding list remembers what we sent, so the effect below can tell "echo of
  // our own commit" from "the app moved the values itself".
  const outstanding = useRef<CadParams[]>([]);
  const commit = (next: CadParams, editedKey?: string) => {
    outstanding.current.push({ ...next });
    if (outstanding.current.length > 8) outstanding.current.shift(); // runaway guard
    onApply(next, editedKey);
  };
  const keys = Object.keys(defaults);
  const changed = keys.filter((k) => (local[k] ?? defaults[k]) !== defaults[k]).length;

  return (
    <div className="panel params">
      <p className="fine params-lede">
        Free tweaks — no AI, no tokens. Drag anywhere on a value to scrub it (the model
        follows live; Shift = fine), or click and type — <b>+5</b>, <b>*2</b> and <b>(30/2)+4</b> all work.
      </p>
      {groupParams(defaults, local).map((grp) => (
      <section className="pgroup" key={grp.title || "all"}>
        {grp.title && <h4 className="pgroup-title">{grp.title}</h4>}
      {grp.rows.map(({ key: k }) => {
        const def = defaults[k];
        const v = local[k] ?? def;
        const isInt = isCountParam(k);
        // Range from the AI's value, stretched to include wherever the row is NOW —
        // a typed value outside the guess must stay draggable, not snap back into it.
        const { min, max, step: soft } = paramSoftRange(def, v);
        // The drag is bounded by the HARD rail, not the recommendation: the meter's
        // fill shows the recommended span, but a value you can type must be one you
        // can also drag to.
        const hard = paramHardRange(def, v);
        const step = isInt ? 1 : soft;
        const dirty = v !== def;
        // Position within the SOFT range, drawn as a fill behind the number — the range
        // is a guess, so it informs without occupying a row of its own. Past the
        // recommended end the fill goes full and turns amber: still perfectly buildable,
        // just outside what the design was drawn around.
        const pct = max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0;
        const beyond = v > max || v < min;

        return (
          <div
            className={`prow${dirty ? " dirty" : ""}`}
            key={k}
            onPointerEnter={() => onPeek(k)}
            onPointerLeave={onPeekEnd}
            onFocus={() => onPeek(k)}
            onBlur={onPeekEnd}
          >
            {/* Drag the LABEL to scrub, the way Figma and Blender do. The label was
                already the hover target for the geometry peek, so rest = show me where
                this acts, drag = change it. Pointer capture means the drag survives
                leaving the row. */}
            <button
              type="button"
              className="prow-name"
              title={`${k} — drag left/right to change, Shift for fine steps`}
              disabled={busy}
              onPointerDown={(e) => scrub(e, k, v, { step, isInt, min: hard.min, max: hard.max })}
            >
              {/* One name, the readable one. The raw identifier lives in the tooltip —
                  showing both under each other doubled every row's height for a string
                  most users never need. */}
              <span className="pn-human">{humanizeParam(k)}</span>
            </button>

            {/* The WHOLE meter scrubs, not just the label: press anywhere in it and drag
                (ew-resize cursor throughout, pointer capture keeps it), a still tap
                focuses the number for typing. Skip when already typing in it — dragging
                then selects text as normal. */}
            <span
              className="prow-field"
              onPointerDown={(e) => {
                const input = e.currentTarget.querySelector("input");
                if (input && document.activeElement === input) return;
                scrub(e, k, v, { step, isInt, min: hard.min, max: hard.max, onTap: () => { input?.focus(); input?.select(); } });
              }}
            >
              <i className={`pf-fill${beyond ? " beyond" : ""}`} style={{ width: `${pct}%` }} aria-hidden="true" />
              <input
                className="pf-input"
                type="text"
                inputMode="decimal"
                value={editing[k] ?? String(v)}
                /* NOT disabled while a build runs: `disabled` makes the browser blur the
                   field, which fired onBlur → another commit and stole focus after every
                   single arrow press. Commits are queued in App instead, so nothing is
                   lost by leaving the field live. */
                aria-label={`${humanizeParam(k)} in millimetres`}
                onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                onFocus={() => setEditing({ ...editing, [k]: String(v) })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    // blur() dispatches synchronously, inside this handler — the onBlur
                    // that runs still closes over the OLD `editing`, so clearing state
                    // here didn't stop it committing the abandoned text (typing 999 and
                    // pressing Escape rebuilt the model at 999). The ref is read by
                    // onBlur in the same turn, so it actually lands.
                    cancelRef.current = k;
                    const n = { ...editing }; delete n[k]; setEditing(n);
                    (e.target as HTMLInputElement).blur();
                    return;
                  }
                  if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); return; }
                  // Arrows nudge by one step, x10 with Shift — keyboard parity with the scrub.
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
                    // Number(), not `parseFloat(...) || v`: a typed 0 is falsy, so the
                    // nudge was applied to the OLD value (0 then ArrowUp gave 5.5, not 0.5).
                    const typed = parseFloat(editing[k] ?? String(v));
                    const nv = +((Number.isFinite(typed) ? typed : v) + d).toFixed(4);
                    setEditing({ ...editing, [k]: String(nv) });
                    const next = { ...local, [k]: isInt ? Math.round(nv) : nv };
                    setLocal(next); commit(next, k);
                  }
                }}
                onBlur={() => {
                  const raw = editing[k];
                  const n = { ...editing }; delete n[k]; setEditing(n);
                  if (cancelRef.current === k) { cancelRef.current = null; return; } // Escape: discard
                  if (raw === undefined) return;
                  const parsed = evalParamInput(raw, v);
                  if (parsed === null) return;              // unparseable → keep the old value
                  const q = isInt ? Math.round(parsed) : +parsed.toFixed(4);
                  if (q === v) return;
                  const next = { ...local, [k]: q };
                  setLocal(next); commit(next, k);
                }}
              />
              <span className="pf-unit">{isInt ? "" : "mm"}</span>
            </span>

            {/* Per-row revert. A global "Reset to AI values" throws away every edit to
                undo one, which is why nobody uses it mid-session. */}
            <button
              type="button"
              className="prow-revert"
              title={dirty ? `Revert to the AI's ${def}` : "Unchanged"}
              aria-label={`Revert ${humanizeParam(k)}`}
              disabled={busy || !dirty}
              onClick={() => {
                // Drop any in-progress typed draft for this row FIRST: the input renders
                // `editing[k] ?? value`, so a leftover draft kept showing the old number
                // while the model had already reverted (measured: field 60.5, model 30).
                setEditing((e) => { const n = { ...e }; delete n[k]; return n; });
                const next = { ...local, [k]: def };
                setLocal(next);
                commit(next, k);
              }}
            >
              <IconReset />
            </button>
          </div>
        );
      })}
      </section>
      ))}
      <div className="param-actions">
        <button className="ghost sm" disabled={busy || !changed} onClick={() => { setEditing({}); setLocal(defaults); onApply(defaults); }}>
          <IconReset /> Reset all{changed ? ` (${changed})` : ""}
        </button>
        <button className="primary sm" disabled={busy} onClick={onSave}>Save as version</button>
      </div>
      <p className="fine">Adjustments apply to exports immediately; “Save as version” keeps them in History.</p>
    </div>
  );
}
function Spinner() {
  return <span className="spinner" aria-hidden />;
}

function CubeMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2f7a70" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" />
      <path d="M3 7 12 12 21 7" />
      <path d="M12 12V22" />
    </svg>
  );
}
