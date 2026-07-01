import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Workspace } from "./components/Workspace";
import { LibraryModal } from "./components/LibraryModal";
import type { ViewerHandle } from "./components/Viewer";
import { selectEngine, type EngineSelection } from "./engine/selectEngine";
import { GenerativeEngine } from "./engine/generativeEngine";
import type { BuildInput, EngineResult, ExportFormat } from "./engine/types";
import { generate, MODELS, type ApiMsg } from "./llm/anthropic";
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { extractJsBlock, extractJsonObject } from "./llm/extract";
import { parseSpec } from "./cad/spec";
import { EXAMPLE_SPEC, EXAMPLE_REPLICAD } from "./cad/example";
import { analyzePrintability, DEFAULT_PRINTER, type PrintabilityReport, type PrinterDefaults } from "./print/printability";
import { PROVIDERS, getProvider } from "./gen/registry";
import { glbToGeometry } from "./gen/loadMesh";
import { newProject, putProject } from "./store/projects";
import { appendVersion, restoreVersion } from "./store/versions";
import type { Project } from "./store/types";
import { downloadBlob, safeFileName } from "./lib/download";

export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; error?: boolean; streaming?: boolean };
export type Mode = "precise" | "generative";

const KEY_LS = "moldable_key";
const MODEL_LS = "moldable_model";
const PRINTER_LS = "moldable_printer";
const PKEYS_LS = "moldable_provider_keys";
const PROXY_LS = "moldable_proxy";
const GENENG_LS = "moldable_geneng";

