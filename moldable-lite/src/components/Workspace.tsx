import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Viewer, type ViewerHandle, type PickedPoint, type PickedFeature, type SelectKind } from "./Viewer";
import type { Pin } from "../store/types";
import type { ChatMessage, Mode } from "../App";
import type { PrintabilityReport } from "../print/printability";
import type { Version } from "../store/types";
import type { EngineKind, ExportFormat } from "../engine/types";
import { paramRange, type CadParams } from "../cad/params";
import { HEAVY_TRIANGLES } from "../print/simplify";
import type { SlicerTarget } from "../lib/slicer";
import type { SplitPiece } from "../print/split";
import { IconPaperclip, IconArrowUp, IconUser, IconMoon, IconSun, IconX, IconCheck, IconReset, IconChevron, IconGlobe, } from "./icons";
import type * as THREE from "three";
import { MODELS } from "../llm/anthropic";
import { LLM_PRESETS, type LlmProviderId } from "../llm/llm";
import { shortModelName } from "../llm/openrouterModels";
import type { FitId } from "../llm/prompts";
import { PROVIDERS } from "../gen/registry";

// The Select tool's modes, in hotkey order (1–4). "point" is the old Pin.
export const SELECT_MODES: { kind: SelectKind; label: string }[] = [
  { kind: "face", label: "Face" },
  { kind: "edge", label: "Edge" },
  { kind: "vertex", label: "Corner" },
  { kind: "point", label: "Point" },
];

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
function MultiViewRow({ views, onPick, onClear, multiViewEngine }: {
  views: Partial<Record<"left" | "back" | "right", string>>;
  onPick: (slot: "left" | "back" | "right", f: File) => void;
  onClear: (slot: "left" | "back" | "right") => void;
  multiViewEngine: boolean;
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
        {multiViewEngine
          ? "More angles → a more accurate mesh. This engine uses them."
          : <>More angles improve accuracy — but this engine uses only the front. Switch to <b>fal · Rodin</b> or <b>Tripo</b> to use them.</>}
      </p>
    </div>
  );
}

/** Glanceable mesh + print stats on the model (Meshy's Faces/Vertices, reframed
    for slicing: triangles, watertight, volume, bed fit). */
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
  bootError?: string;
  booting: boolean;
  accountEmail: string | null;
  onOpenProfile: () => void;
  onSignOut: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
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
  onPickImage: (f: File) => void;
  onClearImage: () => void;
  views: Partial<Record<"left" | "back" | "right", string>>;
  onPickView: (slot: "left" | "back" | "right", f: File) => void;
  onClearView: (slot: "left" | "back" | "right") => void;
  multiViewEngine: boolean;
  onMeasure: () => void;
  messages: ChatMessage[];
  status: "idle" | "generating";
  input: string;
  setInput: (v: string) => void;
  onSend: (p: string, forceMode?: Mode) => void;
  onRetryModel: (text: string, mode: Mode, value: string) => void;
  onExample: () => void;
  resume: string | null;
  onResume: () => void;
  geometry: THREE.BufferGeometry | null;
  dims: { x: number; y: number; z: number } | null;
  report: PrintabilityReport | null;
  wireframe: boolean;
  setWireframe: (f: (w: boolean) => boolean) => void;
  showDims: boolean;
  setShowDims: (f: (d: boolean) => boolean) => void;
  units: "mm" | "in";
  setUnits: (f: (u: "mm" | "in") => "mm" | "in") => void;
  viewerRef: RefObject<ViewerHandle>;
  tab: "3d" | "code" | "params" | "print" | "history";
  setTab: (t: "3d" | "code" | "params" | "print" | "history") => void;
  codeText: string;
  streamingText: string;
  onRerun: (edited: string) => void;
  cadDefaults: CadParams | null;
  paramValues: CadParams;
  onApplyParams: (values: CadParams) => void;
  onSaveParams: () => void;
  onOpenSlicer: (t: SlicerTarget) => void;
  onRepair: () => void;
  onSimplify: () => void;
  onSplit: () => void;
  splitCtl: {
    pieces: SplitPiece[] | null;
    exportPiece: (index: number, format: "stl" | "3mf") => void;
    exportAll: (format: "stl" | "3mf") => void;
    clear: () => void;
  };
  versions: Version[];
  onRestore: (id: string) => void;
  undoCtl: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; busy: boolean };
  supportsStep: boolean;
  canExport: (f: ExportFormat) => boolean;
  onExport: (f: ExportFormat) => void;
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onNew: () => void;
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
    selected: PickedFeature | null;
    text: string;
    setText: (s: string) => void;
    pick: (f: PickedFeature) => void;
    askAi: () => void;
    clear: () => void;
  };
}

