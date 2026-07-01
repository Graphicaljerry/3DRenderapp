import { useEffect, useRef, useState, type RefObject } from "react";
import { Viewer, type ViewerHandle } from "./Viewer";
import type { ChatMessage, Mode } from "../App";
import type { PrintabilityReport } from "../print/printability";
import type { Version } from "../store/types";
import type { EngineKind, ExportFormat } from "../engine/types";
import type * as THREE from "three";

const SUGGESTIONS = [
  "a 60×40 mm bracket, 4 mm thick, with two 4 mm holes",
  "a phone stand angled at 60 degrees",
  "a low-poly fox figurine",
];

const EXPORT_FORMATS: { f: ExportFormat; label: string; desc: string }[] = [
  { f: "stl", label: "STL", desc: "Universal print mesh" },
  { f: "3mf", label: "3MF", desc: "Print mesh + units (recommended)" },
  { f: "step", label: "STEP", desc: "Editable solid · Shapr3D/Fusion" },
  { f: "obj", label: "OBJ", desc: "Mesh (reference)" },
];

interface Props {
  projectName: string;
  activeKind: EngineKind;
  genLabel: string;
  fellBack: boolean;
  bootError?: string;
  booting: boolean;
  keyPresent: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  imageUrl: string | null;
  onPickImage: (f: File) => void;
  onClearImage: () => void;
  messages: ChatMessage[];
  status: "idle" | "generating";
  input: string;
  setInput: (v: string) => void;
  onSend: (p: string) => void;
  onExample: () => void;
  geometry: THREE.BufferGeometry | null;
  dims: { x: number; y: number; z: number } | null;
  report: PrintabilityReport | null;
  wireframe: boolean;
  setWireframe: (f: (w: boolean) => boolean) => void;
  viewerRef: RefObject<ViewerHandle>;
  tab: "3d" | "code" | "print" | "history";
  setTab: (t: "3d" | "code" | "print" | "history") => void;
  codeText: string;
  streamingText: string;
  onRerun: (edited: string) => void;
  versions: Version[];
  onRestore: (id: string) => void;
  supportsStep: boolean;
  canExport: (f: ExportFormat) => boolean;
  onExport: (f: ExportFormat) => void;
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onNew: () => void;
}

export function Workspace(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const enginePill =
    p.activeKind === "replicad" ? "Engine · replicad" : p.activeKind === "generative" ? `Engine · ${p.genLabel}` : "Engine · primitive";

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
    if (f) p.onPickImage(f);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <CubeMark />
          <span className="wordmark">Moldable</span>
          <span className="sep">/</span>
          <span className="project">{p.projectName}</span>
        </div>
        <div className="topbar-right">
          <span className={`pill ${p.activeKind === "primitive" ? "pill-warn" : ""}`}>{enginePill}</span>
          <button className="ghost" onClick={p.onOpenLibrary}>Library</button>
          <button className="ghost" onClick={p.onOpenSettings}>{p.keyPresent ? "Settings" : "Add key"}</button>
          <button className="primary sm" onClick={p.onNew}>+ New</button>
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
          <Messages messages={p.messages} onChip={p.onSend} onExample={p.onExample} />

          <div className="composer-wrap">
            <div className="modebar">
              <div className="seg">
                <button className={p.mode === "precise" ? "on" : ""} onClick={() => p.setMode("precise")}>Precise (CAD)</button>
                <button className={p.mode === "generative" ? "on" : ""} onClick={() => p.setMode("generative")}>Generative (AI mesh)</button>
              </div>
              <span className="modehint">
                {p.mode === "precise" ? "Exact parts from text · STEP export" : "Whole/organic objects from a photo or text"}
              </span>
            </div>

            {p.imageUrl && (
              <div className="imgchip">
                <img src={p.imageUrl} alt="reference" />
                <span>reference image</span>
                <button onClick={p.onClearImage}>✕</button>
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
                onClick={() => fileRef.current?.click()}
              >
                📎
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
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
                placeholder={p.mode === "generative" ? "Describe it, or just upload a photo…" : "Describe a part, or a change…"}
              />
              <button type="submit" className="send" disabled={p.status === "generating"}>↑</button>
            </form>
          </div>
        </section>

        <section className="viewer">
          <div className="viewer-head">
            <div className="tabs">
              {(["3d", "code", "print", "history"] as const).map((t) => (
                <button key={t} className={p.tab === t ? "on" : ""} onClick={() => p.setTab(t)}>
                  {t === "3d" ? "3D View" : t === "code" ? "Source" : t === "print" ? "Printability" : "History"}
                </button>
              ))}
            </div>
            {p.tab === "3d" && (
              <div className="viewer-tools">
                <button className="ghost sm" onClick={() => p.setWireframe((w) => !w)}>{p.wireframe ? "Solid" : "Wireframe"}</button>
                <button className="ghost sm" onClick={() => p.viewerRef.current?.resetView()}>Reset view</button>
              </div>
            )}
          </div>

          <div className="viewer-body">
            <div style={{ display: p.tab === "3d" ? "block" : "none", height: "100%" }}>
              <Viewer ref={p.viewerRef} geometry={p.geometry} wireframe={p.wireframe} />
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
            {p.tab === "print" && <PrintabilityPanel report={p.report} />}
            {p.tab === "history" && <VersionHistory versions={p.versions} onRestore={p.onRestore} />}
          </div>

          <div className="statusbar">
            <span className="dims">{p.dims ? `${p.dims.x} × ${p.dims.y} × ${p.dims.z} mm` : "—"}</span>
            {p.report && (
              <span className={`fits ${p.report.bedFit.fitsRotated ? "ok" : "no"}`}>
                {p.report.bedFit.fitsAsIs ? "fits bed ✓" : p.report.bedFit.fitsWithRotation ? "fits (rotated) ✓" : "larger than bed"}
              </span>
            )}
            <ExportMenu supportsStep={p.supportsStep} canExport={p.canExport} onExport={p.onExport} disabled={!p.geometry} />
          </div>
        </section>
      </main>
    </div>
  );
}

function Messages({ messages, onChip, onExample }: { messages: ChatMessage[]; onChip: (s: string) => void; onExample: () => void }) {
  return (
    <div className="messages">
      {messages.length === 0 && (
        <div className="empty">
          <p className="empty-q">What do you want to make?</p>
          <p className="empty-sub">Type a description, or drop a photo (📎) to turn it into a 3D model.</p>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => onChip(s)}>{s}</button>
            ))}
            <button className="chip subtle" onClick={onExample}>Try the built-in example (no API spend)</button>
          </div>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role} ${m.error ? "err" : ""}`}>
          <span className="who">{m.role === "user" ? "You" : "Moldable"}</span>
          <div className={`bubble ${m.streaming ? "muted" : ""}`}>{m.text}</div>
        </div>
      ))}
    </div>
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

function PrintabilityPanel({ report }: { report: PrintabilityReport | null }) {
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

function ExportMenu({ supportsStep, canExport, onExport, disabled }: { supportsStep: boolean; canExport: (f: ExportFormat) => boolean; onExport: (f: ExportFormat) => void; disabled: boolean }) {
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
        </div>
      )}
      <button className="primary" disabled={disabled} onClick={() => setOpen((o) => !o)}>Export ▾</button>
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
