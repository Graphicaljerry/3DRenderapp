import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Workspace } from "./components/Workspace";
import { LibraryModal } from "./components/LibraryModal";
import { MeasureModal } from "./components/MeasureModal";
import { ExtrudeModal, type SvgMode, type SvgParams } from "./components/ExtrudeModal";
import { extrudeSvg, revolveSvg, embossSvg } from "./svg/extrude";
import { geometryToSTL } from "./print/exportClient";
import type { ViewerHandle } from "./components/Viewer";
import { getEngineSelection, type EngineSelection } from "./engine/selectEngine";
import { GenerativeEngine } from "./engine/generativeEngine";
import type { BuildInput, EngineResult, ExportFormat } from "./engine/types";
import { MODELS, type ApiMsg } from "./llm/anthropic";
import { LLM_PRESETS, llmPreset, llmReady, generateLlm, type LlmSettings, type LlmProviderId } from "./llm/llm";
import { detectProductQuery, researchDimensions } from "./llm/research";
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, VISION_ADDENDUM, IMPORT_ADDENDUM, REPLACEMENT_ADDENDUM, fitDirective, FIT_CLEARANCE, type FitId, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { repairGeometry } from "./print/repair";
import { preflightExport, preflightSummary } from "./print/preflight";
import { simplifyGeometry } from "./print/simplify";
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
import { DEFAULT_RELAY, cloudUser, cloudSignUp, cloudSignIn, cloudSignOut, cloudSyncPush, cloudSyncPull, cloudOAuth, cloudMagicLink, onAuthChange, hasAuthReturn, completeAuthReturn } from "./lib/cloud";

