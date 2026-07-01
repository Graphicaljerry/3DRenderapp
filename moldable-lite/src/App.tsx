import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Workspace } from "./components/Workspace";
import { LibraryModal } from "./components/LibraryModal";
import type { ViewerHandle } from "./components/Viewer";
import { selectEngine, type EngineSelection } from "./engine/selectEngine";
import type { BuildInput, EngineResult, ExportFormat } from "./engine/types";
import { generate, MODELS, type ApiMsg } from "./llm/anthropic";
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { extractJsBlock, extractJsonObject } from "./llm/extract";
import { parseSpec } from "./cad/spec";
import { EXAMPLE_SPEC, EXAMPLE_REPLICAD } from "./cad/example";
import { analyzePrintability, DEFAULT_PRINTER, type PrintabilityReport, type PrinterDefaults } from "./print/printability";
import { newProject, putProject } from "./store/projects";
import { appendVersion, restoreVersion } from "./store/versions";
import type { Project } from "./store/types";
import { downloadBlob, safeFileName } from "./lib/download";

export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; error?: boolean; streaming?: boolean };

const KEY_LS = "moldable_key";
const MODEL_LS = "moldable_model";
const PRINTER_LS = "moldable_printer";

function loadPrinter(): PrinterDefaults {
  try {
    const raw = localStorage.getItem(PRINTER_LS);
    if (raw) return { ...DEFAULT_PRINTER, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PRINTER;
}

let msgSeq = 0;
const mid = () => `m${++msgSeq}`;

export default function App() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_LS) ?? "");
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_LS) ?? MODELS[0].id);
  const [entered, setEntered] = useState(() => !!localStorage.getItem(KEY_LS));
  const [printer, setPrinter] = useState<PrinterDefaults>(loadPrinter);

  const [sel, setSel] = useState<EngineSelection | null>(null);
  const [booting, setBooting] = useState(false);

  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const apiHistory = useRef<ApiMsg[]>([]);

  const [result, setResult] = useState<EngineResult | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(null);
  const [report, setReport] = useState<PrintabilityReport | null>(null);
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [streamingText, setStreamingText] = useState("");
  const [codeBuffer, setCodeBuffer] = useState("");

  const [tab, setTab] = useState<"3d" | "code" | "print" | "history">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const viewer = useRef<ViewerHandle>(null);

  // ---- boot the CAD engine once we enter the workspace ----
  useEffect(() => {
    if (!entered || sel) return;
    let alive = true;
    setBooting(true);
    selectEngine()
      .then((s) => {
        if (alive) setSel(s);
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, [entered, sel]);

  function persist(next: Project) {
    setProject(next);
    void putProject(next);
  }

  function saveKey(k: string, m: string) {
    localStorage.setItem(KEY_LS, k.trim());
    localStorage.setItem(MODEL_LS, m);
    setKey(k.trim());
    setModel(m);
    setEntered(true);
    setShowSettings(false);
  }

  function savePrinter(p: PrinterDefaults) {
    localStorage.setItem(PRINTER_LS, JSON.stringify(p));
    setPrinter(p);
  }

  function applyResult(res: EngineResult, name: string, summary: string, promptText: string) {
    setResult(res);
    setGeometry(res.geometry);
    setDims(res.dims);
    setCodeBuffer(res.source.kind === "code" ? res.source.code : JSON.stringify(res.source.spec, null, 2));
    let rep: PrintabilityReport | null = null;
    try {
      rep = analyzePrintability(res.geometry, { bed: printer.bed, overhangThresholdDeg: printer.overhangThresholdDeg });
    } catch {
      rep = null;
    }
    setReport(rep);

    // snapshot + persist
    const base = project ?? newProject(name, res.kind);
    const named = base.versions.length === 0 && name ? { ...base, name } : base;
    const snap = appendVersion(named, {
      engine: res.kind,
      summary,
      code: res.source.kind === "code" ? res.source.code : undefined,
      spec: res.source.kind === "spec" ? res.source.spec : undefined,
      dims: res.dims,
    });
    snap.chat = [...messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, text: m.text, error: m.error })),
      { role: "user", text: promptText }];
    persist(snap);
  }

  async function send(promptText: string) {
    const p = promptText.trim();
    if (!p || status === "generating") return;
    if (!key) {
      setShowSettings(true);
      return;
    }
    if (!sel) return; // still booting

    const kind = sel.kind;
    setInput("");
    setStreamingText("");
    setMessages((m) => [...m, { id: mid(), role: "user", text: p }]);
    const placeholderId = mid();
    setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "Thinking…", streaming: true }]);
    setStatus("generating");

    const system = kind === "replicad" ? REPLICAD_SYSTEM_PROMPT : FALLBACK_JSON_PROMPT;
    let history: ApiMsg[] = [...apiHistory.current, { role: "user", content: p }];
    let finalRaw = "";
    let ok = false;

    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const raw = await generate(
          { apiKey: key, model, system, messages: history },
          { onToken: (_t, full) => setStreamingText(full) },
        );
        finalRaw = raw;
        try {
          let input: BuildInput;
          let name = "";
          let summary = "";
          if (kind === "replicad") {
            input = { kind: "code", code: extractJsBlock(raw) };
          } else {
            const spec = parseSpec(extractJsonObject(raw));
            input = { kind: "spec", spec };
            name = spec.name;
            summary = spec.summary ?? spec.name;
          }
          const res = await sel.engine.build(input);
          if (!name) name = deriveName(p);
          if (!summary) summary = `Updated the model — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`;
          applyResult(res, name, summary, p);
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: summary, streaming: false } : x)));
          ok = true;
          break;
        } catch (err: any) {
          if (attempt === 3) throw err;
          history = [
            ...history,
            { role: "assistant", content: raw },
            {
              role: "user",
              content: kind === "replicad" ? replicadRepairMessage(err) : jsonRepairMessage(String(err?.message ?? err)),
            },
          ];
          setMessages((m) =>
            m.map((x) => (x.id === placeholderId ? { ...x, text: `Attempt ${attempt} didn't build — retrying…`, streaming: true } : x)),
          );
        }
      }
    } catch (err: any) {
      setMessages((m) =>
        m.map((x) => (x.id === placeholderId ? { ...x, text: "⚠ " + String(err?.message ?? err), error: true, streaming: false } : x)),
      );
    } finally {
      if (ok) apiHistory.current = [...history, { role: "assistant", content: finalRaw }];
      setStatus("idle");
      setStreamingText("");
    }
  }

  async function rerun(edited: string) {
    if (!sel || status === "generating") return;
    setStatus("generating");
    try {
      const kind = sel.kind;
      const input: BuildInput = kind === "replicad" ? { kind: "code", code: edited } : { kind: "spec", spec: parseSpec(edited) };
      const res = await sel.engine.build(input);
      applyResult(res, project?.name ?? deriveName("Edited part"), `Manual edit — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`, "(manual code edit)");
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Re-ran your edited " + (kind === "replicad" ? "code" : "spec") + "." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  async function loadExample() {
    setEntered(true);
    // wait for the engine if it's still booting
    let s = sel;
    if (!s) {
      setBooting(true);
      s = await selectEngine();
      setSel(s);
      setBooting(false);
    }
    try {
      const input: BuildInput = s.kind === "replicad" ? { kind: "code", code: EXAMPLE_REPLICAD } : { kind: "spec", spec: EXAMPLE_SPEC };
      const res = await s.engine.build(input);
      applyResult(res, "Example L-bracket", EXAMPLE_SPEC.summary ?? "Example model.", "Show me the example");
      setMessages([{ id: mid(), role: "assistant", text: EXAMPLE_SPEC.summary ?? "Loaded the example L-bracket." }]);
    } catch (err: any) {
      setMessages([{ id: mid(), role: "assistant", text: "⚠ Couldn't build the example: " + String(err?.message ?? err), error: true }]);
    }
  }

  async function exportAs(format: ExportFormat) {
    if (!sel || !result) return;
    try {
      const blob = await sel.engine.export(result, format);
      downloadBlob(blob, safeFileName(project?.name ?? "model", format));
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Export failed: " + String(err?.message ?? err), error: true }]);
    }
  }

  async function restoreTo(versionId: string) {
    if (!project || !sel) return;
    const next = restoreVersion(project, versionId);
    persist(next);
    try {
      const input: BuildInput =
        next.engine === "replicad" ? { kind: "code", code: next.code ?? "" } : { kind: "spec", spec: parseSpec(JSON.stringify(next.spec)) };
      const res = await sel.engine.build(input);
      applyResultNoCommit(res);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restored an earlier version." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Restore failed to rebuild: " + String(err?.message ?? err), error: true }]);
    }
  }

  function applyResultNoCommit(res: EngineResult) {
    setResult(res);
    setGeometry(res.geometry);
    setDims(res.dims);
    setCodeBuffer(res.source.kind === "code" ? res.source.code : JSON.stringify(res.source.spec, null, 2));
    try {
      setReport(analyzePrintability(res.geometry, { bed: printer.bed, overhangThresholdDeg: printer.overhangThresholdDeg }));
    } catch {
      setReport(null);
    }
  }

  async function openProjectById(p: Project) {
    setShowLibrary(false);
    setProject(p);
    setMessages((p.chat ?? []).map((c) => ({ id: mid(), role: c.role, text: c.text, error: c.error })));
    apiHistory.current = [];
    if (!sel) return;
    try {
      const input: BuildInput =
        p.engine === "replicad" ? { kind: "code", code: p.code ?? "" } : { kind: "spec", spec: parseSpec(JSON.stringify(p.spec)) };
      const res = await sel.engine.build(input);
      applyResultNoCommit(res);
    } catch {
      /* leave viewer empty if HEAD doesn't rebuild */
    }
  }

  function startNew() {
    setProject(null);
    setMessages([]);
    apiHistory.current = [];
    setResult(null);
    setGeometry(null);
    setDims(null);
    setReport(null);
    setCodeBuffer("");
    setShowLibrary(false);
  }

  const specJson = useMemo(() => codeBuffer, [codeBuffer]);

  if (!entered) {
    return <KeyCard model={model} onContinue={saveKey} onExample={loadExample} />;
  }

  return (
    <>
      <Workspace
        projectName={project?.name ?? "Untitled part"}
        engineKind={sel?.kind ?? "primitive"}
        fellBack={sel?.fellBack ?? false}
        bootError={sel?.bootError}
        booting={booting || !sel}
        keyPresent={!!key}
        messages={messages}
        status={status}
        input={input}
        setInput={setInput}
        onSend={send}
        onExample={loadExample}
        geometry={geometry}
        dims={dims}
        report={report}
        wireframe={wireframe}
        setWireframe={setWireframe}
        viewerRef={viewer}
        tab={tab}
        setTab={setTab}
        codeText={specJson}
        streamingText={streamingText}
        onRerun={rerun}
        versions={project?.versions ?? []}
        onRestore={restoreTo}
        supportsStep={result?.supportsStep ?? false}
        canExport={(f) => sel?.engine.canExport(f) ?? false}
        onExport={exportAs}
        onOpenSettings={() => setShowSettings(true)}
        onOpenLibrary={() => setShowLibrary(true)}
        onNew={startNew}
      />
      {showSettings && (
        <SettingsModal
          initialKey={key}
          initialModel={model}
          printer={printer}
          onSaveKey={saveKey}
          onSavePrinter={savePrinter}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLibrary && <LibraryModal onOpen={openProjectById} onClose={() => setShowLibrary(false)} currentId={project?.id} />}
    </>
  );
}

