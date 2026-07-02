import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Workspace } from "./components/Workspace";
import { LibraryModal } from "./components/LibraryModal";
import type { ViewerHandle } from "./components/Viewer";
import { getEngineSelection, type EngineSelection } from "./engine/selectEngine";
import { GenerativeEngine } from "./engine/generativeEngine";
import type { BuildInput, EngineResult, ExportFormat } from "./engine/types";
import { MODELS, type ApiMsg } from "./llm/anthropic";
import { LLM_PRESETS, llmPreset, llmReady, generateLlm, type LlmSettings, type LlmProviderId } from "./llm/llm";
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, VISION_ADDENDUM, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { repairGeometry } from "./print/repair";
import { blobToDataURL } from "./gen/util";
import { extractJsBlock, extractJsonObject } from "./llm/extract";
import { parseSpec } from "./cad/spec";
import { extractParams, type CadParams } from "./cad/params";
import { EXAMPLE_SPEC, EXAMPLE_REPLICAD } from "./cad/example";
import { openInSlicer, type SlicerTarget } from "./lib/slicer";
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
const LLM_LS = "moldable_llm";
const LLMKEYS_LS = "moldable_llm_keys";

function loadLlm(): LlmSettings {
  try {
    const raw = localStorage.getItem(LLM_LS);
    if (raw) {
      const v = JSON.parse(raw);
      if (LLM_PRESETS.some((p) => p.id === v.provider)) return v;
    }
  } catch {}
  return { provider: "anthropic", model: localStorage.getItem(MODEL_LS) ?? MODELS[0].id };
}
function loadLlmKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LLMKEYS_LS) ?? "{}");
  } catch {
    return {};
  }
}

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
    if (raw) {
      const v = JSON.parse(raw);
      const prov = PROVIDERS.find((pp) => pp.id === v.provider);
      if (prov) {
        // Migrate stale stored model ids (renamed/dead Spaces) to the provider's current default.
        const model = prov.models.some((m) => m.id === v.model) ? v.model : prov.models[0].id;
        return { provider: prov.id, model };
      }
    }
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
  const [llm, setLlm] = useState<LlmSettings>(loadLlm);
  const [llmKeys, setLlmKeys] = useState<Record<string, string>>(loadLlmKeys);

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
  const [cadDefaults, setCadDefaults] = useState<CadParams | null>(null);
  const [paramValues, setParamValues] = useState<CadParams>({});

  const [mode, setMode] = useState<Mode>("precise");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);

  const [tab, setTab] = useState<"3d" | "code" | "params" | "print" | "history">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const viewer = useRef<ViewerHandle>(null);

  useEffect(() => {
    if (!entered || sel) return;
    let alive = true;
    setBooting(true);
    getEngineSelection() // memoized: boots the CAD kernel exactly once
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
  function saveLlmSettings(s: LlmSettings, keys2: Record<string, string>) {
    localStorage.setItem(LLM_LS, JSON.stringify(s));
    localStorage.setItem(LLMKEYS_LS, JSON.stringify(keys2));
    setLlm(s);
    setLlmKeys(keys2);
    setEntered(true);
    setShowSettings(false);
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
    // In Precise mode with a working AI provider, a photo means "recreate this part
    // as exact CAD" (vision). Otherwise route to the free generative mesh path.
    const ready = llmReady(llm.provider === "anthropic" ? { ...llm, model } : llm, { anthropic: key, ...llmKeys });
    if (mode !== "precise" || !ready) setMode("generative");
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
    applyResultNoCommit(res);

    const base = project ?? newProject(name, res.kind);
    const named = base.versions.length === 0 && name ? { ...base, name } : base;
    const snap = appendVersion(named, {
      engine: res.kind,
      summary,
      code: res.source.kind === "code" ? res.source.code : undefined,
      params: res.source.kind === "code" ? res.source.params : undefined,
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
    if (res.source.kind === "code") {
      const defs = extractParams(res.source.code);
      setCadDefaults(defs);
      setParamValues(defs ? { ...defs, ...(res.source.params ?? {}) } : {});
    } else {
      setCadDefaults(null);
      setParamValues({});
    }
  }

  /** Slider change: rebuild the SAME code with new dimensions — no AI call, no version spam. */
  async function applyParams(values: CadParams) {
    if (!sel || !result || result.source.kind !== "code" || status === "generating") return;
    setParamValues(values);
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: result.source.code, params: values });
      applyResultNoCommit(res);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Those values don't build: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Persist the current slider-adjusted state as a version. */
  function saveParamsVersion() {
    if (!project || !result || result.source.kind !== "code") return;
    const next = appendVersion(project, {
      engine: result.kind === "replicad" ? "replicad" : "primitive",
      summary: `Adjusted parameters — ${result.dims.x} × ${result.dims.y} × ${result.dims.z} mm`,
      code: result.source.code,
      params: result.source.params,
      dims: result.dims,
    });
    persist(next);
    setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Saved the adjusted dimensions as a new version." }]);
  }

  /** One-click mesh repair: weld seams, drop bad triangles, fill holes, fix winding. */
  function repairMesh() {
    if (!result || result.kind === "replicad" || status === "generating") return;
    try {
      const out = repairGeometry(result.geometry);
      applyResultNoCommit({ ...result, geometry: out.geometry, dims: out.dims });
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: `🔧 Repaired the mesh: ${out.holesFilled} hole(s) filled, ${out.degenerateRemoved} bad triangle(s) removed, open edges ${out.boundaryEdgesBefore} → ${out.boundaryEdgesAfter}${out.flippedWinding ? ", surface flipped right-side-out" : ""}. Exports now use the repaired mesh.`,
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Repair failed: " + String(err?.message ?? err), error: true }]);
    }
  }

  /** Export a 3MF and hand it to a desktop slicer (deep link locally; download on hosted). */
  async function openSlicer(target: SlicerTarget) {
    if (!result) return;
    const engine = result.kind === "generative" ? genEngine.current : sel?.engine;
    if (!engine) return;
    try {
      const blob = await engine.export(result, "3mf");
      const how = await openInSlicer(target, blob, safeFileName(project?.name ?? "model", "3mf"));
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text:
            how === "deeplink"
              ? `Sent to ${target === "bambu" ? "Bambu Studio" : "OrcaSlicer"}. ${target === "bambu" ? "Bambu may ask “not from a trusted site — open anyway?” — that's expected for non-MakerWorld files; click yes." : ""} If nothing opened, the app may not be installed — a download works too.`
              : "Downloaded the 3MF — double-click it and it opens in your default slicer. (One-click send works when running locally with npm run dev.)",
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "⚠ Couldn't prepare the file: " + String(err?.message ?? err), error: true }]);
    }
  }

  /**
   * Seed the LLM's context with the project's current source so refinements
   * ("make it taller") edit THIS design instead of inventing a new one.
   */
  function seedHistory(engine: Project["engine"], code?: string, spec?: unknown) {
    if (engine === "replicad" && code) {
      apiHistory.current = [
        { role: "user", content: "(Context) This is the current design we are refining." },
        { role: "assistant", content: "```js\n" + code + "\n```" },
      ];
    } else if (engine === "primitive" && spec) {
      apiHistory.current = [
        { role: "user", content: "(Context) This is the current design we are refining." },
        { role: "assistant", content: JSON.stringify(spec) },
      ];
    } else {
      apiHistory.current = [];
    }
  }

  async function showFromGlb(glb: Blob, source: Extract<BuildInput, { kind: "gen" }>) {
    const { geometry: g, dims: d } = await glbToGeometry(glb);
    applyResultNoCommit({ kind: "generative", geometry: g, dims: d, source, supportsStep: false, glb });
  }

  // ---------------- generate ----------------
  async function send(promptText: string, forceMode?: Mode) {
    const p = promptText.trim();
    if (status === "generating") return;
    if (forceMode && forceMode !== mode) setMode(forceMode); // keep the UI switch in sync
    // The mode switch decides: Generative -> mesh provider; Precise + photo -> vision CAD.
    const useGen = (forceMode ?? mode) === "generative";

    if (useGen) {
      if (!p && !image) return;
      const prov = getProvider(genEng.provider);
      if (prov?.needsKey && !providerKeys[prov.id]) {
        setShowSettings(true);
        return;
      }

      // Text-only request on an image-only model? Auto-switch to a text-capable
      // model from the same provider instead of dead-ending the user in Settings.
      let genModel = genEng.model;
      let switchedTo: string | null = null;
      if (!image && p && prov) {
        const cur = prov.models.find((mm) => mm.id === genModel);
        if (cur && !cur.text) {
          const textModel = prov.models.find((mm) => mm.text);
          if (textModel) {
            genModel = textModel.id;
            switchedTo = textModel.label;
            saveGenSettings(providerKeys, prov.id, textModel.id, proxyBase); // keep Settings in sync
          } else {
            setMessages((m) => [
              ...m,
              {
                id: mid(),
                role: "assistant",
                text: `${prov.label}'s models here are image-only. Upload a photo with 📎, or pick a text-capable engine in Settings → Mesh model — Hugging Face (Hunyuan3D-2), Meshy, Tripo and fal (Rodin) all do text → 3D.`,
                error: true,
              },
            ]);
            return;
          }
        }
      }

      setInput("");
      setMessages((m) => [...m, { id: mid(), role: "user", text: p ? (image ? `🖼️ ${p}` : p) : "🖼️ (image)" }]);
      const ph = mid();
      setMessages((m) => [
        ...m,
        { id: ph, role: "assistant", text: switchedTo ? `Switched to ${switchedTo} — it supports text → 3D. Preparing…` : "Preparing…", streaming: true },
      ]);
      setStatus("generating");

      genEngine.current.config = { keyFor: (id) => providerKeys[id] || undefined, proxyBase };
      genEngine.current.onProgress = (pr) =>
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: `Generating mesh… ${pr.status}`, streaming: true } : x)));
      try {
        const res = await genEngine.current.build({ kind: "gen", image: image?.blob, prompt: p || undefined, provider: genEng.provider, model: genModel });
        const name = deriveName(p || "Photo model");
        const summary = `Generated a mesh — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm (${prov?.label ?? genEng.provider})`;
        applyResult(res, name, summary, p || "(image upload)");
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: summary, streaming: false } : x)));
        clearImage();
      } catch (err: any) {
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: "⚠ " + friendlyNet(String(err?.message ?? err)), error: true, streaming: false } : x)));
      } finally {
        setStatus("idle");
      }
      return;
    }

    // ---- precise (LLM -> replicad/primitive; photo = vision -> exact CAD) ----
    if (!p && !image) return;
    const effLlm: LlmSettings = llm.provider === "anthropic" ? { ...llm, model } : llm;
    if (!llmReady(effLlm, { anthropic: key, ...llmKeys })) {
      // Never fail silently: say why, and point at the free paths.
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: "Precise (CAD) mode needs an AI provider — set one in Settings → Precise CAD engine. Cheapest: a FREE Google Gemini key (aistudio.google.com/apikey). Best quality: an Anthropic Claude key. Or switch to Generative (AI mesh) above — free, no key at all.",
        },
      ]);
      setShowSettings(true);
      return;
    }
    if (!sel) {
      setMessages((m) => [
        ...m,
        { id: mid(), role: "assistant", text: "One moment — the CAD engine is still starting (the first load fetches ~11 MB, then it's cached). Try again in a few seconds." },
      ]);
      return;
    }

    const kind = sel.kind;
    const visionImage = image; // capture before we clear it
    setInput("");
    setStreamingText("");
    setMessages((m) => [...m, { id: mid(), role: "user", text: visionImage ? `🖼️ ${p || "(photo — recreate this part)"}` : p }]);
    const placeholderId = mid();
    setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "Thinking…", streaming: true }]);
    setStatus("generating");

    const system = (kind === "replicad" ? REPLICAD_SYSTEM_PROMPT : FALLBACK_JSON_PROMPT) + (visionImage ? VISION_ADDENDUM : "");
    const userMsg: ApiMsg = visionImage
      ? {
          role: "user",
          content: [
            {
              type: "image",
              mediaType: visionImage.blob.type || "image/png",
              dataBase64: (await blobToDataURL(visionImage.blob)).split(",")[1],
            },
            { type: "text", text: p || "Recreate this part as precise, printable CAD. Estimate dimensions from the photo." },
          ],
        }
      : { role: "user", content: p };
    // Cap the rolling context so long sessions don't slow down / blow the window.
    let history: ApiMsg[] = [...apiHistory.current.slice(-16), userMsg];
    let finalRaw = "";
    let ok = false;
    let lastErrMsg = ""; // stop early when retries hit the IDENTICAL wall — don't burn 3 slow AI calls

    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system, history, { onToken: (_t, full) => setStreamingText(full) }, proxyBase);
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
          if (visionImage) clearImage();
          ok = true;
          break;
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          if (attempt === 3 || msg === lastErrMsg) throw err; // same failure twice → the model is stuck; stop wasting time
          lastErrMsg = msg;
          history = [
            ...history,
            { role: "assistant", content: raw },
            { role: "user", content: kind === "replicad" ? replicadRepairMessage(err) : jsonRepairMessage(msg) },
          ];
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: `Attempt ${attempt} didn't build (${msg.slice(0, 80)}) — retrying…`, streaming: true } : x)));
        }
      }
    } catch (err: any) {
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "⚠ " + friendlyNet(String(err?.message ?? err)), error: true, streaming: false } : x)));
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

  /** Enter without any key: straight to the free generative engine. */
  function enterFree() {
    setEntered(true);
    setMode("generative");
  }

  async function loadExample() {
    setEntered(true);
    let s = sel;
    if (!s) {
      setBooting(true);
      s = await getEngineSelection(); // same memoized boot as the effect — no double kernel
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
    seedHistory(next.engine, next.code, next.spec);
    clearImage();
    try {
      if (next.engine === "generative" && next.glb) {
        await showFromGlb(next.glb, { kind: "gen", provider: next.genSource?.provider ?? "", model: next.genSource?.model ?? "", prompt: next.genSource?.prompt });
      } else if (sel) {
        const bi: BuildInput =
          next.engine === "replicad"
            ? { kind: "code", code: next.code ?? "", params: next.params }
            : { kind: "spec", spec: parseSpec(JSON.stringify(next.spec)) };
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
    seedHistory(p.engine, p.code, p.spec);
    clearImage();
    setMode(p.engine === "generative" ? "generative" : "precise");
    try {
      if (p.engine === "generative" && p.glb) {
        await showFromGlb(p.glb, { kind: "gen", provider: p.genSource?.provider ?? "", model: p.genSource?.model ?? "", prompt: p.genSource?.prompt });
      } else if (sel) {
        const bi: BuildInput =
          p.engine === "replicad" ? { kind: "code", code: p.code ?? "", params: p.params } : { kind: "spec", spec: parseSpec(JSON.stringify(p.spec)) };
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
    return <KeyCard model={model} onContinue={saveKey} onExample={loadExample} onFree={enterFree} />;
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
        cadDefaults={cadDefaults}
        paramValues={paramValues}
        onApplyParams={applyParams}
        onSaveParams={saveParamsVersion}
        onOpenSlicer={openSlicer}
        onRepair={repairMesh}
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
          llm={llm}
          llmKeys={llmKeys}
          printer={printer}
          providerKeys={providerKeys}
          genProvider={genEng.provider}
          genModel={genEng.model}
          proxyBase={proxyBase}
          onSaveKey={saveKey}
          onSaveLlm={saveLlmSettings}
          onSavePrinter={savePrinter}
          onSaveGen={saveGenSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLibrary && <LibraryModal onOpen={openProjectById} onClose={() => setShowLibrary(false)} currentId={project?.id} />}
    </>
  );
}

/** Never show a bare "Failed to fetch" — but leave already-crafted messages alone. */
function friendlyNet(msg: string): string {
  return /^(typeerror:?\s*)?(failed to fetch|networkerror.*|load failed)\.?$/i.test(msg.trim())
    ? "Couldn't reach the AI provider from this browser — check your internet/VPN and any ad-blocker (allow the provider's domain for this site), then try again."
    : msg;
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

function KeyCard({ model, onContinue, onExample, onFree }: { model: string; onContinue: (k: string, m: string) => void; onExample: () => void; onFree: () => void }) {
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
        <button className="primary block" onClick={onFree}>Start free — no key needed</button>
        <p className="fine">Uses the free Hugging Face engine for photo/text → 3D mesh. No account; nothing leaves this browser except the generation request.</p>
        <div className="sect-label">Optional: precise CAD mode (Claude)</div>
        <label>Anthropic API key — exact parts, editable STEP export</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="ghost block" disabled={!k.trim()} onClick={() => onContinue(k, m)}>Continue with my key</button>
        <p className="fine">No Anthropic key? Precise mode also works with a <b>free Google Gemini key</b>, OpenAI, Groq, or local Ollama — set it up later in Settings.</p>
        <button className="link" onClick={onExample}>Or view the built-in example model →</button>
      </div>
    </div>
  );
}

function SettingsModal({
  initialKey,
  initialModel,
  llm,
  llmKeys,
  printer,
  providerKeys,
  genProvider,
  genModel,
  proxyBase,
  onSaveKey,
  onSaveLlm,
  onSavePrinter,
  onSaveGen,
  onClose,
}: {
  initialKey: string;
  initialModel: string;
  llm: LlmSettings;
  llmKeys: Record<string, string>;
  printer: PrinterDefaults;
  providerKeys: Record<string, string>;
  genProvider: string;
  genModel: string;
  proxyBase: string;
  onSaveKey: (k: string, m: string) => void;
  onSaveLlm: (s: LlmSettings, keys: Record<string, string>) => void;
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

  // Precise-engine (LLM) picker state
  const [lp, setLp] = useState<LlmProviderId>(llm.provider);
  const [lmodel, setLmodel] = useState(llm.provider === "anthropic" ? "" : llm.model);
  const [lbase, setLbase] = useState(llm.baseUrl ?? "");
  const [lkeys, setLkeys] = useState<Record<string, string>>(llmKeys);
  const lpre = llmPreset(lp);

  function saveAi() {
    if (lp === "anthropic") {
      onSaveLlm({ provider: "anthropic", model: m }, lkeys);
      onSaveKey(k, m);
    } else {
      onSaveLlm(
        { provider: lp, model: (lmodel || lpre.defaultModel).trim(), baseUrl: lp === "custom" ? lbase.trim() : undefined },
        lkeys,
      );
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Settings</h2>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="sect-label">Precise CAD engine — the AI that writes the CAD code</div>
        <label>AI provider</label>
        <select
          value={lp}
          onChange={(e) => {
            const np = e.target.value as LlmProviderId;
            setLp(np);
            setLmodel(np === "anthropic" ? "" : llmPreset(np).defaultModel);
          }}
        >
          {LLM_PRESETS.map((pr) => (
            <option key={pr.id} value={pr.id}>{pr.label}{pr.free ? " · free" : ""}</option>
          ))}
        </select>
        {lp === "anthropic" ? (
          <>
            <label>Anthropic API key</label>
            <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
            <label>Claude model</label>
            <select value={m} onChange={(e) => setM(e.target.value)}>
              {MODELS.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </>
        ) : (
          <>
            {(lpre.needsKey || lp === "custom") && (
              <>
                <label>{lpre.label.split(" — ")[0]} API key{lp === "custom" ? " (if required)" : ""}</label>
                <input
                  type="password"
                  value={lkeys[lp] ?? ""}
                  onChange={(e) => setLkeys({ ...lkeys, [lp]: e.target.value })}
                  placeholder={lpre.keyHint}
                />
              </>
            )}
            {lp === "custom" && (
              <>
                <label>Base URL (ends in /v1)</label>
                <input value={lbase} onChange={(e) => setLbase(e.target.value)} placeholder="https://my-host/v1" />
              </>
            )}
            <label>Model id</label>
            <input value={lmodel} onChange={(e) => setLmodel(e.target.value)} placeholder={lpre.defaultModel || "model-name"} />
            <p className="fine">{lpre.keyHint}</p>
          </>
        )}
        <button className="primary block" onClick={saveAi}>Save AI settings</button>

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
        <label>Mesh model — “image or text” models can generate from a text prompt alone</label>
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