function loadPrinter(): PrinterDefaults {
  try {
    const raw = localStorage.getItem(PRINTER_LS);
    if (raw) return { ...DEFAULT_PRINTER, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PRINTER;
}
function loadProviderKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PKEYS_LS) ?? "{}");
  } catch {
    return {};
  }
}
function loadGenEng(): { provider: string; model: string } {
  try {
    const raw = localStorage.getItem(GENENG_LS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { provider: "hf", model: PROVIDERS[0].models[0].id };
}

let msgSeq = 0;
const mid = () => `m${++msgSeq}`;

function sourceText(source: BuildInput): string {
  if (source.kind === "code") return source.code;
  if (source.kind === "spec") return JSON.stringify(source.spec, null, 2);
  return JSON.stringify(source, null, 2);
}

export default function App() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_LS) ?? "");
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_LS) ?? MODELS[0].id);
  const [entered, setEntered] = useState(() => !!localStorage.getItem(KEY_LS));
  const [printer, setPrinter] = useState<PrinterDefaults>(loadPrinter);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(loadProviderKeys);
  const [proxyBase, setProxyBase] = useState(() => localStorage.getItem(PROXY_LS) ?? "");
  const [genEng, setGenEng] = useState(loadGenEng);

  const [sel, setSel] = useState<EngineSelection | null>(null);
  const [booting, setBooting] = useState(false);
  const genEngine = useRef(new GenerativeEngine());

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

  const [mode, setMode] = useState<Mode>("precise");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);

  const [tab, setTab] = useState<"3d" | "code" | "print" | "history">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const viewer = useRef<ViewerHandle>(null);

  useEffect(() => {
    if (!entered || sel) return;
    let alive = true;
    setBooting(true);
    selectEngine()
      .then((s) => alive && setSel(s))
      .finally(() => alive && setBooting(false));
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
  function saveGenSettings(keys: Record<string, string>, provider: string, gmodel: string, proxy: string) {
    localStorage.setItem(PKEYS_LS, JSON.stringify(keys));
    localStorage.setItem(GENENG_LS, JSON.stringify({ provider, model: gmodel }));
    localStorage.setItem(PROXY_LS, proxy);
    setProviderKeys(keys);
    setGenEng({ provider, model: gmodel });
    setProxyBase(proxy);
  }

  function pickImage(file: File) {
    if (image) URL.revokeObjectURL(image.url);
    setImage({ blob: file, url: URL.createObjectURL(file) });
    setMode("generative");
  }
  function clearImage() {
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
  }

  function computeReport(geo: THREE.BufferGeometry): PrintabilityReport | null {
    try {
      return analyzePrintability(geo, { bed: printer.bed, overhangThresholdDeg: printer.overhangThresholdDeg });
    } catch {
      return null;
    }
  }

  function applyResult(res: EngineResult, name: string, summary: string, promptText: string) {
    setResult(res);
    setGeometry(res.geometry);
    setDims(res.dims);
    setCodeBuffer(sourceText(res.source));
    setReport(computeReport(res.geometry));

    const base = project ?? newProject(name, res.kind);
    const named = base.versions.length === 0 && name ? { ...base, name } : base;
    const snap = appendVersion(named, {
      engine: res.kind,
      summary,
      code: res.source.kind === "code" ? res.source.code : undefined,
      spec: res.source.kind === "spec" ? res.source.spec : undefined,
      dims: res.dims,
      glb: res.glb,
      genSource: res.source.kind === "gen" ? { provider: res.source.provider, model: res.source.model, prompt: res.source.prompt } : undefined,
    });
    snap.chat = [
      ...messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, text: m.text, error: m.error })),
      { role: "user", text: promptText },
    ];
    persist(snap);
  }

  function applyResultNoCommit(res: EngineResult) {
    setResult(res);
    setGeometry(res.geometry);
    setDims(res.dims);
    setCodeBuffer(sourceText(res.source));
    setReport(computeReport(res.geometry));
  }

  async function showFromGlb(glb: Blob, source: Extract<BuildInput, { kind: "gen" }>) {
    const { geometry: g, dims: d } = await glbToGeometry(glb);
    applyResultNoCommit({ kind: "generative", geometry: g, dims: d, source, supportsStep: false, glb });
  }

  // ---------------- generate ----------------
  async function send(promptText: string) {
    const p = promptText.trim();
    if (status === "generating") return;
    const useGen = mode === "generative" || !!image;

    if (useGen) {
      if (!p && !image) return;
      const prov = getProvider(genEng.provider);
      if (prov?.needsKey && !providerKeys[prov.id]) {
        setShowSettings(true);
        return;
      }
      setInput("");
      setMessages((m) => [...m, { id: mid(), role: "user", text: p ? (image ? `🖼️ ${p}` : p) : "🖼️ (image)" }]);
      const ph = mid();
      setMessages((m) => [...m, { id: ph, role: "assistant", text: "Preparing…", streaming: true }]);
      setStatus("generating");

      genEngine.current.config = { keyFor: (id) => providerKeys[id] || undefined, proxyBase };
      genEngine.current.onProgress = (pr) =>
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: `Generating mesh… ${pr.status}`, streaming: true } : x)));
      try {
        const res = await genEngine.current.build({ kind: "gen", image: image?.blob, prompt: p || undefined, provider: genEng.provider, model: genEng.model });
        const name = deriveName(p || "Photo model");
        const summary = `Generated a mesh — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm (${prov?.label ?? genEng.provider})`;
        applyResult(res, name, summary, p || "(image upload)");
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: summary, streaming: false } : x)));
        clearImage();
      } catch (err: any) {
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: "⚠ " + String(err?.message ?? err), error: true, streaming: false } : x)));
      } finally {
        setStatus("idle");
      }
      return;
    }

    // ---- precise (Claude -> replicad/primitive) ----
    if (!p) return;
    if (!key) {
      setShowSettings(true);
      return;
    }
    if (!sel) return;

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
        const raw = await generate({ apiKey: key, model, system, messages: history }, { onToken: (_t, full) => setStreamingText(full) });
        finalRaw = raw;
        try {
          let bi: BuildInput;
          let name = "";
          let summary = "";
          if (kind === "replicad") {
            bi = { kind: "code", code: extractJsBlock(raw) };
          } else {
            const spec = parseSpec(extractJsonObject(raw));
            bi = { kind: "spec", spec };
            name = spec.name;
            summary = spec.summary ?? spec.name;
          }
          const res = await sel.engine.build(bi);
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
            { role: "user", content: kind === "replicad" ? replicadRepairMessage(err) : jsonRepairMessage(String(err?.message ?? err)) },
          ];
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: `Attempt ${attempt} didn't build — retrying…`, streaming: true } : x)));
        }
      }
    } catch (err: any) {
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "⚠ " + String(err?.message ?? err), error: true, streaming: false } : x)));
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
      const bi: BuildInput = kind === "replicad" ? { kind: "code", code: edited } : { kind: "spec", spec: parseSpec(edited) };
      const res = await sel.engine.build(bi);
      applyResult(res, project?.name ?? deriveName("Edited part"), `Manual edit — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`, "(manual edit)");
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Re-ran your edited " + (kind === "replicad" ? "code" : "spec") + "." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  async function loadExample() {
    setEntered(true);
    let s = sel;
    if (!s) {
      setBooting(true);
      s = await selectEngine();
      setSel(s);
      setBooting(false);
    }
    try {
      const bi: BuildInput = s.kind === "replicad" ? { kind: "code", code: EXAMPLE_REPLICAD } : { kind: "spec", spec: EXAMPLE_SPEC };
      const res = await s.engine.build(bi);
      applyResult(res, "Example L-bracket", EXAMPLE_SPEC.summary ?? "Example model.", "Show me the example");
      setMessages([{ id: mid(), role: "assistant", text: EXAMPLE_SPEC.summary ?? "Loaded the example L-bracket." }]);
    } catch (err: any) {
      setMessages([{ id: mid(), role: "assistant", text: "⚠ Couldn't build the example: " + String(err?.message ?? err), error: true }]);
    }
  }

  async function exportAs(format: ExportFormat) {
    if (!result) return;
    const engine = result.kind === "generative" ? genEngine.current : sel?.engine;
    if (!engine) return;
    try {
      const blob = await engine.export(result, format);
      downloadBlob(blob, safeFileName(project?.name ?? "model", format));
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Export failed: " + String(err?.message ?? err), error: true }]);
    }
  }

  async function restoreTo(versionId: string) {
    if (!project) return;
    const next = restoreVersion(project, versionId);
    persist(next);
    try {
      if (next.engine === "generative" && next.glb) {
        await showFromGlb(next.glb, { kind: "gen", provider: next.genSource?.provider ?? "", model: next.genSource?.model ?? "", prompt: next.genSource?.prompt });
      } else if (sel) {
        const bi: BuildInput = next.engine === "replicad" ? { kind: "code", code: next.code ?? "" } : { kind: "spec", spec: parseSpec(JSON.stringify(next.spec)) };
        applyResultNoCommit(await sel.engine.build(bi));
      }
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restored an earlier version." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Restore failed to rebuild: " + String(err?.message ?? err), error: true }]);
    }
  }

  async function openProjectById(p: Project) {
    setShowLibrary(false);
    setProject(p);
    setMessages((p.chat ?? []).map((c) => ({ id: mid(), role: c.role, text: c.text, error: c.error })));
    apiHistory.current = [];
    try {
      if (p.engine === "generative" && p.glb) {
        await showFromGlb(p.glb, { kind: "gen", provider: p.genSource?.provider ?? "", model: p.genSource?.model ?? "", prompt: p.genSource?.prompt });
      } else if (sel) {
        const bi: BuildInput = p.engine === "replicad" ? { kind: "code", code: p.code ?? "" } : { kind: "spec", spec: parseSpec(JSON.stringify(p.spec)) };
        applyResultNoCommit(await sel.engine.build(bi));
      }
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
    clearImage();
    setShowLibrary(false);
  }

  const activeKind = result?.kind ?? (mode === "generative" ? "generative" : sel?.kind ?? "primitive");

  if (!entered) {
    return <KeyCard model={model} onContinue={saveKey} onExample={loadExample} />;
  }

  return (
    <>
      <Workspace
        projectName={project?.name ?? "Untitled part"}
        activeKind={activeKind}
        genLabel={getProvider(genEng.provider)?.label ?? genEng.provider}
        fellBack={sel?.fellBack ?? false}
        bootError={sel?.bootError}
        booting={booting || (!sel && mode === "precise")}
        keyPresent={!!key}
        mode={mode}
        setMode={setMode}
        imageUrl={image?.url ?? null}
        onPickImage={pickImage}
        onClearImage={clearImage}
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
        codeText={codeBuffer}
        streamingText={streamingText}
        onRerun={rerun}
        versions={project?.versions ?? []}
        onRestore={restoreTo}
        supportsStep={result?.supportsStep ?? false}
        canExport={(f) => (result?.kind === "generative" ? genEngine.current.canExport(f) : sel?.engine.canExport(f) ?? false)}
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
          providerKeys={providerKeys}
          genProvider={genEng.provider}
          genModel={genEng.model}
          proxyBase={proxyBase}
          onSaveKey={saveKey}
          onSavePrinter={savePrinter}
          onSaveGen={saveGenSettings}
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
        <h1>Turn a description — or a photo — into a 3D-printable model.</h1>
        <label>Anthropic API key (for the Precise CAD engine)</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="primary block" disabled={!k.trim()} onClick={() => onContinue(k, m)}>Continue</button>
        <p className="fine">No account. Keys stay in this browser. Image→3D engines are set up later in Settings (free Hugging Face works with no key).</p>
        <button className="link" onClick={onExample}>Try the built-in example first — zero API spend →</button>
      </div>
    </div>
  );
}

