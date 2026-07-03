import { useEffect, useRef, useState, type RefObject } from "react";
import { Viewer, type ViewerHandle, type PickedPoint } from "./Viewer";
import type { Pin } from "../store/types";
import type { ChatMessage, Mode } from "../App";
import type { PrintabilityReport } from "../print/printability";
import type { Version } from "../store/types";
import type { EngineKind, ExportFormat } from "../engine/types";
import { paramRange, type CadParams } from "../cad/params";
import type { SlicerTarget } from "../lib/slicer";
import type * as THREE from "three";

// gen: true routes the chip to the free Generative engine instead of Precise CAD.
const SUGGESTIONS: { text: string; gen?: boolean }[] = [
  { text: "a 60×40 mm bracket, 4 mm thick, with two 4 mm holes" },
  { text: "a phone stand angled at 60 degrees" },
  { text: "a low-poly fox figurine", gen: true },
];

const EXPORT_FORMATS: { f: ExportFormat; label: string; desc: string }[] = [
  { f: "stl", label: "STL", desc: "Universal print mesh" },
  { f: "3mf", label: "3MF", desc: "Print mesh + units (recommended)" },
  { f: "step", label: "STEP", desc: "Editable solid · Shapr3D/Fusion" },
  { f: "obj", label: "OBJ", desc: "Mesh (reference)" },
];

/** Format overall W×D×H in the chosen unit (unit shown once). */
function fmtDims(d: { x: number; y: number; z: number }, units: "mm" | "in"): string {
  if (units === "in") {
    const c = (n: number) => (n / 25.4).toFixed(2);
    return `${c(d.x)} × ${c(d.y)} × ${c(d.z)} in`;
  }
  return `${d.x} × ${d.y} × ${d.z} mm`;
}

// Minimal line icons (no emoji in the UI chrome).
const IconPaperclip = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
const IconUser = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.2 19a6.5 6.5 0 0 1 11.6 0" />
  </svg>
);
const IconMoon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const IconSun = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const IconArrowUp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

interface Props {
  projectName: string;
  activeKind: EngineKind;
  genLabel: string;
  fellBack: boolean;
  bootError?: string;
  booting: boolean;
  accountEmail: string | null;
  onOpenProfile: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  imageUrl: string | null;
  onPickImage: (f: File) => void;
  onClearImage: () => void;
  messages: ChatMessage[];
  status: "idle" | "generating";
  input: string;
  setInput: (v: string) => void;
  onSend: (p: string, forceMode?: Mode) => void;
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
  versions: Version[];
  onRestore: (id: string) => void;
  supportsStep: boolean;
  canExport: (f: ExportFormat) => boolean;
  onExport: (f: ExportFormat) => void;
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onNew: () => void;
  pins: Pin[];
  pinCtl: {
    mode: boolean;
    toggleMode: () => void;
    active: { pin: Pin; index: number; face: string } | null;
    text: string;
    setText: (s: string) => void;
    askAi: () => void;
    saveNote: () => void;
    del: () => void;
    close: () => void;
    pick: (pt: PickedPoint) => void;
    select: (id: string) => void;
  };
}