function deriveName(prompt: string): string {
  const s = prompt.replace(/\s+/g, " ").trim();
  return s.length > 42 ? s.slice(0, 42) + "…" : s || "Untitled part";
}

// ---------------- gate + settings (small, inline) ----------------

function CubeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#2f7a70" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" />
      <path d="M3 7 12 12 21 7" />
      <path d="M12 12V22" />
    </svg>
  );
}

function KeyCard({ model, onContinue, onExample }: { model: string; onContinue: (k: string, m: string) => void; onExample: () => void }) {
  const [k, setK] = useState("");
  const [m, setM] = useState(model);
  return (
    <div className="gate">
      <div className="card">
        <div className="brand big">
          <CubeMark />
          <span className="wordmark">Moldable</span>
        </div>
        <h1>Turn a description into a 3D-printable model.</h1>
        <label>Anthropic API key</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="primary block" disabled={!k.trim()} onClick={() => onContinue(k, m)}>Continue</button>
        <p className="fine">No account. Your key stays in this browser, sent only to Anthropic.</p>
        <button className="link" onClick={onExample}>Try the built-in example first — zero API spend →</button>
      </div>
    </div>
  );
}

function SettingsModal({
  initialKey,
  initialModel,
  printer,
  onSaveKey,
  onSavePrinter,
  onClose,
}: {
  initialKey: string;
  initialModel: string;
  printer: PrinterDefaults;
  onSaveKey: (k: string, m: string) => void;
  onSavePrinter: (p: PrinterDefaults) => void;
  onClose: () => void;
}) {
  const [k, setK] = useState(initialKey);
  const [m, setM] = useState(initialModel);
  const [bed, setBed] = useState(printer.bed);
  const [oh, setOh] = useState(printer.overhangThresholdDeg);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Settings</h2>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <label>Anthropic API key</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="primary block" onClick={() => onSaveKey(k, m)}>Save key & model</button>

        <div className="sect-label">Printer defaults</div>
        <label>Bed size (mm): W × D × H</label>
        <div className="row3">
          <input type="number" value={bed.x} onChange={(e) => setBed({ ...bed, x: +e.target.value })} />
          <input type="number" value={bed.y} onChange={(e) => setBed({ ...bed, y: +e.target.value })} />
          <input type="number" value={bed.z} onChange={(e) => setBed({ ...bed, z: +e.target.value })} />
        </div>
        <label>Overhang warning threshold (°)</label>
        <input type="number" value={oh} onChange={(e) => setOh(+e.target.value)} />
        <button className="ghost block" onClick={() => onSavePrinter({ bed, overhangThresholdDeg: oh })}>Save printer defaults</button>
        <p className="fine">Stored only in this browser.</p>
      </div>
    </div>
  );
}