function SettingsModal({
  initialKey,
  initialModel,
  printer,
  providerKeys,
  genProvider,
  genModel,
  proxyBase,
  onSaveKey,
  onSavePrinter,
  onSaveGen,
  onClose,
}: {
  initialKey: string;
  initialModel: string;
  printer: PrinterDefaults;
  providerKeys: Record<string, string>;
  genProvider: string;
  genModel: string;
  proxyBase: string;
  onSaveKey: (k: string, m: string) => void;
  onSavePrinter: (p: PrinterDefaults) => void;
  onSaveGen: (keys: Record<string, string>, provider: string, model: string, proxy: string) => void;
  onClose: () => void;
}) {
  const [k, setK] = useState(initialKey);
  const [m, setM] = useState(initialModel);
  const [bed, setBed] = useState(printer.bed);
  const [oh, setOh] = useState(printer.overhangThresholdDeg);
  const [keys, setKeys] = useState<Record<string, string>>(providerKeys);
  const [gp, setGp] = useState(genProvider);
  const [gm, setGm] = useState(genModel);
  const [proxy, setProxy] = useState(proxyBase);
  const prov = getProvider(gp) ?? PROVIDERS[0];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Settings</h2>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="sect-label">Precise CAD engine (Claude → replicad)</div>
        <label>Anthropic API key</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="primary block" onClick={() => onSaveKey(k, m)}>Save key & model</button>

        <div className="sect-label">Generative 3D engine (photo / text → mesh)</div>
        <label>Engine</label>
        <select
          value={gp}
          onChange={(e) => {
            const np = e.target.value;
            setGp(np);
            setGm(getProvider(np)?.models[0].id ?? "");
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}{p.free ? " · free" : ""}</option>
          ))}
        </select>
        <label>Model</label>
        <select value={gm} onChange={(e) => setGm(e.target.value)}>
          {prov.models.map((mm) => (
            <option key={mm.id} value={mm.id}>{mm.label}</option>
          ))}
        </select>
        <p className="fine">{prov.needsKey ? `Needs a key — ${prov.keyHint}` : `Free — ${prov.keyHint}`}</p>
        {PROVIDERS.filter((p) => p.needsKey || p.id === "hf").map((p) => (
          <div key={p.id}>
            <label>{p.label} key{p.needsKey ? "" : " (optional)"}</label>
            <input
              type="password"
              value={keys[p.id] ?? ""}
              onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
              placeholder={p.keyHint}
            />
          </div>
        ))}
        <label>Proxy base URL (advanced — leave blank to use the local dev relay)</label>
        <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="blank = http://localhost:5173 relay" />
        <button className="primary block" onClick={() => onSaveGen(keys, gp, gm, proxy.trim())}>Save generative settings</button>

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
        <p className="fine">Everything is stored only in this browser.</p>
      </div>
    </div>
  );
}