export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; error?: boolean; streaming?: boolean; image?: string; mode?: Mode };
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
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "synced">("idle");

  // Debounced auto-push: any local change (project or settings) uploads shortly
  // after, but only while signed in.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSync = () => {
    if (!accountEmailRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      setSyncState("syncing");
      void cloudSyncPush()
        .then(() => setSyncState("synced"))
        .catch(() => setSyncState("idle"));
    }, 2500);
  };
  const accountEmailRef = useRef<string | null>(null);
  accountEmailRef.current = accountEmail;

  // Sign-in → pull the account's data once; reload only if it changed something.
  const pulledRef = useRef(false);
  async function pullOnSignIn() {
    if (pulledRef.current) return;
    pulledRef.current = true;
    try {
      const r = await cloudSyncPull();
      // Then contribute whatever this device already had before it signed in —
      // e.g. an API key entered while signed out. Sign-in used to only download,
      // so a key set before creating the account never reached the cloud and
      // never appeared on other devices. Pull-first means the cloud still wins on
      // conflicts; this push only adds the local-only settings/projects on top.
      await cloudSyncPush();
      setSyncState("synced");
      if (r && (r.settings > 0 || r.projects > 0)) setTimeout(() => window.location.reload(), 400);
    } catch {
      setSyncState("idle");
    }
  }

  useEffect(() => {
    void cloudUser().then((u) => {
      setAccountEmail(u?.email ?? null);
      if (u) void pullOnSignIn();
    }).catch(() => {});
    let unsub: (() => void) | undefined;
    void onAuthChange((em) => {
      setAccountEmail(em);
      if (em) void pullOnSignIn();
      else pulledRef.current = false;
    }).then((u) => (unsub = u)).catch(() => {});
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
  // Guided "fix a broken part" flow + FDM fit tolerance (applies to mating features).
  const [guided, setGuided] = useState(false);
  const [fit, setFit] = useState<FitId>("snug");
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
    scheduleSync(); // no-op until signed in (accountEmailRef guards it)
  }, [theme]);
  const [units, setUnitsState] = useState<"mm" | "in">(() => (localStorage.getItem("moldable_units") === "in" ? "in" : "mm"));
  const setUnits = (f: (u: "mm" | "in") => "mm" | "in") =>
    setUnitsState((u) => {
      const next = f(u);
      localStorage.setItem("moldable_units", next);
      scheduleSync();
      return next;
    });
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [svgDraft, setSvgDraft] = useState<{ text: string; url: string; name: string } | null>(null);
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
    scheduleSync();
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
        scheduleSync();
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

  // ---- library thumbnail: refresh the saved preview whenever the model settles ----
  // Debounced so a slider drag (many rebuilds/sec) writes at most one thumb, and
  // late enough that the Viewer has rendered + framed the new geometry.
  useEffect(() => {
    if (!geometry) return;
    const t = setTimeout(() => {
      const pr = projectRef.current;
      if (!pr) return;
      const thumb = viewer.current?.captureThumbnail();
      if (!thumb) return;
      const next = { ...pr, thumb, updatedAt: Date.now() };
      projectRef.current = next;
      setProject(next);
      void putProject(next);
      scheduleSync();
    }, 500);
    return () => clearTimeout(t);
  }, [geometry]);

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
    scheduleSync();
  }
  function savePrinter(p: PrinterDefaults) {
    localStorage.setItem(PRINTER_LS, JSON.stringify(p));
    setPrinter(p);
    scheduleSync();
  }
  function saveLlmSettings(s: LlmSettings, keys2: Record<string, string>) {
    localStorage.setItem(LLM_LS, JSON.stringify(s));
    localStorage.setItem(LLMKEYS_LS, JSON.stringify(keys2));
    setLlm(s);
    setLlmKeys(keys2);
    setEntered(true);
    setShowSettings(false);
    scheduleSync();
  }

  function saveGenSettings(keys: Record<string, string>, provider: string, gmodel: string, proxy: string) {
    localStorage.setItem(PKEYS_LS, JSON.stringify(keys));
    localStorage.setItem(GENENG_LS, JSON.stringify({ provider, model: gmodel }));
    localStorage.setItem(PROXY_LS, proxy);
    setProviderKeys(keys);
    setGenEng({ provider, model: gmodel });
    setProxyBase(proxy);
    scheduleSync();
  }

  // Quick model/engine switches from the in-chat picker (no keys touched — that
  // stays in Settings). Persist so the choice survives a reload, same as Settings.
  function pickBrain(provider: LlmProviderId, pickedModel: string) {
    if (provider === "anthropic") {
      const s: LlmSettings = { provider, model: pickedModel };
      localStorage.setItem(LLM_LS, JSON.stringify(s));
      localStorage.setItem(MODEL_LS, pickedModel);
      setLlm(s);
      setModel(pickedModel);
    } else {
      // Keep the user's configured model when they re-pick the same provider;
      // otherwise fall back to that provider's sensible default.
      const keepModel = llm.provider === provider ? llm.model : llmPreset(provider).defaultModel;
      const s: LlmSettings = { provider, model: keepModel, baseUrl: provider === "custom" ? llm.baseUrl : undefined };
      localStorage.setItem(LLM_LS, JSON.stringify(s));
      setLlm(s);
    }
    scheduleSync();
  }
  /** Re-run a chat message with a specific model (Perplexity-style). Persists the
   *  choice and passes it straight to send() so it takes effect immediately. */
  function retryWithModel(text: string, msgMode: Mode, value: string) {
    const i = value.indexOf("|");
    const prov = i < 0 ? value : value.slice(0, i);
    const mdl = i < 0 ? "" : value.slice(i + 1);
    if (msgMode === "generative") {
      pickEngine(prov, mdl);
      void send(text, "generative", { genEng: { provider: prov, model: mdl } });
    } else {
      pickBrain(prov as LlmProviderId, mdl);
      const overLlm: LlmSettings =
        prov === "anthropic"
          ? { provider: "anthropic", model: mdl }
          : { provider: prov as LlmProviderId, model: llm.provider === prov ? llm.model : llmPreset(prov as LlmProviderId).defaultModel, baseUrl: prov === "custom" ? llm.baseUrl : undefined };
      void send(text, "precise", { llm: overLlm });
    }
  }
  function pickEngine(provider: string, gmodel: string) {
    localStorage.setItem(GENENG_LS, JSON.stringify({ provider, model: gmodel }));
    setGenEng({ provider, model: gmodel });
    scheduleSync();
  }

  function pickImage(file: File) {
    // A flat SVG (a designer's native output) → extrude it into a solid.
    if (/\.svg$/i.test(file.name) || file.type === "image/svg+xml") {
      void file.text().then((text) => {
        if (svgDraft) URL.revokeObjectURL(svgDraft.url);
        setSvgDraft({ text, url: URL.createObjectURL(file), name: file.name.replace(/\.svg$/i, "") });
      });
      return;
    }
    // 3D files import directly instead of becoming a reference photo.
    if (/\.(glb|gltf|stl|step|stp|shapr)$/i.test(file.name)) {
      void importModelFile(file);
      return;
    }
    if (image) URL.revokeObjectURL(image.url);
    setImage({ blob: file, url: URL.createObjectURL(file) });
    // In Precise mode with a working AI provider, a photo means "recreate this part
    // as exact CAD" (vision). Otherwise route to the free generative mesh path —
    // but never override the guided replacement flow, which is explicitly precise
    // (the user gets prompted for a key on send if one's missing).
    const ready = llmReady(llm.provider === "anthropic" ? { ...llm, model } : llm, { anthropic: key, ...llmKeys });
    if (!guided && (mode !== "precise" || !ready)) setMode("generative");
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
    // pickImage closes over current mode/llm/keys/guided; re-bind when those change.
  }, [entered, mode, guided, llm, key, llmKeys, image]);

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

  /** Halve the triangle count — for slicers that stall on very heavy meshes.
   *  Click again to reduce further; the shape stays within ~1% of its extents. */
  async function simplifyMesh() {
    if (!result || result.kind === "replicad" || status === "generating") return;
    setStatus("generating");
    try {
      const out = await simplifyGeometry(result.geometry);
      applyResultNoCommit({ ...result, geometry: out.geometry, dims: out.dims });
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: `Simplified the model: ${out.trianglesBefore.toLocaleString()} → ${out.trianglesAfter.toLocaleString()} triangles (shape kept within ~1%). Exports use the simplified mesh — click again to halve it further.`,
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Simplify failed: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Export a 3MF and hand it to a desktop slicer (deep link locally; download on hosted). */
  async function openSlicer(target: SlicerTarget) {
    if (!result) return;
    const engine = result.kind === "generative" ? genEngine.current : sel?.engine;
    if (!engine) return;
    try {
      const pf = preflightExport(result, printer);
      if (pf.repaired) applyResultNoCommit(pf.result);
      const blob = await engine.export(pf.result, "3mf");
      const how = await openInSlicer(target, blob, safeFileName(project?.name ?? "model", "3mf"));
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text:
            (how === "deeplink"
              ? `Sent to ${target === "bambu" ? "Bambu Studio" : "OrcaSlicer"}. ${target === "bambu" ? "Bambu may ask “not from a trusted site — open anyway?” — that's expected for non-MakerWorld files; click yes." : ""} If nothing opened, the app may not be installed — a download works too.`
              : "Downloaded the 3MF — double-click it and it opens in your default slicer. (One-click send works when running locally with npm run dev.)") +
            " " + preflightSummary(pf),
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

  /** Turn the dropped SVG into a solid — extrude, revolve, or emboss. Persisted
   *  as an STL blob (Z-up mm), so it re-opens through the same path. */
  function createFromSvg(mode: SvgMode, prm: SvgParams) {
    if (!svgDraft) return;
    try {
      const out =
        mode === "revolve" ? revolveSvg(svgDraft.text, { sizeMm: prm.sizeMm })
        : mode === "emboss" ? embossSvg(svgDraft.text, { sizeMm: prm.sizeMm, baseMm: prm.baseMm, reliefMm: prm.reliefMm, recessed: prm.recessed })
        : extrudeSvg(svgDraft.text, { sizeMm: prm.sizeMm, heightMm: prm.heightMm });
      const { geometry, dims } = out;
      const verb = mode === "revolve" ? "Revolved" : mode === "emboss" ? "Embossed" : "Extruded";
      const res: EngineResult = {
        kind: "generative",
        geometry,
        dims,
        source: { kind: "gen", provider: "svg", model: svgDraft.name },
        supportsStep: false,
        glb: geometryToSTL(geometry), // STL bytes; loadAnyMesh sniffs STL when re-opening
      };
      applyResult(res, svgDraft.name, `${verb} ${svgDraft.name}.svg — ${dims.x} × ${dims.y} × ${dims.z} mm`, `svg ${svgDraft.name}`);
      setMode("generative");
      setMessages((m) => [
        ...m,
        { id: mid(), role: "assistant", text: `${verb} ${svgDraft.name}.svg to a solid (${dims.x} × ${dims.y} × ${dims.z} mm). Check Printability, then export — or drop the SVG again for a different result.` },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't build from that SVG: " + String(err?.message ?? err), error: true }]);
    } finally {
      if (svgDraft) URL.revokeObjectURL(svgDraft.url);
      setSvgDraft(null);
    }
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
    const { pin, face } = activePin;
    const note = pinText.trim();
    savePinNote();
    setActivePinId(null);
    setPinMode(false);
    // Give the model a directive, localized instruction (not just coordinates):
    // what to change, where, and to keep the rest of the part intact.
    const size = dims ? `The current part measures about ${dims.x} × ${dims.y} × ${dims.z} mm. ` : "";
    void send(
      `Modify the current CAD model: ${note}. ${size}` +
        `Apply this change at the marked spot — approximately x=${pin.x} mm, y=${pin.y} mm, z=${pin.z} mm, ` +
        `on the ${face}-facing surface (coordinates are Z-up, in millimetres). ` +
        `Leave the rest of the part unchanged and return the full updated code.`,
      "precise",
    );
    setPinText("");
  }

  // ---------------- generate ----------------
  /** Enter the guided "fix a broken part" flow: precise mode, a photo-first nudge,
   *  and a helper message with the coin/card-for-scale trick. */
  function startGuided() {
    setGuided(true);
    setMode("precise");
    setInput("");
    setMessages((m) => [
      ...m,
      {
        id: mid(),
        role: "assistant",
        text: "Let's recreate a part that fits. Upload a photo of the broken or original piece (the paperclip below), and tell me any measurements you know. No calipers? Put a coin or a credit card in the shot for scale and I'll work the sizes out. Then pick a Fit — snug is a good default.",
      },
    ]);
  }

  /** Change the FDM fit. If the current model already exposes a `clearance`
   *  parameter, re-fit live with no AI call; otherwise it applies to the next build. */
  function applyFit(next: FitId) {
    setFit(next);
    if (!result || result.source.kind !== "code") return;
    const key = Object.keys(cadDefaults ?? {}).find((k) => k.toLowerCase() === "clearance");
    if (key) void applyParams({ ...paramValues, [key]: FIT_CLEARANCE[next] });
  }

  async function send(promptText: string, forceMode?: Mode, override?: { llm?: LlmSettings; genEng?: { provider: string; model: string } }) {
    const p = promptText.trim();
    if (status === "generating") return;
    if (forceMode && forceMode !== mode) setMode(forceMode); // keep the UI switch in sync
    // The mode switch decides: Generative -> mesh provider; Precise + photo -> vision CAD.
    const useGen = (forceMode ?? mode) === "generative";

    if (useGen) {
      if (!p && !image) return;
      const ge = override?.genEng ?? genEng; // retry-with-model can override the engine
      const prov = getProvider(ge.provider);
      if (prov?.needsKey && !providerKeys[prov.id]) {
        setShowSettings(true);
        return;
      }

      // Text-only request on an image-only model? Auto-switch to a text-capable
      // model from the same provider instead of dead-ending the user in Settings.
      let genModel = ge.model;
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
      setMessages((m) => [...m, { id: mid(), role: "user", text: p || (image ? "Reference image" : ""), image: genThumb, mode: "generative" }]);
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
        const res = await genEngine.current.build({ kind: "gen", image: image?.blob, prompt: p || undefined, provider: ge.provider, model: genModel });
        const name = deriveName(p || "Photo model");
        const summary = `Generated a mesh — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm (${prov?.label ?? ge.provider})`;
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
    const effLlm: LlmSettings = override?.llm ?? (llm.provider === "anthropic" ? { ...llm, model } : llm); // retry-with-model override
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
    setMessages((m) => [...m, { id: mid(), role: "user", text: p || (visionImage ? "Recreate this part" : ""), image: visionThumb, mode: "precise" }]);
    const placeholderId = mid();
    setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "Thinking…", streaming: true }]);
    setStatus("generating");

    // Product research: when the request names a real-world product ("a case
    // for my iPhone 17 Pro"), look up its exact measurements on the web first
    // so the CAD code is built from real numbers instead of guesses. Runs via
    // Gemini's free search grounding or Claude's web-search tool; best-effort —
    // if neither key is set or the lookup fails, generation continues as before.
    let researched: string | null = null;
    // Look up real product dimensions for text requests, and — in the guided
    // replacement flow — even when a photo is attached, so a named product ("case
    // for an iPhone 17 Pro") gets web-accurate numbers alongside the picture.
    if (p && detectProductQuery(p) && (!visionImage || guided)) {
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "Researching the product's dimensions online…", streaming: true } : x)));
      researched = await researchDimensions(p, {
        geminiKey: llmKeys["gemini"],
        geminiModel: llm.provider === "gemini" ? llm.model : "",
        anthropicKey: key,
      });
      if (researched) {
        // Show the found measurements as their own note, above the working placeholder.
        setMessages((m) => {
          const idx = m.findIndex((x) => x.id === placeholderId);
          const note = { id: mid(), role: "assistant" as const, text: `Measurements found online:\n${researched}` };
          return idx < 0 ? [...m, note] : [...m.slice(0, idx), note, ...m.slice(idx)];
        });
      }
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "Thinking…", streaming: true } : x)));
    }
    // In the guided replacement flow, dial the requested FDM fit into the prompt so
    // mating features get real clearance (and a `clearance` param to tune live).
    // Researched dims + fit apply to BOTH the text and the vision message.
    const fitLine = guided ? fitDirective(fit) : "";
    const factsBlock = researched ? `\n\n[Product measurements researched online — treat as ground truth]\n${researched}` : "";
    const extras = factsBlock + fitLine;
    const pWithFacts = p + extras;

    const system =
      (kind === "replicad" ? REPLICAD_SYSTEM_PROMPT : FALLBACK_JSON_PROMPT) +
      (visionImage ? VISION_ADDENDUM : "") +
      (guided ? REPLACEMENT_ADDENDUM : "") +
      (importFileRef.current ? IMPORT_ADDENDUM : "");
    const userMsg: ApiMsg = visionImage
      ? {
          role: "user",
          content: [
            { type: "image", mediaType: visionImage.blob.type || "image/png", dataBase64: visionThumb!.split(",")[1] },
            { type: "text", text: (p || "Recreate this part as precise, printable CAD. Estimate dimensions from the photo.") + extras },
          ],
        }
      : { role: "user", content: pWithFacts };
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
    setGuided(false); // the example is an ordinary part, not a guided replacement
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
      // Print-ready by default: analyse, auto-repair meshes, sanity-check scale/bed.
      const pf = preflightExport(result, printer);
      if (pf.repaired) applyResultNoCommit(pf.result); // viewer + report show exactly what was exported
      const blob = await engine.export(pf.result, format);
      downloadBlob(blob, safeFileName(project?.name ?? "model", format));
      // STEP is a CAD hand-off, not a print file — skip the print-readiness line.
      if (format !== "step") {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Exported ${format.toUpperCase()}. ${preflightSummary(pf)}` }]);
      }
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
    setGuided(false); // guided is a per-session intent — don't leak it into another project
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
    setGuided(false);
    if (svgDraft) { URL.revokeObjectURL(svgDraft.url); setSvgDraft(null); }
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
        onSignOut={() => {
          void cloudSignOut().finally(() => {
            setAccountEmail(null);
            pulledRef.current = false;
            setMessages((mm) => [...mm, { id: mid(), role: "assistant", text: "Signed out. This device keeps its own copy; sign in anywhere to sync again." }]);
          });
        }}
        mode={mode}
        setMode={setMode}
        guided={guided}
        onStartGuided={startGuided}
        fit={fit}
        onFit={applyFit}
        brain={{ provider: llm.provider, model: llm.provider === "anthropic" ? model : llm.model }}
        hasBrainKey={(prov) => (prov === "anthropic" ? !!key : !llmPreset(prov).needsKey || !!llmKeys[prov])}
        onPickBrain={pickBrain}
        genProvider={genEng.provider}
        genModel={genEng.model}
        hasGenKey={(prov) => { const pr = getProvider(prov); return !pr?.needsKey || !!providerKeys[prov]; }}
        onPickEngine={pickEngine}
        imageUrl={image?.url ?? null}
        onPickImage={pickImage}
        onClearImage={clearImage}
        onMeasure={() => setShowMeasure(true)}
        messages={messages}
        status={status}
        input={input}
        setInput={setInput}
        onSend={send}
        onRetryModel={retryWithModel}
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
        onSimplify={simplifyMesh}
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
      {showMeasure && image && (
        <MeasureModal
          key={image.url} /* remount (reset scale/measures) if the reference image changes */
          imageUrl={image.url}
          onClose={() => setShowMeasure(false)}
          onApply={(text) => setInput((v) => (v.trim() ? `${v.trim()} ${text}` : text))}
        />
      )}
      {svgDraft && (
        <ExtrudeModal
          svgText={svgDraft.text}
          svgUrl={svgDraft.url}
          name={svgDraft.name}
          onCreate={createFromSvg}
          onClose={() => { URL.revokeObjectURL(svgDraft.url); setSvgDraft(null); }}
        />
      )}
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
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);

  async function auth(op: "github" | "google" | "magic" | "signup" | "signin") {
    setBusy(true);
    setErr(false);
    setMsg(
      op === "magic" ? "Sending your login link…"
      : op === "signup" ? "Creating your account…"
      : op === "signin" ? "Signing in…"
      : `Taking you to ${op === "github" ? "GitHub" : "Google"}…`,
    );
    try {
      if (op === "magic") setMsg(await cloudMagicLink(email.trim()));
      else if (op === "signup") setMsg(await cloudSignUp(email.trim(), pw));
      else if (op === "signin") {
        await cloudSignIn(email.trim(), pw);
        setMsg("Signed in — loading your projects…");
      } else await cloudOAuth(op); // navigates away on success
    } catch (e: any) {
      setErr(true);
      const raw = String(e?.message ?? e);
      setMsg(
        /provider is not enabled|unsupported provider|validation_failed/i.test(raw)
          ? "This provider isn't switched on yet (one-time setup in docs/SOCIAL_LOGIN.md) — use the email login link or a password instead."
          : /email not confirmed/i.test(raw) ? "Almost there — open the confirmation email (check spam) and click the link, then Sign in."
          : /already registered/i.test(raw) ? "This email already has an account — press Sign in."
          : /invalid login credentials/i.test(raw) ? "Wrong email or password."
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
          <summary>Or use a password</summary>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="at least 6 characters" />
          <div className="param-actions">
            <button className="primary sm" disabled={busy || !email.includes("@") || pw.length < 6} onClick={() => auth("signup")}>Create account</button>
            <button className="ghost sm" disabled={busy || !email.includes("@") || pw.length < 6} onClick={() => auth("signin")}>Sign in</button>
          </div>
        </details>

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
  async function doCloud(op: "signup" | "signin" | "signout" | "sync" | "github" | "google" | "magic") {
    setCloudBusy(true);
    setSyncErr(false);
    setSyncMsg(
      op === "signup" ? "Creating your account…"
      : op === "signin" ? "Signing in…"
      : op === "github" || op === "google" ? `Taking you to ${op === "github" ? "GitHub" : "Google"}…`
      : op === "magic" ? "Sending your login link…"
      : op === "sync" ? "Syncing…"
      : "",
    );
    try {
      if (op === "github" || op === "google") await cloudOAuth(op); // navigates away on success
      if (op === "magic") setSyncMsg(await cloudMagicLink(email.trim()));
      if (op === "signup") setSyncMsg(await cloudSignUp(email.trim(), pw));
      if (op === "signin") {
        await cloudSignIn(email.trim(), pw);
        setSyncMsg("Signed in — your projects, chats and settings now sync automatically.");
      }
      if (op === "signout") {
        await cloudSignOut();
        setSyncMsg("Signed out. This device keeps its own copy.");
      }
      if (op === "sync") {
        await cloudSyncPush();
        const r = await cloudSyncPull();
        setSyncMsg("Synced.");
        if (r && (r.settings > 0 || r.projects > 0)) setTimeout(() => window.location.reload(), 600);
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
            {lpre.hint && <p className="fine choice-hint">{lpre.hint}</p>}
            <details className="adv guide">
              <summary>Which one should I pick?</summary>
              <ul className="guide-list">
                <li><b>Most accurate</b> — Anthropic Claude Fable 5, about 10¢ per part. Dimensions, fits and threads come out right most often.</li>
                <li><b>Best free</b> — Google Gemini, about 1,500 requests a day at no cost.</li>
                <li><b>Also excellent</b> — OpenAI GPT-5.1 (~1-2¢ per part) and Claude Sonnet 5 (~3¢), just behind.</li>
                <li><b>Cheapest paid</b> — Claude Haiku 4.5, about 1¢ per part.</li>
                <li><b>Fastest / most private</b> — Groq (free tier) / Ollama (free, runs on your machine).</li>
              </ul>
              <p className="fine">Tip: name a real product — "a case for my iPhone 17 Pro" — and Moldable first looks up its exact dimensions online (via Gemini's free search grounding, or Claude's web search at ~1¢ a lookup).</p>
            </details>
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
            <p className="pane-desc">Turns a photo or text into a mesh in <b>Generative</b> mode. Hugging Face is free; fal's Hunyuan 3D v3.1 Pro ($0.375 per model) is the most accurate.</p>
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
            {prov.hint && <p className="fine choice-hint">{prov.hint}</p>}
            <details className="adv guide">
              <summary>Which one should I pick?</summary>
              <ul className="guide-list">
                <li><b>Most accurate</b> — fal · Hunyuan 3D v3.1 Pro, $0.375 per model. Finest detail, cleanest surfaces.</li>
                <li><b>Best free</b> — Hugging Face · Stable Fast 3D (the default). Quick shape previews in seconds.</li>
                <li><b>Cheapest paid</b> — Replicate · TRELLIS, about 4¢ per model, no daily limit.</li>
                <li><b>From text alone</b> — Hunyuan3D-2 (free, ~1 heavy run a day) or fal · Rodin ($0.40).</li>
                <li><b>Sharp printable meshes</b> — Tripo, about 20-30 prepaid credits per model.</li>
              </ul>
            </details>
            <label>Model — “image or text” models can generate from a prompt alone</label>
            <select value={gm} onChange={(e) => setGm(e.target.value)}>
              {prov.models.map((mm) => (
                <option key={mm.id} value={mm.id}>{mm.label}{mm.recommended ? " · recommended" : ""}</option>
              ))}
            </select>
            {prov.models.find((mm) => mm.id === gm)?.hint && (
              <p className="fine choice-hint">{prov.models.find((mm) => mm.id === gm)!.hint}</p>
            )}
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
            <div className="sect-label">Cloud account</div>
            {syncMsg && <div className={`sync-status${syncErr ? " err" : ""}`} role="status">{syncMsg}</div>}
            {cloudEmail ? (
              <>
                <p className="fine">Signed in as <b>{cloudEmail}</b> — your projects, chats &amp; settings sync automatically across your devices.</p>
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy} onClick={() => doCloud("sync")}>Sync now</button>
                  <button className="ghost sm" disabled={cloudBusy} onClick={() => doCloud("signout")}>Sign out</button>
                </div>
                <p className="fine">On another device, sign in the same way — everything appears automatically. (3D meshes stay per-device; CAD models rebuild from their code.)</p>
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
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy || !email.includes("@")} onClick={() => doCloud("magic")}>Email me a login link</button>
                </div>
                <details className="adv">
                  <summary>Use a password instead</summary>
                  <label>Password</label>
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="at least 6 characters" />
                  <div className="param-actions">
                    <button className="primary sm" disabled={cloudBusy || !email.includes("@") || pw.length < 6} onClick={() => doCloud("signup")}>Create account</button>
                    <button className="ghost sm" disabled={cloudBusy || !email.includes("@") || pw.length < 6} onClick={() => doCloud("signin")}>Sign in</button>
                  </div>
                </details>
              </>
            )}

            <div className="sect-label">Offline backup (encrypted file, no account)</div>
            <label>Backup passphrase</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="choose a passphrase for the file"
            />
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
            <p className="fine">A zero-knowledge option: the file is encrypted with your passphrase and never uploaded. Restore it on another computer with the same passphrase.</p>
          </>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={saveAll}>Save all</button>
        </div>
        <p className="fine center">Signed out, everything stays in this browser. Signed in, it syncs privately to your account (row-level security).</p>
      </div>
    </div>
  );
}