export function Workspace(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [showStats, setShowStats] = useState(true); // mesh/print stats overlay in the 3D view

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

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/") || /\.(glb|gltf|stl|step|stp|shapr)$/i.test(x.name));
    if (f) p.onPickImage(f);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button className="brandbtn" onClick={p.onNew} title="Start fresh (your current work stays in the Library)" aria-label="Moldable — start fresh">
            <CubeMark />
            <span className="wordmark">Moldable</span>
          </button>
          <span className="sep">/</span>
          <ProjectTitle name={p.projectName} onRename={p.onRename} />
        </div>
        <div className="topbar-right">
          <span className={`pill ${p.activeKind === "primitive" ? "pill-warn" : ""}`}>{enginePill}</span>
          <button className="ghost" onClick={p.onOpenLibrary}>Library</button>
          <button className="primary sm" onClick={p.onNew} title="Start a fresh chat & model (your current one stays in the Library)">+ New chat</button>
          <button className="ghost profile" onClick={p.onToggleTheme} title={p.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle dark mode">
            {p.theme === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          <div className="profile-wrap">
            <button
              className="ghost profile"
              onClick={() => (p.accountEmail ? setProfileMenu((v) => !v) : p.onOpenProfile())}
              title={p.accountEmail ? `${p.accountEmail} — account menu` : "Sign in & settings"}
              aria-label="Account menu"
              aria-expanded={profileMenu}
            >
              {p.accountEmail ? <span className="avatar">{p.accountEmail[0].toUpperCase()}</span> : <IconUser />}
            </button>
            {profileMenu && p.accountEmail && (
              <div className="profile-menu" onMouseLeave={() => setProfileMenu(false)}>
                <div className="pm-head">
                  <span className="pm-avatar">{p.accountEmail[0].toUpperCase()}</span>
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

      <main className={`split${chatOpen ? "" : " chat-collapsed"}`}>
        {!chatOpen && (
          <button className="chat-rail" title="Show chat" aria-label="Show chat" onClick={() => setChatOpen(true)}>
            <span className="chat-rail-label">Chat ›</span>
          </button>
        )}
        <section
          className={`chat ${dragOver ? "drop" : ""}`}
          style={chatOpen ? undefined : { display: "none" }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="chat-bar">
            <span className="chat-title">Chat</span>
            <button className="ghost sm" title="Hide chat" onClick={() => setChatOpen(false)}>Hide ‹</button>
          </div>
          <Messages messages={p.messages} onChip={p.onSend} onExample={p.onExample} onStartGuided={p.onStartGuided} resume={p.resume} onResume={p.onResume} status={p.status}
            brain={p.brain} hasBrainKey={p.hasBrainKey} genProvider={p.genProvider} genModel={p.genModel} hasGenKey={p.hasGenKey} onRetryModel={p.onRetryModel} />

          <div className="composer-wrap">
            <div className="modebar">
              <div className="modebar-row">
                <div className="seg">
                  <button className={p.mode === "precise" ? "on" : ""} onClick={() => p.setMode("precise")}>Precise (CAD)</button>
                  <button className={p.mode === "generative" ? "on" : ""} onClick={() => p.setMode("generative")}>Generative (AI mesh)</button>
                </div>
                {p.mode === "precise" ? (
                  <BrainPicker brain={p.brain} hasKey={p.hasBrainKey} onPick={p.onPickBrain} />
                ) : (
                  <EnginePicker provider={p.genProvider} model={p.genModel} hasKey={p.hasGenKey} onPick={p.onPickEngine} />
                )}
                {p.mode === "precise" && (
                  <button
                    type="button"
                    className={`web-toggle web-${p.webMode}`}
                    onClick={p.onCycleWeb}
                    aria-label={`Web search: ${p.webMode}`}
                    title="Web search for real dimensions before building — Auto: looks up named real-world products · On: always research · Off: never. Click to cycle."
                  >
                    <IconGlobe size={13} />
                    <span className="web-state">{p.webMode === "auto" ? "Auto" : p.webMode === "on" ? "On" : "Off"}</span>
                  </button>
                )}
              </div>
              <span className="modehint">
                {p.mode === "precise" && p.autoPick
                  ? p.autoPick
                  : p.mode === "precise"
                  ? p.guided
                    ? "Replacement part — clearance is added to fitted features"
                    : p.imageUrl
                      ? "Photo → exact CAD replacement (vision)"
                      : "Exact parts from text or a photo · STEP export"
                  : "Whole/organic objects from a photo or text"}
              </span>
              {p.mode === "precise" && p.guided && <FitControl fit={p.fit} onFit={p.onFit} />}
            </div>

            {p.imageUrl && (
              <div className="imgchip">
                <img src={p.imageUrl} alt="reference" />
                <span>reference image</span>
                {p.mode === "precise" && (
                  <button className="imgchip-measure" title="Measure real dimensions from this photo" onClick={p.onMeasure}>Measure</button>
                )}
                <button aria-label="Remove reference image" onClick={p.onClearImage}><IconX /></button>
              </div>
            )}

            {p.mode === "generative" && p.imageUrl && (
              <MultiViewRow views={p.views} onPick={p.onPickView} onClear={p.onClearView} multiViewEngine={p.multiViewEngine} />
            )}

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                p.onSend(p.input);
              }}
            >
              <button
                type="button"
                className="attach"
                title="Upload a photo → 3D"
                aria-label="Upload a photo to turn into a 3D model"
                onClick={() => fileRef.current?.click()}
              >
                <IconPaperclip />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.svg,.glb,.gltf,.stl,.step,.stp,.shapr"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) p.onPickImage(f);
                  e.currentTarget.value = "";
                }}
              />
              <input
                value={p.input}
                onChange={(e) => p.setInput(e.target.value)}
                placeholder={
                  p.mode === "generative"
                    ? "Describe it, or upload / paste a photo…"
                    : p.imageUrl
                      ? "Add known measurements (e.g. 32 mm wide, M4 holes) — they override estimates…"
                      : p.guided
                        ? "Upload a photo of the part, or describe it with any measurements…"
                        : "Describe a part, or a change…"
                }
              />
              <button type="submit" className="send" aria-label="Send" disabled={p.status === "generating"}><IconArrowUp /></button>
            </form>
          </div>
        </section>

        <section className={`viewer${p.tab === "params" ? " params-docked" : ""}`}>
          <div className="viewer-head">
            <div className="tabs">
              {(["3d", "code", "params", "print", "history"] as const).map((t) => (
                <button key={t} className={p.tab === t ? "on" : ""} onClick={() => p.setTab(t)}>
                  {t === "3d" ? "3D View" : t === "code" ? "Source" : t === "params" ? "Params" : t === "print" ? "Printability" : "History"}
                </button>
              ))}
            </div>
            {(p.tab === "3d" || p.tab === "params") && (
              <div className="viewer-tools">
                <div className="seg sm">
                  <button title="Undo (⌘/Ctrl+Z)" disabled={!p.undoCtl.canUndo || p.undoCtl.busy} onClick={p.undoCtl.undo}>Undo</button>
                  <button title="Redo (⌘/Ctrl+Shift+Z)" disabled={!p.undoCtl.canRedo || p.undoCtl.busy} onClick={p.undoCtl.redo}>Redo</button>
                </div>
                <button
                  className={`ghost sm${p.featureCtl.mode ? " on" : ""}`}
                  aria-pressed={p.featureCtl.mode}
                  title="Select tool: hover to highlight a face, edge or corner and click to pick it — or use Point to mark an exact spot — then tell the AI what to change there"
                  onClick={p.featureCtl.toggleMode}
                >
                  Select
                </button>
                {p.featureCtl.mode && (
                  <div className="seg sm">
                    {SELECT_MODES.map((m, i) => (
                      <button key={m.kind} className={p.featureCtl.kind === m.kind ? "on" : ""} title={`${m.label} (${i + 1})`} onClick={() => p.featureCtl.setKind(m.kind)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
                {p.pins.length > 0 && (
                  <button
                    className="ghost sm"
                    title={`Remove all ${p.pins.length} point${p.pins.length > 1 ? "s" : ""}`}
                    onClick={p.pinCtl.clearAll}
                  >
                    Clear points ({p.pins.length})
                  </button>
                )}
                <button className={`ghost sm${p.showDims ? " on" : ""}`} aria-pressed={p.showDims} onClick={() => p.setShowDims((d) => !d)}>
                  {p.showDims ? "Hide dimensions" : "Dimensions"}
                </button>
                <button className="ghost sm" title="Toggle units" onClick={() => p.setUnits((u) => (u === "mm" ? "in" : "mm"))}>
                  {p.units === "mm" ? "mm" : "inches"}
                </button>
                <button className="ghost sm" onClick={() => p.setWireframe((w) => !w)}>{p.wireframe ? "Solid" : "Wireframe"}</button>
                <button className={`ghost sm${showStats ? " on" : ""}`} aria-pressed={showStats} title="Show mesh & print stats on the model" onClick={() => setShowStats((s) => !s)}>Stats</button>
                <button className="ghost sm" onClick={() => p.viewerRef.current?.resetView()}>Reset view</button>
              </div>
            )}
          </div>

          <div className="viewer-body">
            <div style={{ display: p.tab === "3d" || p.tab === "params" ? "block" : "none", height: "100%" }}>
              <Viewer
                ref={p.viewerRef}
                geometry={p.geometry}
                wireframe={p.wireframe}
                showDims={p.showDims}
                units={p.units}
                theme={p.theme}
                pins={p.pins}
                selectedPin={p.pinCtl.active?.pin.id ?? null}
                selectMode={p.featureCtl.mode}
                selectKind={p.featureCtl.kind}
                onPickPoint={p.pinCtl.pick}
                onPickFeature={p.featureCtl.pick}
                onSelectPin={p.pinCtl.select}
              />
              {p.tab === "3d" && showStats && p.geometry && p.report && <MeshStats report={p.report} />}
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
              {p.featureCtl.selected && (
                <div className="pin-panel">
                  <div className="pin-head">
                    <span>
                      {(() => {
                        const f = p.featureCtl.selected!;
                        const cap = f.label.charAt(0).toUpperCase() + f.label.slice(1);
                        if (f.kind === "face") return `${cap} · ${f.w} × ${f.h} mm`;
                        if (f.kind === "edge") return `${cap} · ${f.len} mm long`;
                        return `Corner · ${f.cx}, ${f.cy}, ${f.cz} mm`;
                      })()}
                    </span>
                    <button className="x" aria-label="Clear selection" onClick={p.featureCtl.clear}><IconX /></button>
                  </div>
                  <textarea
                    rows={2}
                    value={p.featureCtl.text}
                    onChange={(e) => p.featureCtl.setText(e.target.value)}
                    placeholder={p.featureCtl.selected.kind === "edge" ? "e.g. add a 2 mm fillet · chamfer this edge 1 mm" : p.featureCtl.selected.kind === "vertex" ? "e.g. round this corner 3 mm" : "e.g. add two 4 mm screw holes · pocket 3 mm deep"}
                  />
                  <div className="param-actions">
                    <button
                      className="primary sm"
                      disabled={!p.featureCtl.text.trim() || p.activeKind !== "replicad" || p.status === "generating"}
                      onClick={p.featureCtl.askAi}
                    >
                      Ask AI to change this
                    </button>
                    <button className="ghost sm" onClick={p.featureCtl.clear}>Cancel</button>
                  </div>
                  {p.activeKind !== "replicad" && <p className="fine">Precise (CAD) models only.</p>}
                </div>
              )}
              {p.tab === "3d" && p.splitCtl.pieces && p.splitCtl.pieces.length > 0 && (
                <SplitPiecesPanel splitCtl={p.splitCtl} />
              )}
              {/* Parameters dock over the 3D view so you can watch the model update live — close returns to the plain 3D view. */}
              {p.tab === "params" && (
                <div className="side-panel">
                  <div className="side-head">
                    <span>Parameters</span>
                    <button className="x" aria-label="Close parameters" onClick={() => p.setTab("3d")}><IconX /></button>
                  </div>
                  <div className="side-body">
                    <ParamsPanel
                      defaults={p.cadDefaults}
                      values={p.paramValues}
                      busy={p.status === "generating"}
                      isCad={p.activeKind === "replicad"}
                      onApply={p.onApplyParams}
                      onSave={p.onSaveParams}
                    />
                  </div>
                </div>
              )}
              {p.booting && (
                <div className="viewer-overlay">
                  <Spinner /> Starting the CAD engine…
                  <br />
                  <small>loading OpenCascade (WASM)</small>
                </div>
              )}
              {!p.booting && !p.geometry && <div className="viewer-overlay muted">Describe something or drop a photo to see it here.</div>}
            </div>
            {p.tab === "code" && (
              <CodePanel activeKind={p.activeKind} codeText={p.codeText} streamingText={p.streamingText} generating={p.status === "generating"} onRerun={p.onRerun} />
            )}
            {p.tab === "print" && (
              <PrintabilityPanel report={p.report} canRepair={p.activeKind !== "replicad" && !!p.geometry} busy={p.status === "generating"} onRepair={p.onRepair} onSimplify={p.onSimplify} onSplit={p.onSplit} />
            )}
            {p.tab === "history" && <VersionHistory versions={p.versions} onRestore={p.onRestore} />}
          </div>

          <div className="statusbar">
            <span className="dims">{p.dims ? fmtDims(p.dims, p.units) : "—"}</span>
            {p.status === "generating" && <GenTimer />}
            <PathToPrint hasModel={!!p.geometry} report={p.report} onOpenCheck={() => p.setTab("print")} />
            <ExportMenu supportsStep={p.supportsStep} canExport={p.canExport} onExport={p.onExport} onOpenSlicer={p.onOpenSlicer} disabled={!p.geometry} report={p.report} activeKind={p.activeKind} busy={p.status === "generating"} onFix={p.onRepair} onSimplify={p.onSimplify} />
          </div>
        </section>
      </main>
    </div>
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
const FIT_OPTS: { id: FitId; label: string; hint: string }[] = [
  { id: "loose", label: "Loose", hint: "sliding fit · ~0.4 mm" },
  { id: "snug", label: "Snug", hint: "everyday fit · ~0.2 mm" },
  { id: "press", label: "Press", hint: "tight / press fit · ~0.1 mm" },
];
function FitControl({ fit, onFit }: { fit: FitId; onFit: (f: FitId) => void }) {
  return (
    <div className="fitbar" role="group" aria-label="Fit tolerance">
      <span className="fit-label">Fit</span>
      <div className="fit-seg">
        {FIT_OPTS.map((o) => (
          <button key={o.id} type="button" className={fit === o.id ? "on" : ""} title={o.hint} onClick={() => onFit(o.id)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

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
      items: LLM_PRESETS.filter((pr) => pr.id !== "anthropic").map((pr) => {
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
  return PROVIDERS.map((pv) => {
    const needs = pv.needsKey && !hasKey(pv.id);
    return {
      label: `${pv.label}${pv.free ? " · free" : ""}${needs ? " · add key" : ""}`,
      items: pv.models.map((mm) => { const [name, sub] = splitLabel(mm.label); return { value: `${pv.id}|${mm.id}`, name, sub }; }),
    };
  });
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

function Messages({ messages, onChip, onExample, onStartGuided, resume, onResume, status, brain, hasBrainKey, genProvider, genModel, hasGenKey, onRetryModel }: {
  messages: ChatMessage[]; onChip: (s: string, forceMode?: Mode) => void; onExample: () => void; onStartGuided: () => void; resume: string | null; onResume: () => void; status: "idle" | "generating";
  brain: { provider: LlmProviderId; model: string }; hasBrainKey: (p: LlmProviderId) => boolean; genProvider: string; genModel: string; hasGenKey: (p: string) => boolean;
  onRetryModel: (text: string, mode: Mode, value: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const lastText = messages[messages.length - 1]?.text;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
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

  return (
    <div className="messages">
      {messages.length === 0 && (
        <div className="empty">
          <p className="empty-q">What do you want to make?</p>
          <p className="empty-sub">Type a description, attach a photo, or drop an SVG to extrude — plus 3D files: .step imports as editable CAD, .glb/.stl as a mesh.</p>
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
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role} ${m.error ? "err" : ""}`}>
          <span className="who">{m.role === "user" ? "You" : "Moldable"}</span>
          {editingId === m.id ? (
            <div className="bubble-edit">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(m); }
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <div className="edit-actions">
                <button className="ghost sm" onClick={() => setEditingId(null)}>Cancel</button>
                <button className="primary sm" disabled={!editText.trim() || busy} onClick={() => submitEdit(m)}>Send</button>
              </div>
            </div>
          ) : (
            <>
              <div className={`bubble ${m.streaming ? "muted" : ""}`}>
                {m.image && <img className="bubble-img" src={m.image} alt="reference" />}
                {m.text && <span>{m.text}</span>}
              </div>
              {/* Retry / edit any typed prompt — including one sent with a photo, so
                  a failed generation can be re-run (the attached photo, if still in
                  the composer, rides along). */}
              {m.role === "user" && m.text && (
                <div className="msg-actions">
                  {busy ? (
                    <span className="msg-act" style={{ opacity: 0.4 }}>Retry</span>
                  ) : (
                    <RetryMenu mode={m.mode ?? "precise"} brain={brain} hasBrainKey={hasBrainKey} genProvider={genProvider} genModel={genModel} hasGenKey={hasGenKey}
                      onPick={(value) => onRetryModel(m.text, m.mode ?? "precise", value)} />
                  )}
                  <button className="msg-act" disabled={busy} title="Edit this message and resend" onClick={() => startEdit(m)}>Edit</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
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

function PrintabilityPanel({ report, canRepair, busy, onRepair, onSimplify, onSplit }: { report: PrintabilityReport | null; canRepair: boolean; busy: boolean; onRepair: () => void; onSimplify: () => void; onSplit: () => void }) {
  if (!report) return <div className="panel muted">No model analysed yet.</div>;
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
          <button className="primary sm" disabled={busy} onClick={onSplit}>
            Split to fit bed — print in pieces
          </button>
        </div>
      )}
      <p className="fine">Generated meshes are often not watertight — that's expected. Simplify when a slicer (e.g. Bambu Studio) chokes on the triangle count. Wall/overhang are heuristics; bed-fit &amp; watertight are exact for this mesh.</p>
    </div>
  );
}

function VersionHistory({ versions, onRestore }: { versions: Version[]; onRestore: (id: string) => void }) {
  if (versions.length === 0) return <div className="panel muted">No versions yet — each change is saved here.</div>;
  const list = [...versions].reverse();
  return (
    <div className="panel">
      <h3>Version history</h3>
      {list.map((v, i) => (
        <div key={v.id} className={`vrow ${i === 0 ? "current" : ""}`}>
          <div>
            <div className="vsum">{v.summary}</div>
            <div className="vmeta">
              {new Date(v.createdAt).toLocaleTimeString()} · {v.dims ? `${v.dims.x}×${v.dims.y}×${v.dims.z} mm` : v.engine}
              {i === 0 ? " · current" : ""}
            </div>
          </div>
          {i !== 0 && <button className="ghost sm" onClick={() => onRestore(v.id)}>Restore</button>}
        </div>
      ))}
      <p className="fine">Restoring records a new version, so nothing is lost.</p>
    </div>
  );
}

/** Compact print-readiness line at the top of the export menu, with one-click
 *  fixes for the two classic slicer blockers: open meshes and heavy meshes. */
function ExportReadiness({ report, activeKind, busy, onFix, onSimplify }: { report: PrintabilityReport | null; activeKind: EngineKind; busy: boolean; onFix: () => void; onSimplify: () => void }) {
  if (!report) return null;
  const fits = report.bedFit.fitsRotated;
  const tight = report.manifold.isWatertight;
  const heavy = report.triangleCount > HEAVY_TRIANGLES;
  const isMesh = activeKind !== "replicad";
  if (tight && fits && !heavy) {
    return (
      <div className="export-ready ok">
        <IconCheck /> Print-ready — watertight · {report.bedFit.fitsAsIs ? "fits the bed" : "fits rotated"}
      </div>
    );
  }
  // Meshes can be closed & thinned right here; replicad output is
  // kernel-exact, so a leak there is worth a look in Printability instead.
  if (!tight && isMesh) {
    return (
      <div className="export-ready fix">
        <span>{report.manifold.boundaryEdges} open edge(s)</span>
        <button className="ghost sm mini" disabled={busy} onClick={onFix}>Fix model</button>
      </div>
    );
  }
  if (heavy && isMesh) {
    return (
      <div className="export-ready fix">
        <span>{Math.round(report.triangleCount / 1e5) / 10}M triangles — heavy for slicers</span>
        <button className="ghost sm mini" disabled={busy} onClick={onSimplify}>Simplify</button>
      </div>
    );
  }
  return <div className="export-ready no">{!fits ? "Larger than the bed — see Printability" : "Not watertight — see Printability"}</div>;
}

function ExportMenu({ supportsStep, canExport, onExport, onOpenSlicer, disabled, report, activeKind, busy, onFix, onSimplify }: { supportsStep: boolean; canExport: (f: ExportFormat) => boolean; onExport: (f: ExportFormat) => void; onOpenSlicer: (t: SlicerTarget) => void; disabled: boolean; report: PrintabilityReport | null; activeKind: EngineKind; busy: boolean; onFix: () => void; onSimplify: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-wrap">
      {open && (
        <div className="export-menu" onMouseLeave={() => setOpen(false)}>
          <ExportReadiness report={report} activeKind={activeKind} busy={busy} onFix={onFix} onSimplify={onSimplify} />
          {EXPORT_FORMATS.map(({ f, label, desc }) => {
            const enabled = canExport(f) && !(f === "step" && !supportsStep);
            return (
              <button key={f} className="export-item" disabled={!enabled} onClick={() => { setOpen(false); onExport(f); }}>
                <span className="ef">{label}</span>
                <span className="ed">{f === "step" && !supportsStep ? "needs the Precise engine" : desc}</span>
              </button>
            );
          })}
          <div className="export-sep" />
          <button className="export-item" onClick={() => { setOpen(false); onOpenSlicer("bambu"); }}>
            <span className="ef">Open in Bambu Studio</span>
            <span className="ed">sends the 3MF to the desktop app</span>
          </button>
          <button className="export-item" onClick={() => { setOpen(false); onOpenSlicer("orca"); }}>
            <span className="ef">Open in OrcaSlicer</span>
            <span className="ed">sends the 3MF to the desktop app</span>
          </button>
        </div>
      )}
      <button className="primary" disabled={disabled} onClick={() => setOpen((o) => !o)}>Export ▾</button>
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
      <div className="split-actions">
        <div className="seg sm">
          <button className={format === "stl" ? "on" : ""} onClick={() => setFormat("stl")}>STL</button>
          <button className={format === "3mf" ? "on" : ""} onClick={() => setFormat("3mf")}>3MF</button>
        </div>
        <button className="primary sm" onClick={() => splitCtl.exportAll(format)}>Download all ({format.toUpperCase()} zip)</button>
      </div>
      <div className="split-list">
        {pieces.map((pc, i) => (
          <div className="split-row" key={i}>
            <span className="split-swatch" style={{ background: pc.color }} />
            <span className="split-label">Part {i + 1}<span className="fine"> · {pc.dims.x} × {pc.dims.y} × {pc.dims.z} mm</span></span>
            <button className="ghost sm" title={`Download part ${i + 1} as ${format.toUpperCase()}`} onClick={() => splitCtl.exportPiece(i, format)}>{format.toUpperCase()}</button>
          </div>
        ))}
      </div>
      <p className="fine">Each piece is a separate printable island. Print them, then glue or pin together.</p>
    </div>
  );
}

function ParamsPanel({ defaults, values, busy, isCad, onApply, onSave }: { defaults: CadParams | null; values: CadParams; busy: boolean; isCad: boolean; onApply: (v: CadParams) => void; onSave: () => void }) {
  const [local, setLocal] = useState<CadParams>(values);
  useEffect(() => setLocal(values), [values]);
  if (!isCad || !defaults) {
    return (
      <div className="panel muted">
        {isCad
          ? "No adjustable parameters in this design yet — ask for a change and the AI will define them."
          : "Parameter sliders work on Precise (CAD) models — generative meshes don't have editable dimensions."}
      </div>
    );
  }
  const commit = (next: CadParams) => {
    if (!busy) onApply(next);
  };
  return (
    <div className="panel">
      <p className="fine" style={{ margin: "0 0 10px" }}>Drag a slider — the model re-builds instantly, no AI call.</p>
      {Object.entries(defaults).map(([k, def]) => {
        const { min, max, step } = paramRange(def);
        const v = local[k] ?? def;
        return (
          <div className="param-row" key={k}>
            <span className="pname">{k}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={v}
              disabled={busy}
              onChange={(e) => setLocal({ ...local, [k]: +e.target.value })}
              onPointerUp={() => commit(local)}
              onKeyUp={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") commit(local); }}
            />
            <input
              className="pnum"
              type="number"
              step={step}
              value={v}
              disabled={busy}
              onChange={(e) => setLocal({ ...local, [k]: +e.target.value })}
              onBlur={() => commit(local)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(local); }}
            />
            <span className="punit">mm</span>
          </div>
        );
      })}
      <div className="param-actions">
        <button className="ghost sm" disabled={busy} onClick={() => { setLocal(defaults); onApply(defaults); }}><IconReset /> Reset to AI values</button>
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
