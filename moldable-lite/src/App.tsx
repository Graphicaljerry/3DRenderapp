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
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, VISION_ADDENDUM, IMPORT_ADDENDUM, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { repairGeometry } from "./print/repair";
import { blobToDataURL } from "./gen/util";
import { extractJsBlock, extractJsonObject } from "./llm/extract";
import { parseSpec } from "./cad/spec";
import { extractParams, type CadParams } from "./cad/params";
import { EXAMPLE_SPEC, EXAMPLE_REPLICAD, IMPORT_PASSTHROUGH } from "./cad/example";
import { openInSlicer, type SlicerTarget } from "./lib/slicer";
import { IconGitHub, IconGoogle, IconX } from "./components/icons";
import { analyzePrintability, DEFAULT_PRINTER, type PrintabilityReport, type PrinterDefaults } from "./print/printability";
import { PRINTERS, PRINTER_BRANDS, printerKey } from "./print/printers";
import { PROVIDERS, getProvider } from "./gen/registry";
import { glbToGeometry, loadAnyMesh } from "./gen/loadMesh";
import { newProject, putProject, getProject } from "./store/projects";
import { appendVersion, restoreVersion } from "./store/versions";
import type { Project, Pin } from "./store/types";
import { uid } from "./lib/id";
import type { PickedPoint } from "./components/Viewer";
import { downloadBlob, safeFileName } from "./lib/download";
import { exportSettings, importSettings } from "./lib/backup";
import { DEFAULT_RELAY, cloudUser, cloudSignUp, cloudSignIn, cloudSignOut, cloudPush, cloudPull, cloudOAuth, cloudMagicLink, onAuthChange, hasAuthReturn, completeAuthReturn } from "./lib/cloud";