export function Workspace(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

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
          <span className="project">{p.projectName}</span>
        </div>
        <div className="topbar-right">
          <span className={`pill ${p.activeKind === "primitive" ? "pill-warn" : ""}`}>{enginePill}</span>
          <button className="ghost" onClick={p.onOpenLibrary}>Library</button>
          <button className="primary sm" onClick={p.onNew} title="Start a fresh chat & model (your current one stays in the Library)">+ New chat</button>
          <button className="ghost profile" onClick={p.onToggleTheme} title={p.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle dark mode">
            {p.theme === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          <button className="ghost profile" onClick={p.onOpenProfile} title={p.accountEmail ? `${p.accountEmail} — account & settings` : "Account & settings"} aria-label="Account and settings">
            {p.accountEmail ? <span className="avatar">{p.accountEmail[0].toUpperCase()}</span> : <IconUser />}
          </button>
        </div>
      </header>

      {p.fellBack && (
        <div className="banner">
          3D CAD kernel unavailable — Precise mode is using the simple <b>primitive</b> engine (STEP export off).
          {p.bootError ? <span className="banner-detail"> ({p.bootError})</span> : null}
        </div>
      )}

      <main className="split">
        <section
          className={`chat ${dragOver ? "drop" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <Messages messages={p.messages} onChip={p.onSend} onExample={p.onExample} resume={p.resume} onResume={p.onResume} />

          <div className="composer-wrap">
            <div className="modebar">
              <div className="seg">
                <button className={p.mode === "precise" ? "on" : ""} onClick={() => p.setMode("precise")}>Precise (CAD)</button>
                <button className={p.mode === "generative" ? "on" : ""} onClick={() => p.setMode("generative")}>Generative (AI mesh)</button>
              </div>
              <span className="modehint">
                {p.mode === "precise"
                  ? p.imageUrl
                    ? "Photo → exact CAD replacement (vision)"
                    : "Exact parts from text or a photo · STEP export"
                  : "Whole/organic objects from a photo or text"}
              </span>
            </div>

            {p.imageUrl && (
              <div className="imgchip">
                <img src={p.imageUrl} alt="reference" />
                <span>reference image</span>
                <button aria-label="Remove reference image" onClick={p.onClearImage}>✕</button>
              </div>
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
                accept="image/*,.glb,.gltf,.stl,.step,.stp,.shapr"
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
                      : "Describe a part, or a change…"
                }
              />
              <button type="submit" className="send" aria-label="Send" disabled={p.status === "generating"}><IconArrowUp /></button>
            </form>
          </div>
        </section>

        <section className="viewer">
          <div className="viewer-head">
            <div className="tabs">
              {(["3d", "code", "params", "print", "history"] as const).map((t) => (
                <button key={t} className={p.tab === t ? "on" : ""} onClick={() => p.setTab(t)}>
                  {t === "3d" ? "3D View" : t === "code" ? "Source" : t === "params" ? "Params" : t === "print" ? "Printability" : "History"}
                </button>
              ))}
            </div>
            {p.tab === "3d" && (
              <div className="viewer-tools">
                <button
                  className={`ghost sm${p.pinCtl.mode ? " on" : ""}`}
                  aria-pressed={p.pinCtl.mode}
                  title="Pin mode: click the model to mark a spot for a note or an AI edit (double-click works anytime)"
                  onClick={p.pinCtl.toggleMode}
                >
                  Pin
                </button>
                <button className={`ghost sm${p.showDims ? " on" : ""}`} aria-pressed={p.showDims} onClick={() => p.setShowDims((d) => !d)}>
                  {p.showDims ? "Hide dimensions" : "Dimensions"}
                </button>
                <button className="ghost sm" title="Toggle units" onClick={() => p.setUnits((u) => (u === "mm" ? "in" : "mm"))}>
                  {p.units === "mm" ? "mm" : "inches"}
                </button>
                <button className="ghost sm" onClick={() => p.setWireframe((w) => !w)}>{p.wireframe ? "Solid" : "Wireframe"}</button>
                <button className="ghost sm" onClick={() => p.viewerRef.current?.resetView()}>Reset view</button>
              </div>
            )}
          </div>

          <div className="viewer-body">
            <div style={{ display: p.tab === "3d" ? "block" : "none", height: "100%" }}>
              <Viewer
                ref={p.viewerRef}
                geometry={p.geometry}
                wireframe={p.wireframe}
                showDims={p.showDims}
                units={p.units}
                theme={p.theme}
                pins={p.pins}
                selectedPin={p.pinCtl.active?.pin.id ?? null}
                pinMode={p.pinCtl.mode}
                onPickPoint={p.pinCtl.pick}
                onSelectPin={p.pinCtl.select}
              />
              {p.pinCtl.active && (
                <div className="pin-panel">
                  <div className="pin-head">
                    <span>
                      Pin {p.pinCtl.active.index + 1} · {p.pinCtl.active.face} face · {p.pinCtl.active.pin.x}, {p.pinCtl.active.pin.y}, {p.pinCtl.active.pin.z} mm
                    </span>
                    <button className="x" aria-label="Close pin" onClick={p.pinCtl.close}>✕</button>
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
            {p.tab === "params" && (
              <ParamsPanel
                defaults={p.cadDefaults}
                values={p.paramValues}
                busy={p.status === "generating"}
                isCad={p.activeKind === "replicad"}
                onApply={p.onApplyParams}
                onSave={p.onSaveParams}
              />
            )}
            {p.tab === "print" && (
              <PrintabilityPanel report={p.report} canRepair={p.activeKind !== "replicad" && !!p.geometry} busy={p.status === "generating"} onRepair={p.onRepair} />
            )}
            {p.tab === "history" && <VersionHistory versions={p.versions} onRestore={p.onRestore} />}
          </div>

          <div className="statusbar">
            <span className="dims">{p.dims ? fmtDims(p.dims, p.units) : "—"}</span>
            {p.status === "generating" && <GenTimer />}
            {p.report && (
              <span className={`fits ${p.report.bedFit.fitsRotated ? "ok" : "no"}`}>
                {p.report.bedFit.fitsAsIs ? "fits bed ✓" : p.report.bedFit.fitsWithRotation ? "fits (rotated) ✓" : "larger than bed"}
              </span>
            )}
            <ExportMenu supportsStep={p.supportsStep} canExport={p.canExport} onExport={p.onExport} onOpenSlicer={p.onOpenSlicer} disabled={!p.geometry} />
          </div>
        </section>
      </main>
    </div>
  );
}

function Messages({ messages, onChip, onExample, resume, onResume }: { messages: ChatMessage[]; onChip: (s: string, forceMode?: Mode) => void; onExample: () => void; resume: string | null; onResume: () => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastText = messages[messages.length - 1]?.text;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, lastText]);
  return (
    <div className="messages">
      {messages.length === 0 && (
        <div className="empty">
          <p className="empty-q">What do you want to make?</p>
          <p className="empty-sub">Type a description, attach a photo — or drop a 3D file: .step imports as editable CAD, .glb/.stl as a mesh.</p>
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
          <div className={`bubble ${m.streaming ? "muted" : ""}`}>
            {m.image && <img className="bubble-img" src={m.image} alt="reference" />}
            {m.text && <span>{m.text}</span>}
          </div>
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

function PrintabilityPanel({ report, canRepair, busy, onRepair }: { report: PrintabilityReport | null; canRepair: boolean; busy: boolean; onRepair: () => void }) {
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
      {row("Fits the bed", report.bedFit.fitsAsIs ? "yes ✓" : report.bedFit.fitsWithRotation ? "rotated ✓" : "no ✕", report.bedFit.fitsRotated)}
      {row("Watertight / manifold", report.manifold.isWatertight ? "yes ✓" : `${report.manifold.boundaryEdges} open edge(s) ⚠`, report.manifold.isWatertight)}
      {row("Bounding box", `${report.boundingBox.size.x} × ${report.boundingBox.size.y} × ${report.boundingBox.size.z} mm`)}
      {row("Triangles", report.triangleCount.toLocaleString())}
      {row("Approx. volume", `${(report.volume.approxVolume / 1000).toFixed(1)} cm³`)}
      {row(`Overhangs > ${report.overhangs.thresholdDeg}°`, report.overhangs.overhangTriangleCount > 0 ? `${(report.overhangs.ratio * 100).toFixed(0)}% of faces ⚠` : "none ✓", report.overhangs.overhangTriangleCount === 0)}
      {report.warnings.length > 0 && (
        <ul className="warns">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {canRepair && !report.manifold.isWatertight && (
        <button className="primary sm" disabled={busy} onClick={onRepair} style={{ marginTop: 10 }}>
          Repair mesh — weld seams &amp; fill holes
        </button>
      )}
      <p className="fine">Generated meshes are often not watertight — that's expected. Wall/overhang are heuristics; bed-fit &amp; watertight are exact for this mesh.</p>
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

function ExportMenu({ supportsStep, canExport, onExport, onOpenSlicer, disabled }: { supportsStep: boolean; canExport: (f: ExportFormat) => boolean; onExport: (f: ExportFormat) => void; onOpenSlicer: (t: SlicerTarget) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-wrap">
      {open && (
        <div className="export-menu" onMouseLeave={() => setOpen(false)}>
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
      <h3>Parameters <span className="fine-inline">re-builds instantly · no AI call</span></h3>
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
        <button className="ghost sm" disabled={busy} onClick={() => { setLocal(defaults); onApply(defaults); }}>↺ Reset to AI values</button>
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
