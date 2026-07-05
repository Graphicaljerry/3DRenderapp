import { useEffect, useRef, useState, type RefObject } from "react";
import { Viewer, type ViewerHandle, type PickedPoint } from "./Viewer";
import type { Pin } from "../store/types";
import type { ChatMessage, Mode } from "../App";
import type { PrintabilityReport } from "../print/printability";
import type { Version } from "../store/types";
import type { EngineKind, ExportFormat } from "../engine/types";
import { paramRange, type CadParams } from "../cad/params";
import { HEAVY_TRIANGLES } from "../print/simplify";
import type { SlicerTarget } from "../lib/slicer";
import { IconPaperclip, IconArrowUp, IconUser, IconMoon, IconSun, IconX, IconCheck, IconReset, } from "./icons";
import type * as THREE from "three";
import { MODELS } from "../llm/anthropic";
import { LLM_PRESETS, type LlmProviderId } from "../llm/llm";
import { PROVIDERS } from "../gen/registry";

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
  brain: { provider: LlmProviderId; model: string };
  hasBrainKey: (provider: LlmProviderId) => boolean;
  onPickBrain: (provider: LlmProviderId, model: string) => void;
  genProvider: string;
  genModel: string;
  hasGenKey: (provider: string) => boolean;
  onPickEngine: (provider: string, model: string) => void;
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
  onSimplify: () => void;
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
  const [profileMenu, setProfileMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

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
          <Messages messages={p.messages} onChip={p.onSend} onExample={p.onExample} resume={p.resume} onResume={p.onResume} status={p.status} />

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
                <button aria-label="Remove reference image" onClick={p.onClearImage}><IconX /></button>
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
            {(p.tab === "3d" || p.tab === "params") && (
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
                    <button className="x" aria-label="Close pin" onClick={p.pinCtl.close}><IconX /></button>
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
              <PrintabilityPanel report={p.report} canRepair={p.activeKind !== "replicad" && !!p.geometry} busy={p.status === "generating"} onRepair={p.onRepair} onSimplify={p.onSimplify} />
            )}
            {p.tab === "history" && <VersionHistory versions={p.versions} onRestore={p.onRestore} />}
          </div>

          <div className="statusbar">
            <span className="dims">{p.dims ? fmtDims(p.dims, p.units) : "—"}</span>
            {p.status === "generating" && <GenTimer />}
            {p.report && (
              <span className={`fits ${p.report.bedFit.fitsRotated ? "ok" : "no"}`}>
                {p.report.bedFit.fitsAsIs ? "fits bed" : p.report.bedFit.fitsWithRotation ? "fits (rotated)" : "larger than bed"}
              </span>
            )}
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

/** In-chat quick switch for the Precise (CAD) AI brain. */
function BrainPicker({ brain, hasKey, onPick }: { brain: { provider: LlmProviderId; model: string }; hasKey: (p: LlmProviderId) => boolean; onPick: (p: LlmProviderId, m: string) => void }) {
  const value = brain.provider === "anthropic" ? `anthropic|${brain.model}` : `${brain.provider}|`;
  const claudeKey = hasKey("anthropic");
  return (
    <select
      className="modelpick"
      value={value}
      title="Which AI writes the CAD — switch models on the fly"
      onChange={(e) => {
        const [prov, m] = splitVal(e.target.value);
        onPick(prov as LlmProviderId, m);
      }}
    >
      <optgroup label={`Claude — most accurate${claudeKey ? "" : " · add key"}`}>
        {MODELS.map((mm) => (
          <option key={mm.id} value={`anthropic|${mm.id}`}>{mm.label}</option>
        ))}
      </optgroup>
      <optgroup label="Other providers">
        {LLM_PRESETS.filter((pr) => pr.id !== "anthropic").map((pr) => {
          const needs = pr.needsKey && !hasKey(pr.id);
          return (
            <option key={pr.id} value={`${pr.id}|`}>
              {pr.label.split(" — ")[0]}{pr.free ? " (free)" : ""}{needs ? " · add key" : ""}
            </option>
          );
        })}
      </optgroup>
    </select>
  );
}

/** In-chat quick switch for the Generative (AI mesh) engine + model. */
function EnginePicker({ provider, model, hasKey, onPick }: { provider: string; model: string; hasKey: (p: string) => boolean; onPick: (p: string, m: string) => void }) {
  return (
    <select
      className="modelpick"
      value={`${provider}|${model}`}
      title="Which engine turns a photo or text into a mesh"
      onChange={(e) => {
        const [prov, m] = splitVal(e.target.value);
        onPick(prov, m);
      }}
    >
      {PROVIDERS.map((pv) => {
        const needs = pv.needsKey && !hasKey(pv.id);
        return (
          <optgroup key={pv.id} label={`${pv.label}${pv.free ? " · free" : ""}${needs ? " · add key" : ""}`}>
            {pv.models.map((mm) => (
              <option key={mm.id} value={`${pv.id}|${mm.id}`}>{mm.label}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function Messages({ messages, onChip, onExample, resume, onResume, status }: { messages: ChatMessage[]; onChip: (s: string, forceMode?: Mode) => void; onExample: () => void; resume: string | null; onResume: () => void; status: "idle" | "generating" }) {
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
              {/* Retry / edit are offered on typed prompts (an uploaded photo can't be re-attached). */}
              {m.role === "user" && !m.image && m.text && (
                <div className="msg-actions">
                  <button className="msg-act" disabled={busy} title="Send this again" onClick={() => onChip(m.text, m.mode)}>Retry</button>
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

function PrintabilityPanel({ report, canRepair, busy, onRepair, onSimplify }: { report: PrintabilityReport | null; canRepair: boolean; busy: boolean; onRepair: () => void; onSimplify: () => void }) {
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