export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; error?: boolean; streaming?: boolean; image?: string };
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
function defaultModelOf(prov: (typeof PROVIDERS)[number]): string {
  return (prov.models.find((m) => m.recommended) ?? prov.models[0]).id;
}
function loadGenEng(): { provider: string; model: string } {
  try {
    const raw = localStorage.getItem(GENENG_LS);
    if (raw) {
      const v = JSON.parse(raw);
      const prov = PROVIDERS.find((pp) => pp.id === v.provider);
      if (prov) {
        // Migrate stale stored model ids (renamed/dead Spaces) to the provider's default.
        let model = prov.models.some((m) => m.id === v.model) ? v.model : defaultModelOf(prov);
        // One-time heal: an earlier bug persisted the heavy Hunyuan3D-2 as the HF
        // default after any text prompt. Reset those users to the light recommended
        // model so photo generation stops failing on the quota-hungry model.
        if (!localStorage.getItem("moldable_geneng_healed")) {
          localStorage.setItem("moldable_geneng_healed", "1");
          if (prov.id === "hf" && model === "tencent/Hunyuan3D-2") model = defaultModelOf(prov);
        }
        return { provider: prov.id, model };
      }
    }
  } catch {}
  return { provider: "hf", model: defaultModelOf(PROVIDERS[0]) };
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
  // "entered" survives reloads for free-mode users too (not only key holders).
  const [entered, setEnteredState] = useState(() => !!localStorage.getItem(KEY_LS) || localStorage.getItem("moldable_entered") === "1");
  const setEntered = (v: boolean) => {
    if (v) localStorage.setItem("moldable_entered", "1");
    setEnteredState(v);
  };
  const [printer, setPrinter] = useState<PrinterDefaults>(loadPrinter);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(loadProviderKeys);
  const [proxyBase, setProxyBase] = useState(() => localStorage.getItem(PROXY_LS) ?? "");
  // Hosted site: fall back to the built-in Supabase relay so Tripo/Meshy/fal work
  // out of the box. Locally the Vite dev relay is used; a user-set URL wins.
  const effectiveProxy = proxyBase || (import.meta.env.DEV ? "" : DEFAULT_RELAY);
  const [genEng, setGenEng] = useState(loadGenEng);
  const [llm, setLlm] = useState<LlmSettings>(loadLlm);
  const [llmKeys, setLlmKeys] = useState<Record<string, string>>(loadLlmKeys);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [settingsPane, setSettingsPane] = useState<"ai" | "mesh" | "printer" | "sync">("ai");
  useEffect(() => {
    void cloudUser().then((u) => setAccountEmail(u?.email ?? null)).catch(() => {});
    let unsub: (() => void) | undefined;
    void onAuthChange((em) => setAccountEmail(em)).then((u) => (unsub = u)).catch(() => {});
    return () => unsub?.();
  }, []);

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
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinText, setPinText] = useState("");

  const [mode, setMode] = useState<Mode>("precise");
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);

  const [tab, setTab] = useState<"3d" | "code" | "params" | "print" | "history">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("moldable_theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("moldable_theme", theme);
  }, [theme]);
  const [units, setUnitsState] = useState<"mm" | "in">(() => (localStorage.getItem("moldable_units") === "in" ? "in" : "mm"));
  const setUnits = (f: (u: "mm" | "in") => "mm" | "in") =>
    setUnitsState((u) => {
      const next = f(u);
      localStorage.setItem("moldable_units", next);
      return next;
    });
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

  // ---- chat memory: every message is saved into the project, continuously ----
  const projectRef = useRef<Project | null>(null);
  const importFileRef = useRef<Blob | null>(null); // the live STEP behind the code's `imported` arg
  projectRef.current = project;
  useEffect(() => {
    if (messages.length === 0 && pins.length === 0) return;
    const t = setTimeout(() => {
      const chat = messages
        .filter((m) => !m.streaming)
        .map((m) => ({ role: m.role, text: m.text, error: m.error, image: m.image }));
      const pr = projectRef.current;
      if (pr) {
        const next = { ...pr, chat, pins, updatedAt: Date.now() };
        projectRef.current = next;
        setProject(next);
        void putProject(next);
      } else {
        // No project yet (e.g. every attempt failed) — create a shell so the
        // conversation itself survives reloads and appears in the Library.
        const firstUser = messages.find((m) => m.role === "user");
        const shell = { ...newProject(deriveName(firstUser?.text ?? "Chat"), "replicad"), chat, pins };
        projectRef.current = shell;
        persist(shell);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [messages, pins]);

  // ---- finish an OAuth / magic-link return (?code=...) and greet the user ----
  useEffect(() => {
    if (!hasAuthReturn()) return;
    void completeAuthReturn().then((u) => {
      if (u) {
        setEntered(true);
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Signed in as ${u.email} — your settings and projects can now sync (Settings → Sync).` }]);
      }
    });
  }, []);

  // ---- session memory: reopen the last project (chat + model) after a reload ----
  useEffect(() => {
    if (project?.id) localStorage.setItem("moldable_last_project", project.id);
  }, [project?.id]);
  // Land on a FRESH start screen; offer the last session as a one-tap resume
  // chip instead of auto-opening it (auto-open replayed stale errors on load).
  const [resume, setResume] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    const id = localStorage.getItem("moldable_last_project");
    if (!id) return;
    void getProject(id).then((p) => {
      if (p) setResume({ id: p.id, name: p.name });
    });
  }, []);
  async function resumeLast() {
    if (!resume) return;
    const p = await getProject(resume.id);
    setResume(null);
    if (p) await openProjectById(p);
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
    // 3D files import directly instead of becoming a reference photo.
    if (/\.(glb|gltf|stl|step|stp|shapr)$/i.test(file.name)) {
      void importModelFile(file);
      return;
    }
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

  // Paste an image straight from the clipboard (screenshot, copied file) anywhere
  // in the app — routes exactly like an upload.
  useEffect(() => {
    if (!entered) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            pickImage(f);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // pickImage closes over current mode/llm/keys; re-bind when those change.
  }, [entered, mode, llm, key, llmKeys, image]);

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
      importFile: res.source.kind === "code" ? importFileRef.current ?? undefined : undefined,
      spec: res.source.kind === "spec" ? res.source.spec : undefined,
      dims: res.dims,
      glb: res.glb,
      genSource: res.source.kind === "gen" ? { provider: res.source.provider, model: res.source.model, prompt: res.source.prompt } : undefined,
    });
    // Chat is synced separately (continuous effect) — keep whatever is there.
    snap.chat = projectRef.current?.chat ?? base.chat;
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
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Those values don't build: " + String(err?.message ?? err), error: true }]);
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
          text: `Repaired the mesh: ${out.holesFilled} hole(s) filled, ${out.degenerateRemoved} bad triangle(s) removed, open edges ${out.boundaryEdgesBefore} → ${out.boundaryEdgesAfter}${out.flippedWinding ? ", surface flipped right-side-out" : ""}. Exports now use the repaired mesh.`,
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Repair failed: " + String(err?.message ?? err), error: true }]);
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
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't prepare the file: " + String(err?.message ?? err), error: true }]);
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
    const { geometry: g, dims: d } = await loadAnyMesh(glb);
    applyResultNoCommit({ kind: "generative", geometry: g, dims: d, source, supportsStep: false, glb });
  }

  /** Import a 3D file directly. STEP/STP → a live, AI-editable CAD solid;
   *  GLB/STL → the mesh pipeline (measure/repair/export). */
  async function importModelFile(f: File) {
    if (status === "generating") return;

    if (/\.shapr$/i.test(f.name)) {
      setMessages((m) => [
        ...m,
        { id: mid(), role: "assistant", text: "Shapr3D's native .shapr format is proprietary and can't be read here. In Shapr3D: Export → STEP, then drop that file in — it imports as a fully editable CAD solid.", error: true },
      ]);
      return;
    }

    if (/\.(step|stp)$/i.test(f.name)) {
      if (!sel) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "The CAD engine is still starting — try the import again in a few seconds." }]);
        return;
      }
      if (sel.kind !== "replicad" || !sel.engine.setImport) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "STEP import needs the OpenCascade engine, which failed to boot on this device (the app fell back to the primitive engine).", error: true }]);
        return;
      }
      setStatus("generating");
      try {
        await sel.engine.setImport(f);
        importFileRef.current = f;
        const res = await sel.engine.build({ kind: "code", code: IMPORT_PASSTHROUGH, params: {} });
        const cleanName = f.name.replace(/\.(step|stp)$/i, "");
        applyResult(res, cleanName, `Imported ${f.name} — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`, `import ${f.name}`);
        seedHistory("replicad", IMPORT_PASSTHROUGH, undefined);
        setMode("precise");
        setMessages((m) => [
          ...m,
          {
            id: mid(),
            role: "assistant",
            text: `Imported ${f.name} as an editable CAD solid (${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm). Tell me what to change — “add two 5 mm mounting holes”, “fillet all edges 2 mm”, “cut a 20 mm slot through the middle” — or edit the code in Source. Exports (including STEP) stay editable.`,
          },
        ]);
      } catch (err: any) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't read that STEP file: " + String(err?.message ?? err), error: true }]);
      } finally {
        setStatus("idle");
      }
      return;
    }

    setStatus("generating");
    try {
      const { geometry: g, dims: d } = await loadAnyMesh(f);
      const cleanName = f.name.replace(/\.(glb|gltf|stl)$/i, "");
      const res: EngineResult = {
        kind: "generative",
        geometry: g,
        dims: d,
        source: { kind: "gen", provider: "import", model: f.name },
        supportsStep: false,
        glb: f,
      };
      applyResult(res, cleanName, `Imported ${f.name} — ${d.x} × ${d.y} × ${d.z} mm`, `import ${f.name}`);
      setMessages((m) => [
        ...m,
        { id: mid(), role: "assistant", text: `Imported ${f.name} (${d.x} × ${d.y} × ${d.z} mm). Measure it, run Printability/repair, resize, and export or send to your slicer — like any generated model.` },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't read that 3D file: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  // ---------------- pins: spatial notes & targeted AI edits ----------------
  function faceName(p: Pin): string {
    const ax = Math.abs(p.nx), ay = Math.abs(p.ny), az = Math.abs(p.nz);
    if (az >= ax && az >= ay) return p.nz >= 0 ? "top" : "bottom";
    if (ay >= ax) return p.ny >= 0 ? "back" : "front";
    return p.nx >= 0 ? "right" : "left";
  }
  const activePin = (() => {
    const i = pins.findIndex((x) => x.id === activePinId);
    return i >= 0 ? { pin: pins[i], index: i, face: faceName(pins[i]) } : null;
  })();
  function pickPin(pt: PickedPoint) {
    const pin: Pin = { id: uid(), ...pt, text: "" };
    setPins((ps) => [...ps, pin]);
    setActivePinId(pin.id);
    setPinText("");
  }
  function selectPin(id: string) {
    setActivePinId(id);
    setPinText(pins.find((x) => x.id === id)?.text ?? "");
  }
  function savePinNote() {
    setPins((ps) => ps.map((x) => (x.id === activePinId ? { ...x, text: pinText.trim() } : x)));
  }
  function deletePin() {
    setPins((ps) => ps.filter((x) => x.id !== activePinId));
    setActivePinId(null);
    setPinText("");
  }
  function askAiPin() {
    if (!activePin || !pinText.trim()) return;
    const { pin, index, face } = activePin;
    savePinNote();
    setActivePinId(null);
    setPinMode(false);
    void send(
      `At the pinned spot #${index + 1} — x=${pin.x} mm, y=${pin.y} mm, z=${pin.z} mm, on the ${face}-facing surface of the current model: ${pinText.trim()}`,
      "precise",
    );
    setPinText("");
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
            // Transient escalation for THIS text prompt only — do NOT persist, or a
            // photo later would be stuck on the heavy text model instead of the
            // user's light image default.
            genModel = textModel.id;
            switchedTo = textModel.label;
          } else {
            setMessages((m) => [
              ...m,
              {
                id: mid(),
                role: "assistant",
                text: `${prov.label}'s models here are image-only. Attach a photo, or pick a text-capable engine in Settings → Mesh model — Hugging Face (Hunyuan3D-2), Meshy, Tripo and fal (Rodin) all do text → 3D.`,
                error: true,
              },
            ]);
            return;
          }
        }
      }

      setInput("");
      const genThumb = image ? await blobToDataURL(image.blob) : undefined;
      setMessages((m) => [...m, { id: mid(), role: "user", text: p || (image ? "Reference image" : ""), image: genThumb }]);
      const ph = mid();
      setMessages((m) => [
        ...m,
        { id: ph, role: "assistant", text: switchedTo ? `Switched to ${switchedTo} — it supports text → 3D. Preparing…` : "Preparing…", streaming: true },
      ]);
      setStatus("generating");

      genEngine.current.config = { keyFor: (id) => providerKeys[id] || undefined, proxyBase: effectiveProxy };
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
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: friendlyNet(String(err?.message ?? err)), error: true, streaming: false } : x)));
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
    const visionThumb = visionImage ? await blobToDataURL(visionImage.blob) : undefined;
    setInput("");
    setStreamingText("");
    setMessages((m) => [...m, { id: mid(), role: "user", text: p || (visionImage ? "Recreate this part" : ""), image: visionThumb }]);
    const placeholderId = mid();
    setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "Thinking…", streaming: true }]);
    setStatus("generating");

    const system = (kind === "replicad" ? REPLICAD_SYSTEM_PROMPT : FALLBACK_JSON_PROMPT) + (visionImage ? VISION_ADDENDUM : "") + (importFileRef.current ? IMPORT_ADDENDUM : "");
    const userMsg: ApiMsg = visionImage
      ? {
          role: "user",
          content: [
            { type: "image", mediaType: visionImage.blob.type || "image/png", dataBase64: visionThumb!.split(",")[1] },
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
        const raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system, history, { onToken: (_t, full) => setStreamingText(full) }, effectiveProxy);
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
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: friendlyNet(String(err?.message ?? err)), error: true, streaming: false } : x)));
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
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: String(err?.message ?? err), error: true }]);
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
    setStatus("generating"); // drives the elapsed-time pill
    try {
      const bi: BuildInput = s.kind === "replicad" ? { kind: "code", code: EXAMPLE_REPLICAD } : { kind: "spec", spec: EXAMPLE_SPEC };
      const res = await s.engine.build(bi);
      applyResult(res, "Example L-bracket", EXAMPLE_SPEC.summary ?? "Example model.", "Show me the example");
      setMessages([{ id: mid(), role: "assistant", text: EXAMPLE_SPEC.summary ?? "Loaded the example L-bracket." }]);
    } catch (err: any) {
      setMessages([{ id: mid(), role: "assistant", text: "Couldn't build the example: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
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
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Export failed: " + String(err?.message ?? err), error: true }]);
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
        if (sel.engine.setImport) {
          await sel.engine.setImport(next.importFile ?? null);
          importFileRef.current = next.importFile ?? null;
        }
        const bi: BuildInput =
          next.engine === "replicad"
            ? { kind: "code", code: next.code ?? "", params: next.params }
            : { kind: "spec", spec: parseSpec(JSON.stringify(next.spec)) };
        applyResultNoCommit(await sel.engine.build(bi));
      }
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restored an earlier version." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restore failed to rebuild: " + String(err?.message ?? err), error: true }]);
    }
  }

  async function openProjectById(p: Project) {
    setShowLibrary(false);
    setProject(p);
    setMessages((p.chat ?? []).map((c) => ({ id: mid(), role: c.role, text: c.text, error: c.error, image: c.image })));
    setPins(p.pins ?? []);
    setActivePinId(null);
    seedHistory(p.engine, p.code, p.spec);
    clearImage();
    setMode(p.engine === "generative" ? "generative" : "precise");
    try {
      if (p.engine === "generative" && p.glb) {
        await showFromGlb(p.glb, { kind: "gen", provider: p.genSource?.provider ?? "", model: p.genSource?.model ?? "", prompt: p.genSource?.prompt });
      } else if (sel) {
        if (sel.engine.setImport) {
          await sel.engine.setImport(p.importFile ?? null);
          importFileRef.current = p.importFile ?? null;
        }
        const bi: BuildInput =
          p.engine === "replicad" ? { kind: "code", code: p.code ?? "", params: p.params } : { kind: "spec", spec: parseSpec(JSON.stringify(p.spec)) };
        applyResultNoCommit(await sel.engine.build(bi));
      }
    } catch {
      /* leave viewer empty if HEAD doesn't rebuild */
    }
  }

  function startNew() {
    localStorage.removeItem("moldable_last_project");
    projectRef.current = null;
    setPins([]);
    setActivePinId(null);
    setPinMode(false);
    importFileRef.current = null;
    void sel?.engine.setImport?.(null);
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
        accountEmail={accountEmail}
        theme={theme}
        onToggleTheme={() => setThemeState((t) => (t === "dark" ? "light" : "dark"))}
        onOpenProfile={() => {
          setSettingsPane("sync");
          setShowSettings(true);
        }}
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
        resume={project ? null : resume?.name ?? null}
        onResume={() => void resumeLast()}
        geometry={geometry}
        dims={dims}
        report={report}
        wireframe={wireframe}
        setWireframe={setWireframe}
        showDims={showDims}
        setShowDims={setShowDims}
        units={units}
        setUnits={setUnits}
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
        onOpenSettings={() => { setSettingsPane("ai"); setShowSettings(true); }}
        onOpenLibrary={() => setShowLibrary(true)}
        onNew={startNew}
        pins={pins}
        pinCtl={{
          mode: pinMode,
          toggleMode: () => setPinMode((m) => !m),
          active: activePin,
          text: pinText,
          setText: setPinText,
          askAi: askAiPin,
          saveNote: savePinNote,
          del: deletePin,
          close: () => setActivePinId(null),
          pick: pickPin,
          select: selectPin,
        }}
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
          initialPane={settingsPane}
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
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);

  async function auth(op: "github" | "google" | "magic") {
    setBusy(true);
    setErr(false);
    setMsg(op === "magic" ? "Sending your login link…" : `Taking you to ${op === "github" ? "GitHub" : "Google"}…`);
    try {
      if (op === "magic") setMsg(await cloudMagicLink(email.trim()));
      else await cloudOAuth(op); // navigates away on success
    } catch (e: any) {
      setErr(true);
      const raw = String(e?.message ?? e);
      setMsg(
        /provider is not enabled|unsupported provider|validation_failed/i.test(raw)
          ? "This provider isn't switched on yet (one-time setup in docs/SOCIAL_LOGIN.md) — use the email login link instead."
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="card">
        <div className="brand big">
          <CubeMark />
          <span className="wordmark">Moldable</span>
        </div>
        <h1>Turn a description — or a photo — into a 3D-printable model.</h1>
        <button className="primary block" onClick={onFree}>Start free — no account needed</button>
        <p className="fine">Free photo/text → 3D via Hugging Face, free CAD via Gemini. Everything stays in this browser.</p>

        <div className="sect-label">Sign in — sync your projects &amp; keys across devices</div>
        {msg && <div className={`sync-status${err ? " err" : ""}`} role="status">{msg}</div>}
        <div className="social-col">
          <button className="ghost block social" disabled={busy} onClick={() => auth("github")}>
            <IconGitHub /> Continue with GitHub
          </button>
          <button className="ghost block social" disabled={busy} onClick={() => auth("google")}>
            <IconGoogle /> Continue with Google
          </button>
        </div>
        <div className="magicrow">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <button className="ghost" disabled={busy || !email.includes("@")} onClick={() => auth("magic")}>Email me a login link</button>
        </div>

        <details className="adv">
          <summary>Advanced — add an Anthropic key now (best CAD quality)</summary>
          <label>Anthropic API key — exact parts, editable STEP export</label>
          <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
          <label>Model</label>
          <select value={m} onChange={(e) => setM(e.target.value)}>
            {MODELS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}{x.recommended ? " · recommended" : ""}</option>
            ))}
          </select>
          <button className="ghost block" disabled={!k.trim()} onClick={() => onContinue(k, m)}>Continue with my key</button>
          <p className="fine">No Anthropic key? Precise mode also works with a <b>free Google Gemini key</b>, OpenAI, Groq, or local Ollama — set it up later in Settings.</p>
        </details>
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
  initialPane,
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
  initialPane?: "ai" | "mesh" | "printer" | "sync";
  onClose: () => void;
}) {
  const [pane, setPane] = useState<"ai" | "mesh" | "printer" | "sync">(initialPane ?? "ai");
  const [passphrase, setPassphrase] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  // Cloud account (email + password; sync payloads are client-side encrypted)
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [syncErr, setSyncErr] = useState(false);
  useEffect(() => {
    void cloudUser().then((u) => setCloudEmail(u?.email ?? null)).catch(() => {});
    let unsub: (() => void) | undefined;
    void onAuthChange((em) => setCloudEmail(em)).then((u) => (unsub = u)).catch(() => {});
    return () => unsub?.();
  }, []);
  function friendlyAuthError(raw: string): string {
    if (/provider is not enabled|unsupported provider|validation_failed/i.test(raw))
      return "This login provider needs a one-time enable in the Supabase dashboard (2 minutes) — steps are in docs/SOCIAL_LOGIN.md on GitHub. Until then, use “Email me a login link” below.";
    if (/email not confirmed/i.test(raw)) return "Almost there — open the confirmation email we sent (check spam) and click the link, then press Sign in again.";
    if (/after \d+ seconds|rate limit/i.test(raw)) return "Too many attempts — wait a minute, then try once.";
    if (/already registered/i.test(raw)) return "This email already has an account — press Sign in instead.";
    if (/invalid login credentials/i.test(raw)) return "Wrong email or password.";
    if (/failed to fetch|network/i.test(raw)) return "Couldn't reach the sync server — check your connection and any ad-blocker (allow supabase.co).";
    return raw;
  }
  async function doCloud(op: "signup" | "signin" | "signout" | "push" | "pull" | "github" | "google" | "magic") {
    setCloudBusy(true);
    setSyncErr(false);
    setSyncMsg(
      op === "signup" ? "Creating your account…"
      : op === "signin" ? "Signing in…"
      : op === "github" || op === "google" ? `Taking you to ${op === "github" ? "GitHub" : "Google"}…`
      : op === "magic" ? "Sending your login link…"
      : op === "push" ? "Encrypting & uploading…"
      : op === "pull" ? "Downloading & decrypting…"
      : "",
    );
    try {
      if (op === "github" || op === "google") await cloudOAuth(op); // navigates away on success
      if (op === "magic") setSyncMsg(await cloudMagicLink(email.trim()));
      if (op === "signup") setSyncMsg(await cloudSignUp(email.trim(), pw));
      if (op === "signin") {
        await cloudSignIn(email.trim(), pw);
        setSyncMsg("Signed in — now set your sync passphrase above and press Push to cloud.");
      }
      if (op === "signout") {
        await cloudSignOut();
        setSyncMsg("Signed out.");
      }
      if (op === "push") setSyncMsg(await cloudPush(passphrase));
      if (op === "pull") {
        const msg = await cloudPull(passphrase);
        setSyncMsg(msg);
        if (msg.startsWith("Restored")) setTimeout(() => window.location.reload(), 1200);
      }
      const u = await cloudUser();
      setCloudEmail(u?.email ?? null);
    } catch (e: any) {
      setSyncErr(true);
      setSyncMsg(friendlyAuthError(String(e?.message ?? e)));
    } finally {
      setCloudBusy(false);
    }
  }

  async function doExport() {
    try {
      const blob = await exportSettings(passphrase);
      downloadBlob(blob, "moldable-settings.json");
      setSyncErr(false);
      setSyncMsg("Backup downloaded — keep it (and your passphrase) somewhere safe.");
    } catch (e: any) {
      setSyncErr(true);
      setSyncMsg(String(e?.message ?? e));
    }
  }
  async function doImport(file: File) {
    try {
      const n = await importSettings(file, passphrase);
      setSyncErr(false);
      setSyncMsg(`Restored ${n} settings — reloading…`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e: any) {
      setSyncErr(true);
      setSyncMsg(String(e?.message ?? e));
    }
  }

  // AI brain (Precise mode)
  const [k, setK] = useState(initialKey);
  const [m, setM] = useState(initialModel);
  const [lp, setLp] = useState<LlmProviderId>(llm.provider);
  const [lmodel, setLmodel] = useState(llm.provider === "anthropic" ? "" : llm.model);
  const [lbase, setLbase] = useState(llm.baseUrl ?? "");
  const [lkeys, setLkeys] = useState<Record<string, string>>(llmKeys);
  const lpre = llmPreset(lp);

  // 3D engine (Generative mode)
  const [keys, setKeys] = useState<Record<string, string>>(providerKeys);
  const [gp, setGp] = useState(genProvider);
  const [gm, setGm] = useState(genModel);
  const [proxy, setProxy] = useState(proxyBase);
  const prov = getProvider(gp) ?? PROVIDERS[0];

  // Printer
  const [bed, setBed] = useState(printer.bed);
  const [oh, setOh] = useState(printer.overhangThresholdDeg);
  const [preset, setPreset] = useState(printer.name ?? "custom");

  function saveAll() {
    if (lp === "anthropic") {
      onSaveLlm({ provider: "anthropic", model: m }, lkeys);
      onSaveKey(k, m);
    } else {
      onSaveLlm(
        { provider: lp, model: (lmodel || lpre.defaultModel).trim(), baseUrl: lp === "custom" ? lbase.trim() : undefined },
        lkeys,
      );
    }
    onSaveGen(keys, gp, gm, proxy.trim());
    onSavePrinter({ bed, overhangThresholdDeg: oh, name: preset === "custom" ? undefined : preset });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Settings</h2>
          <button className="x" aria-label="Close settings" onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="seg stabs">
          {(["ai", "mesh", "printer", "sync"] as const).map((t) => (
            <button key={t} className={pane === t ? "on" : ""} onClick={() => setPane(t)}>
              {t === "ai" ? "AI brain" : t === "mesh" ? "3D engine" : t === "printer" ? "Printer" : "Sync"}
            </button>
          ))}
        </div>

        {pane === "ai" && (
          <>
            <p className="pane-desc">Writes the CAD code in <b>Precise</b> mode. Gemini and Groq have free tiers; Claude gives the best quality.</p>
            <label>Provider</label>
            <select
              value={lp}
              onChange={(e) => {
                const np = e.target.value as LlmProviderId;
                setLp(np);
                setLmodel(np === "anthropic" ? "" : llmPreset(np).defaultModel);
              }}
            >
              {LLM_PRESETS.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.label}{pr.free ? " · free" : ""}{pr.recommended ? " · recommended" : ""}</option>
              ))}
            </select>
            {lp === "anthropic" ? (
              <>
                <label>Anthropic API key</label>
                <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
                <label>Claude model</label>
                <select value={m} onChange={(e) => setM(e.target.value)}>
                  {MODELS.map((x) => (
                    <option key={x.id} value={x.id}>{x.label}{x.recommended ? " · recommended" : ""}</option>
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
                      placeholder="paste your key…"
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
          </>
        )}

        {pane === "mesh" && (
          <>
            <p className="pane-desc">Turns a photo or text into a mesh in <b>Generative</b> mode. Hugging Face is free.</p>
            <label>Engine</label>
            <select
              value={gp}
              onChange={(e) => {
                const np = e.target.value;
                setGp(np);
                setGm(getProvider(np)?.models[0].id ?? "");
              }}
            >
              {PROVIDERS.map((pp) => (
                <option key={pp.id} value={pp.id}>{pp.label}{pp.free ? " · free" : ""}{pp.recommended ? " · recommended" : ""}</option>
              ))}
            </select>
            <label>Model — “image or text” models can generate from a prompt alone</label>
            <select value={gm} onChange={(e) => setGm(e.target.value)}>
              {prov.models.map((mm) => (
                <option key={mm.id} value={mm.id}>{mm.label}{mm.recommended ? " · recommended" : ""}</option>
              ))}
            </select>
            <label>
              {prov.label.split(" (")[0]} key
              {prov.needsKey ? "" : " — optional but recommended (5× the free GPU quota)"}
            </label>
            <input
              type="password"
              value={keys[gp] ?? ""}
              onChange={(e) => setKeys({ ...keys, [gp]: e.target.value })}
              placeholder={prov.needsKey ? "paste your key…" : "hf_…"}
            />
            <p className="fine">{prov.keyHint}</p>
            <details className="adv">
              <summary>Advanced — relay (a built-in one is already configured)</summary>
              <label>Proxy base URL — leave blank to use the built-in relay</label>
              <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="blank = built-in relay" />
              <p className="fine">
                Tripo/Meshy/fal/Replicate now work on the hosted site out of the box through a built-in relay. Paste your own relay URL here
                only if you want to self-host one (guide: <b>proxy/DEPLOY.md</b> in the repo).
              </p>
            </details>
          </>
        )}

        {pane === "printer" && (
          <>
            <p className="pane-desc">Used by the bed-fit check and the Printability report.</p>
            <label>Printer — picking one fills the bed size below</label>
            <select
              value={preset}
              onChange={(e) => {
                const v = e.target.value;
                setPreset(v);
                const pr = PRINTERS.find((x) => printerKey(x) === v);
                if (pr) setBed({ x: pr.x, y: pr.y, z: pr.z });
              }}
            >
              <option value="custom">Custom / other</option>
              {PRINTER_BRANDS.map((b) => (
                <optgroup key={b} label={b}>
                  {PRINTERS.filter((x) => x.brand === b).map((x) => (
                    <option key={printerKey(x)} value={printerKey(x)}>
                      {x.model} — {x.x}×{x.y}×{x.z} mm{x.kind === "Resin" ? " · resin" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label>Bed size (mm): width × depth × height</label>
            <div className="row3">
              <input type="number" value={bed.x} onChange={(e) => { setBed({ ...bed, x: +e.target.value }); setPreset("custom"); }} />
              <input type="number" value={bed.y} onChange={(e) => { setBed({ ...bed, y: +e.target.value }); setPreset("custom"); }} />
              <input type="number" value={bed.z} onChange={(e) => { setBed({ ...bed, z: +e.target.value }); setPreset("custom"); }} />
            </div>
            <label>Overhang warning threshold (°)</label>
            <input type="number" value={oh} onChange={(e) => setOh(+e.target.value)} />
            <p className="fine">45° is the standard FDM rule of thumb; raise it for PLA, lower for ABS.</p>
          </>
        )}

        {pane === "sync" && (
          <>
            <p className="pane-desc">
              Access your setup and chats from any computer. Everything synced is <b>encrypted in your browser with a passphrase you choose</b> —
              the server only ever stores unreadable ciphertext. Meshes stay on each device (they're big); code, chats and settings sync.
            </p>
            <label>Sync passphrase (needed on every device — like a PIN, longer is safer)</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="choose a passphrase you'll remember"
            />

            <div className="sect-label">Cloud account</div>
            {syncMsg && <div className={`sync-status${syncErr ? " err" : ""}`} role="status">{syncMsg}</div>}
            {cloudEmail ? (
              <>
                <p className="fine">Signed in as <b>{cloudEmail}</b></p>
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy || passphrase.length < 4} onClick={() => doCloud("push")}>Push to cloud</button>
                  <button className="ghost sm" disabled={cloudBusy || passphrase.length < 4} onClick={() => doCloud("pull")}>Pull to this device</button>
                  <button className="ghost sm" disabled={cloudBusy} onClick={() => doCloud("signout")}>Sign out</button>
                </div>
              </>
            ) : (
              <>
                <div className="social-col">
                  <button className="ghost block social" disabled={cloudBusy} onClick={() => doCloud("github")}>
                    <IconGitHub /> Continue with GitHub
                  </button>
                  <button className="ghost block social" disabled={cloudBusy} onClick={() => doCloud("google")}>
                    <IconGoogle /> Continue with Google
                  </button>
                </div>
                <label>Or use your email — no password needed</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy || !email.includes("@")} onClick={() => doCloud("magic")}>Email me a login link</button>
                </div>
                <details className="adv">
                  <summary>Use a password instead</summary>
                  <label>Password</label>
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="account password" />
                  <div className="param-actions">
                    <button className="primary sm" disabled={cloudBusy || !email.includes("@") || pw.length < 6} onClick={() => doCloud("signin")}>Sign in</button>
                    <button className="ghost sm" disabled={cloudBusy || !email.includes("@") || pw.length < 6} onClick={() => doCloud("signup")}>Create account</button>
                  </div>
                </details>
              </>
            )}

            <div className="sect-label">Offline backup (no account)</div>
            <div className="param-actions">
              <button className="primary sm" disabled={passphrase.length < 4} onClick={doExport}>Download encrypted backup</button>
              <button className="ghost sm" disabled={passphrase.length < 4} onClick={() => importRef.current?.click()}>Restore from backup…</button>
            </div>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.currentTarget.value = "";
              }}
            />
            <p className="fine">On the other computer: open this same site → Settings → Sync → Restore, pick the file, enter the same passphrase.</p>
          </>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={saveAll}>Save all</button>
        </div>
        <p className="fine center">Everything stays in this browser unless you use Sync — and synced data is encrypted with your passphrase first.</p>
      </div>
    </div>
  );
}
