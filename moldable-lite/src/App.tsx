import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Workspace } from "./components/Workspace";
import { LibraryModal } from "./components/LibraryModal";
import { MeasureModal } from "./components/MeasureModal";
import { ExtrudeModal, type SvgMode, type SvgParams } from "./components/ExtrudeModal";
import { extrudeSvg, revolveSvg, embossSvg } from "./svg/extrude";
import { geometryToSTL, geometryTo3MF, geometriesTo3MF, platesToProject3MF, zipModelFiles } from "./print/exportClient";
import type { SplitPiece } from "./print/split";
import type { ViewerHandle, PickedFeature, SelectKind, TransformMode, TransformCommit, Measurement } from "./components/Viewer";
import { getEngineSelection, type EngineSelection } from "./engine/selectEngine";
import { previewSetBase, previewBoolean, previewIntersect, growMesh, displaceMesh } from "./engine/previewEngine";
import { splitConnectedParts, connectedPartCount, meshVolume } from "./print/separate";
import { GenerativeEngine } from "./engine/generativeEngine";
import type { BuildInput, EngineResult, ExportFormat, CadOp, PointOp } from "./engine/types";
import { MODELS, type ApiMsg } from "./llm/anthropic";
import { LLM_PRESETS, llmPreset, llmReady, generateLlm, getReasoningEffort, type LlmSettings, type LlmProviderId, type ReasoningEffort } from "./llm/llm";
import { fetchHouseStatus, houseStatus as houseStatusNow, type HouseStatus } from "./llm/house";
import { localSupported, localDownloaded } from "./llm/local";
import { detectProductQuery, researchDimensions, canResearch } from "./llm/research";
import { fetchOpenRouterModels, cachedOpenRouterModels, fmtORPrice, recommendedForApp, shortModelName, pickAutoModel, AUTO_MODEL, type ORModel } from "./llm/openrouterModels";
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, VISION_ADDENDUM, markupAddendum, IMPORT_ADDENDUM, REPLACEMENT_ADDENDUM, EDIT_BLOCK_ADDENDUM, fitDirective, FIT_CLEARANCE, type FitId, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { hasEditBlocks, parseEditBlocks, applyEditBlocks } from "./llm/editBlocks";
import { repairGeometry } from "./print/repair";
import { preflightExport, preflightSummary } from "./print/preflight";
import { simplifyGeometry } from "./print/simplify";
import { splitToFitBed } from "./print/split";
import { blobToDataURL } from "./gen/util";
import { extractJsBlock, extractJsonObject } from "./llm/extract";
import { parseSpec } from "./cad/spec";
import { extractParams, type CadParams } from "./cad/params";
import { EXAMPLE_SPEC, EXAMPLE_REPLICAD, IMPORT_PASSTHROUGH } from "./cad/example";
import { TemplatesModal } from "./components/TemplatesModal";
import type { Template } from "./cad/templates";
import { openInSlicer, type SlicerTarget } from "./lib/slicer";
import { IconGitHub, IconGoogle, IconX } from "./components/icons";
import { analyzePrintability, DEFAULT_PRINTER, type PrintabilityReport, type PrinterDefaults } from "./print/printability";
import { PRINTERS, PRINTER_BRANDS, printerKey } from "./print/printers";
import { PROVIDERS, getProvider, usesMultiView, pickAutoGenEngine } from "./gen/registry";
import { glbToGeometry, loadAnyMesh } from "./gen/loadMesh";
import { newProject, putProject, getProject } from "./store/projects";
import { appendVersion, restoreVersion, navigateHead, headIndex } from "./store/versions";
import type { Project, Pin } from "./store/types";
import { uid } from "./lib/id";
import type { PickedPoint } from "./components/Viewer";
import { downloadBlob, safeFileName } from "./lib/download";
import { exportSettings, importSettings } from "./lib/backup";
import { DEFAULT_RELAY, cloudUser, cloudSignUp, cloudSignIn, cloudSignOut, cloudSyncPush, cloudSyncPull, cloudOAuth, cloudMagicLink, onAuthChange, hasAuthReturn, completeAuthReturn } from "./lib/cloud";

// Run heavy, non-urgent work after the browser has painted the current frame — keeps the
// model swap feeling instant. Uses requestIdleCallback where available, else a short timeout.
function scheduleIdle(fn: () => void): void {
  const ric = (globalThis as any).requestIdleCallback as undefined | ((cb: () => void, o?: any) => number);
  if (ric) ric(() => fn(), { timeout: 300 });
  else setTimeout(fn, 32);
}

export type ChatMessage = {
  id: string; role: "user" | "assistant"; text: string; error?: boolean; streaming?: boolean; image?: string; mode?: Mode;
  model?: string; // which AI produced this reply (shown small under the bubble)
  thinking?: string; // the model's reasoning stream, kept collapsed for the curious
  sources?: { url: string; title?: string }[]; // web pages a research lookup used
};
export type Mode = "precise" | "generative";

export type SettingsPane = "ai" | "mesh" | "printer" | "appearance" | "sync";
// User chat-bubble tint presets (mixed over the bubble base in CSS, both themes).
export const DEFAULT_USER_TINT = "#14b8a6";
export const BUBBLE_TINTS: { label: string; color: string }[] = [
  { label: "Teal", color: "#14b8a6" },
  { label: "Green", color: "#22c55e" },
  { label: "Blue", color: "#3b82f6" },
  { label: "Violet", color: "#8b5cf6" },
  { label: "Amber", color: "#f59e0b" },
  { label: "Slate", color: "#64748b" },
];
const KEY_LS = "moldable_key";
const MODEL_LS = "moldable_model";
const PRINTER_LS = "moldable_printer";

// Fresh-chat engine routing: organic/sculptural language → the generative mesh engine
// (CAD can't sculpt); dimensioned/functional language → Precise CAD. Both matching →
// leave the user's current mode alone.
const ORGANIC_RE = /\b(figurine|figure|statue|sculpt(?:ure|ed)?|character|creature|animal|dog|cat|dragon|dinosaur|mask|bust|head of|face of|monster|superhero|iron\s?man|batman|pokemon|pikachu|skull|gnome|ornament|organic|life[- ]?like|realistic (?:model|version))\b/i;
const CADISH_RE = /\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|in\b)|bracket|mount(?:ing)?|holder|case|enclosure|adapter|clip|hook|gear|thread(?:ed)?|screw|bolt|hole|stand|tray|spacer|hinge|clamp|knob|plate|wall thickness|tolerance|snap[- ]?fit|press[- ]?fit)\b/i;
const PKEYS_LS = "moldable_provider_keys";
const PROXY_LS = "moldable_proxy";
const GENENG_LS = "moldable_geneng";
const LLM_LS = "moldable_llm";
const LLMKEYS_LS = "moldable_llm_keys";

function loadLlm(): LlmSettings {
  try {
    const raw = localStorage.getItem(LLM_LS);
    if (raw) {
      const v = JSON.parse(raw) as LlmSettings;
      if (LLM_PRESETS.some((p) => p.id === v.provider)) {
        // OpenRouter always starts in Auto: the router picks the best model per request
        // (and each reply says which one it used). A hand-picked model lasts the session.
        if (v.provider === "openrouter") v.model = AUTO_MODEL;
        return v;
      }
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
      if (v.provider === "auto") return { provider: "auto", model: "auto" };
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
  // Default: Auto — the app picks the best engine per request (each reply says which).
  return { provider: "auto", model: "auto" };
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
  // Optional "house AI": if the site owner's relay sponsors a key, visitors get a
  // Built-in brain with zero setup. One health check at boot; null = feature off.
  const [house, setHouse] = useState<HouseStatus | null>(null);
  useEffect(() => {
    void fetchHouseStatus().then((st) => {
      if (!st) return;
      setHouse(st);
      // No usable brain configured? Adopt the sponsored one so the app just works —
      // but never override a provider the user set up themselves.
      setLlm((cur) => (llmReady(cur, { anthropic: localStorage.getItem(KEY_LS) ?? "", ...loadLlmKeys() }) ? cur : { provider: "house", model: st.models[0] ?? "" }));
    });
  }, []);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("ai");
  const [userTint, setUserTint] = useState<string>(() => localStorage.getItem("moldable_user_tint") || DEFAULT_USER_TINT);
  useEffect(() => { document.documentElement.style.setProperty("--user-tint", userTint); }, [userTint]);
  function saveUserTint(c: string) { setUserTint(c); try { localStorage.setItem("moldable_user_tint", c); } catch {} }
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "synced">("idle");
  // When the last successful push/pull finished — shown in Settings → Sync and
  // persisted so it survives reloads.
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => {
    const v = localStorage.getItem("moldable_last_sync");
    return v ? Number(v) : null;
  });
  const markSynced = () => {
    const t = Date.now();
    localStorage.setItem("moldable_last_sync", String(t));
    setLastSyncAt(t);
    setSyncState("synced");
  };

  // Debounced auto-push: any local change (project or settings) uploads shortly
  // after, but only while signed in.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSync = () => {
    if (!accountEmailRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      setSyncState("syncing");
      void cloudSyncPush()
        .then(() => markSynced())
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
      markSynced();
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

  // Periodic safety-net autosync: push everything (API keys, settings, chats,
  // model alterations) to the account on a timer, so nothing depends on a single
  // change path remembering to sync. No-op while signed out.
  useEffect(() => {
    const id = setInterval(() => {
      if (accountEmailRef.current) void cloudSyncPush().then(() => markSynced()).catch(() => {});
    }, 45_000);
    return () => clearInterval(id);
  }, []);

  const [sel, setSel] = useState<EngineSelection | null>(null);
  const [booting, setBooting] = useState(false);
  const genEngine = useRef(new GenerativeEngine());

  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const apiHistory = useRef<ApiMsg[]>([]);
  // Web research toggle: Auto = smart (looks up named real-world products), On =
  // always research before building, Off = never. Persisted across sessions.
  const [webMode, setWebMode] = useState<"auto" | "on" | "off">(() => {
    const v = localStorage.getItem("moldable_web_mode");
    return v === "on" || v === "off" ? v : "auto";
  });
  const cycleWeb = () =>
    setWebMode((w) => {
      const next = w === "auto" ? "on" : w === "on" ? "off" : "auto";
      localStorage.setItem("moldable_web_mode", next);
      return next;
    });

  const [result, setResult] = useState<EngineResult | null>(null);
  const [splitPieces, setSplitPieces] = useState<SplitPiece[] | null>(null);
  const [autoPick, setAutoPick] = useState(""); // "Auto → <model> (<why>)" note when OpenRouter Auto picks a model
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [modelSelected, setModelSelected] = useState(false); // whole-part selection (bounding box)
  const [attachments, setAttachments] = useState<{ id: string; geometry: THREE.BufferGeometry; name: string }[]>([]); // free-floating objects (logos, badges, parts…)
  const [selAttachIds, setSelAttachIds] = useState<string[]>([]);
  // Build plates: every object (the model = "model", attachments by id) lives on a plate.
  // Bambu-Studio-style: any number of plates, assignment via menu, saved with the project.
  const [plateOf, setPlateOf] = useState<Record<string, number>>({});
  const [plateCount, setPlateCount] = useState(1);
  const [plateNames, setPlateNames] = useState<Record<number, string>>({});
  const renamePlate = (n: number, name: string) => setPlateNames((m) => {
    const next = { ...m };
    if (name.trim()) next[n] = name.trim().slice(0, 24);
    else delete next[n];
    return next;
  });
  const [activePlate, setActivePlate] = useState<number | 0>(0); // 0 = show all plates
  const [showcase, setShowcase] = useState(false); // presentation mode: clean stage + turntable
  const plateFor = (key: string) => Math.min(plateOf[key] ?? 1, plateCount);
  // No upper clamp here: "move to a plate I just added" arrives before plateCount's
  // re-render, so the raw value is stored and plateFor() clamps on read instead.
  const assignPlate = (key: string, n: number) => setPlateOf((m) => ({ ...m, [key]: Math.max(1, n) }));
  /** Add an empty plate; returns its number so callers can assign onto it directly. */
  const addPlate = () => {
    const n = Math.min(plateCount + 1, 36); // Bambu Studio's own plate cap
    setPlateCount(n);
    return n;
  };
  /** Remove plate n: its objects join the plate before it; higher plates slide down. */
  const removePlate = (n: number) => {
    if (plateCount <= 1) return;
    setPlateOf((m) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(m)) next[k] = v === n ? Math.max(1, n - 1) : v > n ? v - 1 : v;
      return next;
    });
    setPlateNames((m) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(m)) {
        const num = Number(k);
        if (num === n) continue;
        next[num > n ? num - 1 : num] = v;
      }
      return next;
    });
    setPlateCount((c) => c - 1);
    setActivePlate((a) => (a === 0 ? 0 : a === n ? 0 : a > n ? a - 1 : a));
  };
  /** Everything on the canvas, with its plate — the shared input for both plate exports. */
  function collectPlateParts(): { geometry: THREE.BufferGeometry; name: string; plate: number }[] | null {
    if (!geometry) return null;
    const parts = [{ geometry, name: project?.name ?? "model", plate: plateFor("model") }];
    for (const a of attachments) {
      const baked = viewer.current?.bakeAttachment(a.id);
      if (!baked) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(baked, 3));
      parts.push({ geometry: g, name: a.name, plate: plateFor(a.id) });
    }
    return parts;
  }
  /** One 3MF per non-empty plate — real named <object>s, positioned as placed. */
  function exportPlates() {
    const all = collectPlateParts();
    if (!all) return;
    const plates = new Map<number, { geometry: THREE.BufferGeometry; name: string }[]>();
    for (const part of all) {
      if (!plates.has(part.plate)) plates.set(part.plate, []);
      plates.get(part.plate)!.push(part);
    }
    for (const [n, parts] of [...plates.entries()].sort((x, y) => x[0] - y[0])) {
      downloadBlob(geometriesTo3MF(parts), safeFileName(`${project?.name ?? "model"}-plate-${n}`, "3mf"));
    }
    setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Exported ${plates.size} plate${plates.size > 1 ? "s" : ""} as separate 3MF files — each part is a named object, so Bambu Studio / OrcaSlicer can arrange, paint, and set per-part options.` }]);
  }
  /** ONE project 3MF with every plate laid out — Bambu Studio / OrcaSlicer open it with
      the plates intact (each part named, grouped and positioned on its plate). */
  function exportPlatesProject() {
    const all = collectPlateParts();
    if (!all) return;
    downloadBlob(platesToProject3MF(all, plateCount, { x: printer.bed.x, y: printer.bed.y }, plateNames), safeFileName(`${project?.name ?? "model"}-plates`, "3mf"));
    const used = new Set(all.map((p) => p.plate)).size;
    setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Exported one project 3MF with ${plateCount} plate${plateCount > 1 ? "s" : ""} (${used} in use) for your ${printer.bed.x}×${printer.bed.y} mm bed. Open it in Bambu Studio or OrcaSlicer — the plates and part placement come through. If your slicer only shows the geometry, use "One file per plate" instead and tell me which slicer version so I can adjust.` }]);
  }
  const [partCount, setPartCount] = useState(1); // disconnected solids in the model mesh
  // Dry-fit sandbox. Separating (and any "Make it fit" carve) deliberately does NOT
  // touch version history: attachments live outside history, so a committed split made
  // Undo resurrect the moved part at its old spot as a duplicate. Instead the split
  // holds the pre-split result here, "Regroup parts" (or Undo) restores it exactly,
  // and only Merge commits the assembled outcome as a real version.
  const separatedRef = useRef<{ ids: string[]; result: EngineResult } | null>(null);
  const [separated, setSeparated] = useState(false);
  /** Remove the split's floating parts + forget the sandbox (no model restore) —
      called before anything that rebuilds the model (undo/redo/restore/new commit). */
  function dissolveSeparation() {
    const s = separatedRef.current;
    if (!s) return;
    separatedRef.current = null;
    setSeparated(false);
    setAttachments((a) => a.filter((x) => !s.ids.includes(x.id)));
    setSelAttachIds((ids) => ids.filter((x) => !s.ids.includes(x)));
  }
  /** Put the model back exactly as it was before "Separate parts". */
  function regroupParts() {
    const s = separatedRef.current;
    if (!s) return;
    dissolveSeparation();
    applyResultNoCommit(s.result);
    setTransformMode("off");
    setModelSelected(false);
  }
  /** "Ungroup": split the model's disconnected solids so each moves on its own — the
      biggest (by bounding box) stays as the model, the rest become free objects with
      the move/rotate gizmo. A sandbox: Undo or "Regroup parts" restores the original;
      Merge makes the new arrangement permanent. */
  function separateParts() {
    if (!geometry || !result || status === "generating" || separatedRef.current) return;
    const pieces = splitConnectedParts(geometry);
    if (pieces.length < 2) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "This model is already one connected part — nothing to separate." }]);
      return;
    }
    const [main, ...rest] = pieces;
    const sz = main.boundingBox!.getSize(new THREE.Vector3());
    const dims = { x: Math.round(sz.x * 10) / 10, y: Math.round(sz.y * 10) / 10, z: Math.round(sz.z * 10) / 10 };
    const prior = result;
    applyResultNoCommit({
      kind: "generative",
      geometry: main,
      dims,
      source: { kind: "gen", provider: "separate", model: `${pieces.length} parts` },
      supportsStep: false,
      glb: geometryToSTL(main),
    });
    const ids = rest.map((g, i) => addAttachment(g, `Part ${i + 2}`));
    separatedRef.current = { ids, result: prior };
    setSeparated(true);
    setMessages((m) => [...m, {
      id: mid(), role: "assistant",
      text: `Separated the model into **${pieces.length} parts** — the largest stays as the model, the other${rest.length > 1 ? "s are" : " is"} now free object${rest.length > 1 ? "s" : ""} you can move and rotate on their own (in any direction, mid-air included). Try the fit: drag Part 2 over the model, then tap **Check fit** — it computes the real overlap between the solids. If parts are meant to nest and they collide, **Make it fit** carves the needed room out of the model. **Undo** or **Regroup parts** puts everything back exactly as it was; **Merge all into model** makes the new arrangement permanent.`,
    }]);
  }

  /** For parts designed to go INTO each other: carve each selected part's shape — grown
      by an FDM clearance — out of the model at its current position, so it can nest.
      Inside the dry-fit sandbox this stays un-committed (Undo/Regroup restores);
      standalone it commits a version like any other edit. */
  async function makeItFit(ids: string[]) {
    if (!geometry || !result || status === "generating" || !ids.length) return;
    const CLEARANCE = 0.2; // mm per side — the usual FDM slip-fit allowance
    setStatus("generating");
    try {
      let baseGeom = geometry;
      let g: THREE.BufferGeometry | null = null;
      const carvedNames: string[] = [];
      for (const id of ids) {
        const a = attachments.find((x) => x.id === id);
        if (!a) continue;
        const baked = viewer.current?.bakeAttachment(id);
        if (!baked) throw new Error(`couldn't read ${a.name}'s placement`);
        if (!(await previewSetBase(baseGeom))) throw new Error("this model's mesh couldn't be welded for a boolean");
        const inter = await previewIntersect(baked);
        if (!inter || meshVolume(inter) < 1) continue; // not touching the model — nothing to carve
        const grown = await growMesh(baked, CLEARANCE); // true surface offset: every face moves outward
        if (!grown) throw new Error(`${a.name}'s mesh couldn't be welded to grow the clearance`);
        const pos = await previewBoolean(grown, -1); // cut the grown shape
        if (!pos) throw new Error(`carving ${a.name}'s shape out of the model failed`);
        g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        baseGeom = g;
        carvedNames.push(a.name);
      }
      if (!g) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Nothing to carve — the selected part isn't overlapping the model. Move it to where it should nest (so they collide), then tap Make it fit." }]);
        return;
      }
      g.computeVertexNormals();
      g.computeBoundingBox();
      const sz = g.boundingBox!.getSize(new THREE.Vector3());
      const dims = { x: Math.round(sz.x * 10) / 10, y: Math.round(sz.y * 10) / 10, z: Math.round(sz.z * 10) / 10 };
      const names = carvedNames.join(" + ");
      const res: EngineResult = {
        kind: "generative",
        geometry: g,
        dims,
        source: { kind: "gen", provider: "fit-cut", model: names },
        supportsStep: false,
        glb: geometryToSTL(g),
      };
      if (separatedRef.current) applyResultNoCommit(res); // sandbox: Undo/Regroup restores the original
      else applyResult(res, project?.name ?? "Model", `Carved clearance for ${names}`, "make it fit");
      setMessages((m) => [...m, {
        id: mid(), role: "assistant",
        text: `Carved **${names}**'s shape out of the model with **${CLEARANCE} mm clearance** per side — it can nest there now. Tap **Check fit** to confirm (it should pass), and slide the part in and out to eyeball it. ${separatedRef.current ? "**Merge all into model** makes this permanent; **Undo** / **Regroup parts** restores the original." : "Undo restores the un-carved model."}`,
      }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Make it fit failed: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Dry-fit check: boolean-intersect each selected part against the model. Zero overlap
      = no interference at this position; any volume = they collide by that much. */
  async function checkFit(ids: string[]) {
    if (!geometry || status === "generating" || !ids.length) return;
    setStatus("generating");
    try {
      if (!(await previewSetBase(geometry))) throw new Error("this model's mesh couldn't be welded for a boolean check");
      const lines: string[] = [];
      for (const id of ids) {
        const a = attachments.find((x) => x.id === id);
        if (!a) continue;
        const baked = viewer.current?.bakeAttachment(id);
        if (!baked) throw new Error(`couldn't read ${a.name}'s placement`);
        const inter = await previewIntersect(baked);
        if (!inter) throw new Error(`${a.name}'s mesh couldn't be welded for a boolean check`);
        const overlap = meshVolume(inter);
        const partVol = meshVolume(baked);
        // Tessellated curves graze each other where surfaces mate — ignore crumbs.
        if (overlap < Math.max(1, partVol * 0.001)) {
          lines.push(`✓ **${a.name}** doesn't intersect the model here — no interference at this position.`);
        } else {
          const pct = Math.round((overlap / partVol) * 100);
          const shown = overlap >= 1000 ? `${(overlap / 1000).toFixed(1)} cm³` : `${overlap.toFixed(1)} mm³`;
          lines.push(`✗ **${a.name}** overlaps the model by **${shown}**${pct > 0 ? ` (~${pct}% of the part)` : ""} — they collide at this position. If it's just misplaced, move it and re-check. If these parts are MEANT to nest (a lid into a box, a peg into a hole), tap **Make it fit** — it carves ${a.name}'s shape plus clearance out of the model right here.`);
        }
      }
      if (lines.length) {
        lines.push("A clean pass means no collision at this exact position — how snug it prints still comes from the clearance designed between the mating faces.");
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: lines.join("\n\n") }]);
      }
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Fit check failed: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Bring floating parts back down: bbox min z → 0, keeping x/y and rotation. */
  function dropToPlate(ids: string[]) {
    for (const id of ids) viewer.current?.dropAttachment(id);
  }

  // ---- AI change preview ("ask before apply") ----------------------------------
  // Like an agent's ask-vs-auto mode: in "ask" (default), an AI result is BUILT but
  // held — shown on canvas with a real geometric diff (green = added, red = removed,
  // Manifold booleans) and an Apply/Discard bar. Only Apply commits it to the project.
  // Direct manipulations (sliders, push-pull, transforms, imports) never gate — they
  // already preview live and are the user's own hands.
  const [aiApply, setAiApplyState] = useState<"ask" | "auto">(() => {
    const v = localStorage.getItem("moldable_ai_apply");
    return v === "auto" ? "auto" : "ask";
  });
  const setAiApply = (v: "ask" | "auto") => {
    setAiApplyState(v);
    try { localStorage.setItem("moldable_ai_apply", v); } catch { /* private mode */ }
  };
  type PendingChange = {
    res: EngineResult;
    name: string;
    summary: string;
    promptText: string;
    prevGeometry: THREE.BufferGeometry | null;
    diff: { added: Float32Array | null; removed: Float32Array | null } | null;
    clearImageAfter: boolean;
  };
  const [pending, setPending] = useState<PendingChange | null>(null);
  const pendingRef = useRef<PendingChange | null>(null);
  pendingRef.current = pending;
  const applyingPending = useRef(false);

  const soupOf = (g: THREE.BufferGeometry): Float32Array => {
    const ng = g.index ? g.toNonIndexed() : g;
    const pos = (ng.getAttribute("position").array as Float32Array).slice();
    if (ng !== g) ng.dispose();
    return pos;
  };
  /** What would this change do, physically? added = new − old, removed = old − new. */
  async function computeChangeDiff(oldG: THREE.BufferGeometry | null, newG: THREE.BufferGeometry) {
    try {
      if (!oldG) return null;
      const oldSoup = soupOf(oldG);
      const newSoup = soupOf(newG);
      let removed: Float32Array | null = null;
      let added: Float32Array | null = null;
      if (await previewSetBase(oldG)) removed = await previewBoolean(newSoup, -1);
      if (await previewSetBase(newG)) added = await previewBoolean(oldSoup, -1);
      if (removed && meshVolume(removed) < 1) removed = null; // tessellation crumbs
      if (added && meshVolume(added) < 1) added = null;
      return added || removed ? { added, removed } : null;
    } catch {
      return null; // no diff ≠ no preview — the bar still shows the proposal
    }
  }
  /** Route an AI-built result: auto → commit now; ask → hold it as an on-canvas
      proposal. Returns which happened so callers can word their chat message. */
  async function deliverResult(res: EngineResult, name: string, summary: string, promptText: string, clearImageAfter = false): Promise<"applied" | "pending"> {
    if (aiApply === "auto") {
      applyResult(res, name, summary, promptText);
      if (clearImageAfter) clearImage();
      return "applied";
    }
    const prevGeometry = geometry;
    const diff = await computeChangeDiff(prevGeometry, res.geometry);
    setGeometry(res.geometry); // show the proposal; `result`/history stay untouched
    setPending({ res, name, summary, promptText, prevGeometry, diff, clearImageAfter });
    return "pending";
  }
  function applyPending() {
    const pc = pendingRef.current;
    if (!pc) return;
    applyingPending.current = true;
    try {
      applyResult(pc.res, pc.name, pc.summary, pc.promptText);
      if (pc.clearImageAfter) clearImage();
    } finally {
      applyingPending.current = false;
    }
    setPending(null);
  }
  function discardPending(silent = false) {
    const pc = pendingRef.current;
    if (!pc) return;
    setPending(null);
    setGeometry(pc.prevGeometry);
    if (!silent) setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Discarded — the model is unchanged. (The proposal is gone; re-ask any time.)" }]);
  }

  const attachSelected = selAttachIds.length > 0;
  const addAttachment = (geometry: THREE.BufferGeometry, name: string): string => {
    const id = mid();
    setAttachments((a) => [...a, { id, geometry, name }]);
    selectAttach(id);
    return id;
  };
  const renameAttachment = (id: string, name: string) => {
    const v = name.trim();
    if (v) setAttachments((a) => a.map((x) => (x.id === id ? { ...x, name: v } : x)));
  };

  // ---- canvas clipboard: copy / paste / duplicate objects (right-click menu) ----
  const clipRef = useRef<{ pos: Float32Array; name: string } | null>(null);
  const [clipName, setClipName] = useState<string | null>(null); // re-render hook for "Paste"
  /** Snapshot an object's CURRENT world shape (model or attachment) for paste. */
  function copyObject(target: { kind: "model" } | { kind: "attachment"; id: string }): { pos: Float32Array; name: string } | null {
    if (target.kind === "model") {
      if (!geometry) return null;
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const pos = (g.getAttribute("position").array as Float32Array).slice();
      if (g !== geometry) g.dispose();
      const snap = { pos, name: project?.name ?? "Model" };
      clipRef.current = snap;
      setClipName(snap.name);
      return snap;
    }
    const a = attachments.find((x) => x.id === target.id);
    const baked = viewer.current?.bakeAttachment(target.id);
    if (!a || !baked) return null;
    const snap = { pos: baked, name: a.name };
    clipRef.current = snap;
    setClipName(snap.name);
    return snap;
  }
  /** Paste the clipboard as a new free object, nudged +10 mm so it's visibly a copy. */
  function pasteObject(clip?: { pos: Float32Array; name: string } | null) {
    const c = clip ?? clipRef.current;
    if (!c) return;
    const pos = c.pos.slice();
    for (let i = 0; i < pos.length; i += 3) pos[i] += 10;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    addAttachment(g, `${c.name} copy`);
  }
  const duplicateObject = (target: { kind: "model" } | { kind: "attachment"; id: string }) => pasteObject(copyObject(target));
  const removeAttachment = (id: string) => {
    setAttachments((a) => a.filter((x) => x.id !== id));
    setSelAttachIds((sids) => {
      const next = sids.filter((x) => x !== id);
      if (!next.length) setTransformMode("off");
      return next;
    });
  };
  const [appearance, setAppearanceState] = useState<{ color: string; finish: "matte" | "satin" | "glossy" | "metal" }>(() => {
    try { return { color: "#c7ccd3", finish: "matte", ...JSON.parse(localStorage.getItem("moldable_appearance") ?? "{}") }; } catch { return { color: "#c7ccd3", finish: "matte" }; }
  });
  const setAppearance = (v: { color: string; finish: "matte" | "satin" | "glossy" | "metal" }) => { setAppearanceState(v); try { localStorage.setItem("moldable_appearance", JSON.stringify(v)); } catch { /* private */ } };
  const [snap, setSnapState] = useState<{ move: number; rotate: number }>(() => {
    try { return { move: 0, rotate: 15, ...JSON.parse(localStorage.getItem("moldable_snap") ?? "{}") }; } catch { return { move: 0, rotate: 15 }; }
  });
  const setSnap = (v: { move: number; rotate: number }) => { setSnapState(v); try { localStorage.setItem("moldable_snap", JSON.stringify(v)); } catch { /* private mode */ } };
  const modeTouched = useRef(false); // user clicked the Precise/Generative switch themselves
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(null);
  const [report, setReport] = useState<PrintabilityReport | null>(null);
  const reportJob = useRef(0); // guards the deferred printability pass against stale results
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [streamingText, setStreamingText] = useState("");
  const [streamingThink, setStreamingThink] = useState(""); // live model reasoning (chat shows it while generating)
  const [codeBuffer, setCodeBuffer] = useState("");
  const [cadDefaults, setCadDefaults] = useState<CadParams | null>(null);
  const [paramValues, setParamValues] = useState<CadParams>({});
  const [pins, setPins] = useState<Pin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinText, setPinText] = useState("");
  // One Select tool with modes: hover-highlight + click a face / edge / corner, or
  // drop a point marker ("point" = the old Pin). Then edit the picked thing precisely.
  const [selectMode, setSelectMode] = useState(false);
  const [selectKind, setSelectKind] = useState<SelectKind>("face");
  const [transformMode, setTransformMode] = useState<TransformMode>("off");
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePending, setMeasurePending] = useState<[number, number, number] | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [liveDragMm, setLiveDragMm] = useState<number | null>(null); // arrow-drag value mirrored into the quick-edit box
  const [selectedFeature, setSelectedFeature] = useState<PickedFeature | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<PickedFeature[]>([]); // box/marquee multi-select
  const [facesText, setFacesText] = useState("");
  const [faceText, setFaceText] = useState("");

  const [mode, setMode] = useState<Mode>("precise");
  // Guided "fix a broken part" flow + FDM fit tolerance (applies to mating features).
  const [guided, setGuided] = useState(false);
  const [fit, setFit] = useState<FitId>("snug");
  // A composer image is either a real-world reference photo, or (markup=true) a marked
  // screenshot of the CURRENT model — "circle it and ask". `view` remembers where the
  // camera looked when the mark was drawn; `region` is the raycast 3D extent of what
  // the circle actually landed on (display coords) — hard numbers for the AI.
  const [image, setImage] = useState<{
    blob: Blob;
    url: string;
    markup?: boolean;
    view?: { azimuthDeg: number; elevationDeg: number } | null;
    region?: { min: [number, number, number]; max: [number, number, number]; centroid: [number, number, number]; normal: [number, number, number]; hits: number } | null;
  } | null>(null);
  // Extra reference angles for multi-view mesh generation (front is `image`).
  type ViewSlot = "left" | "back" | "right";
  const [views, setViews] = useState<Partial<Record<ViewSlot, { blob: Blob; url: string }>>>({});
  function pickView(slot: ViewSlot, file: File) {
    setViews((v) => {
      v[slot] && URL.revokeObjectURL(v[slot]!.url);
      return { ...v, [slot]: { blob: file, url: URL.createObjectURL(file) } };
    });
  }
  function clearView(slot: ViewSlot) {
    setViews((v) => {
      v[slot] && URL.revokeObjectURL(v[slot]!.url);
      const n = { ...v };
      delete n[slot];
      return n;
    });
  }
  function clearAllViews() {
    setViews((v) => {
      Object.values(v).forEach((x) => x && URL.revokeObjectURL(x.url));
      return {};
    });
  }

  const [tab, setTab] = useState<"3d" | "code" | "params" | "print" | "history">("3d");
  const [wireframe, setWireframe] = useState(false);
  // Dimensions box: "select" (default) draws the size lines + gray bounding box only
  // around a SELECTED object — click empty space and the canvas is clean again.
  // "always" is the old permanent box; "off" never draws it.
  const [dimsMode, setDimsModeState] = useState<"select" | "always" | "off">(() => {
    const v = localStorage.getItem("moldable_dims");
    return v === "always" || v === "off" ? v : "select";
  });
  const setDimsMode = (m: "select" | "always" | "off") => {
    setDimsModeState(m);
    localStorage.setItem("moldable_dims", m);
  };
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
  const [showTemplates, setShowTemplates] = useState(false);
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

  // ---- build plates: save layout with the project (same debounced pattern as chat) ----
  useEffect(() => {
    const t = setTimeout(() => {
      const pr = projectRef.current;
      if (!pr) return;
      const cur = pr.plates ?? { count: 1, of: {} };
      if (cur.count === plateCount && JSON.stringify(cur.of) === JSON.stringify(plateOf) && JSON.stringify(cur.names ?? {}) === JSON.stringify(plateNames)) return;
      const next = { ...pr, plates: { count: plateCount, of: plateOf, names: plateNames }, updatedAt: Date.now() };
      projectRef.current = next;
      setProject(next);
      void putProject(next);
      scheduleSync();
    }, 600);
    return () => clearTimeout(t);
  }, [plateOf, plateCount, plateNames]);

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

  // Rename the project from the title beside the logo. Saves under the new name
  // in the Library and syncs. If nothing's been generated yet, start a shell so
  // the name (and any chat so far) is preserved.
  function renameProject(name: string) {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    const pr = projectRef.current;
    if (pr) {
      const next = { ...pr, name: clean, updatedAt: Date.now() };
      projectRef.current = next;
      persist(next);
    } else {
      const chat = messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, text: m.text, error: m.error, image: m.image }));
      const shell = { ...newProject(clean, "replicad"), chat, pins };
      projectRef.current = shell;
      persist(shell);
    }
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

  /** "Circle it and ask": the viewer hands us the annotated screenshot; it rides the
      composer's image slot with markup=true so send() frames it as an edit pointer. */
  function attachMarkup(blob: Blob, view: { azimuthDeg: number; elevationDeg: number } | null, region: NonNullable<typeof image>["region"] = null) {
    if (image) URL.revokeObjectURL(image.url);
    setImage({ blob, url: URL.createObjectURL(blob), markup: true, view, region });
    setMode("precise"); // marked edits target the current CAD program
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
    clearAllViews(); // extra angles are meaningless without a front image
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
    dissolveSeparation(); // a committed result replaces the model — the dry-fit sandbox's floating parts must not linger
    applyResultNoCommit(res);

    const base = project ?? newProject(name, res.kind);
    const named = base.versions.length === 0 && name ? { ...base, name } : base;
    const snap = appendVersion(named, {
      engine: res.kind,
      summary,
      code: res.source.kind === "code" ? res.source.code : undefined,
      params: res.source.kind === "code" ? res.source.params : undefined,
      ops: res.source.kind === "code" ? res.source.ops : undefined,
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
    // Anything landing a real result supersedes a held AI proposal (undo/restore/
    // sliders/direct ops all come through here) — drop it so it can't linger.
    if (pendingRef.current && !applyingPending.current) setPending(null);
    if (holeRef.current) setHoleDraft(null); // a rebuilt model invalidates the drill draft's coords
    setResult(res);
    setSplitPieces(null); // any new/changed model invalidates a prior split's pieces
    // Measurements are anchored to the display mesh's coords, which shift when the model
    // rebuilds/recenters — drop them (and any half-made one) so none linger at stale spots.
    setMeasurements([]);
    setMeasurePending(null);
    setGeometry(res.geometry);
    setDims(res.dims);
    setCodeBuffer(sourceText(res.source));
    // Printability analysis is a heavy synchronous mesh pass — run it AFTER the new geometry
    // has painted so the model swap feels instant. Guard with a job token so a rapid sequence
    // of edits only keeps the latest report. Old report stays on screen for the ~1 frame gap.
    const geo = res.geometry;
    const job = ++reportJob.current;
    scheduleIdle(() => {
      if (reportJob.current !== job) return;
      setReport(computeReport(geo));
      // Disconnected solids (e.g. a box printed beside its lid) unlock "Separate parts".
      try { setPartCount(connectedPartCount(geo)); } catch { setPartCount(1); }
    });
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

  /** Cut a too-big model into bed-sized parts, laid out on the plate to print + assemble. */
  async function splitMesh() {
    if (!result || status === "generating" || !report) return;
    const bed = report.bedFit.bed;
    setStatus("generating");
    try {
      const out = splitToFitBed(result.geometry, bed);
      if (out.parts <= 1) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "This model already fits the bed — no split needed." }]);
        return;
      }
      // The split output is a plain mesh of parts — treat it as a generative result
      // so export writes exactly these arranged pieces (STEP no longer applies).
      applyResultNoCommit({
        kind: "generative",
        geometry: out.geometry,
        dims: out.dims,
        source: { kind: "gen", provider: "split", model: "split-to-fit-bed", prompt: `split into ${out.parts} parts` },
        supportsStep: false,
        glb: geometryToSTL(out.geometry),
      });
      setSplitPieces(out.pieces); // enables the colour-coded pieces list + per-piece / ZIP export
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: `Split into ${out.parts} colour-coded pieces — each fits your ${bed.x} × ${bed.y} mm bed. Export them all as separate STLs/3MFs (or one file), print, and glue or pin them together. (This replaces the single model; use Undo or History to go back.)`,
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Split failed: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  const pieceBlob = (g: THREE.BufferGeometry, format: "stl" | "3mf") => (format === "stl" ? geometryToSTL(g) : geometryTo3MF(g));
  function exportPiece(index: number, format: "stl" | "3mf") {
    const piece = splitPieces?.[index];
    if (!piece) return;
    const base = safeFileName(project?.name ?? "model", format).replace(/\.[^.]+$/, "");
    downloadBlob(pieceBlob(piece.geometry, format), `${base}-part${index + 1}.${format}`);
  }
  async function exportAllPieces(format: "stl" | "3mf") {
    if (!splitPieces?.length) return;
    const base = safeFileName(project?.name ?? "model", format).replace(/\.[^.]+$/, "");
    try {
      const files: Record<string, Blob> = {};
      splitPieces.forEach((p, i) => { files[`${base}-part${i + 1}.${format}`] = pieceBlob(p.geometry, format); });
      const zip = await zipModelFiles(files);
      downloadBlob(zip, `${base}-parts-${format}.zip`);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Export failed: " + String(err?.message ?? err), error: true }]);
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
    const { geometry: g, dims: d, texture } = await loadAnyMesh(glb);
    applyResultNoCommit({ kind: "generative", geometry: g, dims: d, source, supportsStep: false, glb, texture });
  }

  /** Turn the dropped SVG into a solid — extrude, revolve, or emboss. Persisted
   *  as an STL blob (Z-up mm), so it re-opens through the same path. */
  function createFromSvg(mode: SvgMode, prm: SvgParams) {
    if (!svgDraft) return;
    try {
      if (mode === "attach") {
        // A free-floating object ON the current model: position with the gizmo/anchors,
        // then Merge in the Objects panel fuses it into one printable solid.
        const { geometry: g, dims: d } = extrudeSvg(svgDraft.text, { sizeMm: prm.sizeMm, heightMm: prm.heightMm });
        addAttachment(g, svgDraft.name);
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Added **${svgDraft.name}** (${d.x} × ${d.y} × ${d.z} mm) as a movable object on the model. Drag the arrows/rings to place it, corner dots to size it, then press **Merge** in the Objects panel (layers icon) to make it part of the case. Merging produces a mesh — do CAD edits first.` }]);
        URL.revokeObjectURL(svgDraft.url);
        setSvgDraft(null);
        return;
      }
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

    // A model is already on the canvas → a dropped mesh becomes a NEW OBJECT next to it
    // (Objects panel: position, Merge, or remove) instead of silently replacing the work.
    if (geometry && /\.(glb|gltf|stl)$/i.test(f.name)) {
      setStatus("generating");
      try {
        const { geometry: g, dims: d } = await loadAnyMesh(f);
        const cleanName = f.name.replace(/\.(glb|gltf|stl)$/i, "");
        addAttachment(g, cleanName);
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Added **${cleanName}** (${d.x} × ${d.y} × ${d.z} mm) as a new object on the canvas — it's in the Objects panel. Position it with the gizmo, **Merge** to fuse it into the model, or ✕ to remove. (To open it on its own instead, start a + New chat first.)` }]);
      } catch (err: any) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't read that mesh file: " + String(err?.message ?? err), error: true }]);
      } finally {
        setStatus("idle");
      }
      return;
    }

    if (/\.shapr$/i.test(f.name)) {
      setMessages((m) => [
        ...m,
        { id: mid(), role: "assistant", text: "Shapr3D's native .shapr format is proprietary and can't be read here. In Shapr3D: Export → STEP, then drop that file in — it imports as a fully editable CAD solid.", error: true },
      ]);
      return;
    }

    // STEP imports as an exact editable solid. STL is a mesh, but OCCT can convert it to a
    // faceted B-rep solid — good enough for AI edits (holes, cuts, resize, booleans); smooth
    // fillets won't work on facets. If the conversion fails (huge/organic/broken meshes),
    // the file falls through to the plain mesh pipeline below with a note.
    const asCad = /\.(step|stp)$/i.test(f.name) ? "step" : /\.stl$/i.test(f.name) && sel?.kind === "replicad" && sel.engine.setImport ? "stl" : null;
    if (/\.(step|stp)$/i.test(f.name) || asCad === "stl") {
      if (!sel) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "The CAD engine is still starting — try the import again in a few seconds." }]);
        return;
      }
      if (asCad === "step" && (sel.kind !== "replicad" || !sel.engine.setImport)) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "STEP import needs the OpenCascade engine, which failed to boot on this device (the app fell back to the primitive engine).", error: true }]);
        return;
      }
      setStatus("generating");
      try {
        await sel.engine.setImport!(f, asCad ?? "step");
        importFileRef.current = f;
        const res = await sel.engine.build({ kind: "code", code: IMPORT_PASSTHROUGH, params: {} });
        const cleanName = f.name.replace(/\.(step|stp|stl)$/i, "");
        applyResult(res, cleanName, `Imported ${f.name} — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`, `import ${f.name}`);
        seedHistory("replicad", IMPORT_PASSTHROUGH, undefined);
        setMode("precise");
        const caveat = asCad === "stl"
          ? " (converted from a mesh — flat facets, so cuts, holes, resize and booleans work; smooth fillets may not)"
          : "";
        setMessages((m) => [
          ...m,
          {
            id: mid(),
            role: "assistant",
            text: `Imported ${f.name} as an editable CAD solid${caveat} (${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm). Tell me what to change — “add two 5 mm mounting holes”, “cut a 20 mm slot through the middle” — or edit the code in Source.`,
          },
        ]);
        setStatus("idle");
        return;
      } catch (err: any) {
        setStatus("idle");
        if (asCad !== "stl") {
          setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't read that STEP file: " + String(err?.message ?? err), error: true }]);
          return;
        }
        // STL that OCCT couldn't solidify → import it as a plain mesh instead (below).
        try { await sel.engine.setImport!(null); } catch { /* worker may have respawned */ }
        importFileRef.current = null;
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "That STL couldn't be converted to an editable solid — importing it as a plain mesh instead (measure, repair, resize, export still work)." }]);
      }
    }

    setStatus("generating");
    try {
      const { geometry: g, dims: d, texture } = await loadAnyMesh(f);
      const cleanName = f.name.replace(/\.(glb|gltf|stl)$/i, "");
      const res: EngineResult = {
        kind: "generative",
        geometry: g,
        dims: d,
        source: { kind: "gen", provider: "import", model: f.name },
        supportsStep: false,
        glb: f,
        texture,
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
    setSelectedFeature(null); // only one editing target at a time
    setSelectedFaces([]);
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
  function clearAllPins() {
    setPins([]);
    setActivePinId(null);
    setPinText("");
  }
  function askAiPin() {
    if (!activePin || !pinText.trim()) return;
    const { pin, face } = activePin;
    const note = pinText.trim();
    savePinNote();
    setActivePinId(null);
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

  function pickFeature(f: PickedFeature) {
    // The hole tool is waiting for its alignment reference → this pick IS the reference
    // (click another hole's rim or inner wall; its centre becomes the datum).
    if (holeRef.current?.picking) {
      // A hole's rim (closed edge) or inner wall (curved face) → its centroid IS the
      // hole's axis; any other feature falls back to the exact clicked point.
      const c: [number, number, number] =
        (f.kind === "edge" && f.closed) || (f.kind === "face" && f.curved) ? [f.cx, f.cy, f.cz] : f.at ?? [f.cx, f.cy, f.cz];
      const refDia = f.kind === "edge" && f.closed && f.len ? Math.round((f.len / Math.PI) * 10) / 10 : undefined;
      setHoleDraft((d) => (d ? { ...d, picking: false, ref: { center: c, diameter: refDia } } : d));
      return;
    }
    setSelectedFeature(f);
    setFaceText("");
    // Only one editing target (point vs single feature vs multi) at a time.
    setActivePinId(null);
    setPinText("");
    setSelectedFaces([]);
  }

  // ---- Hole tool: measured drilling with hole-to-hole alignment + magnet snap ------
  type HoleDraft = {
    at: [number, number, number]; // display coords, ON the face
    normal: [number, number, number];
    diameter: number;
    depth: number; // 0 = through
    snap: number; // magnet increment for typed/aligned positions, 0 = free
    ref: { center: [number, number, number]; diameter?: number } | null;
    picking: boolean; // next feature pick becomes the reference
  };
  const [holeDraft, setHoleDraft] = useState<HoleDraft | null>(null);
  const holeRef = useRef<HoleDraft | null>(null);
  holeRef.current = holeDraft;
  const snapV = (v: number, snap: number) => (snap > 0 ? Math.round(v / snap) * snap : Math.round(v * 100) / 100);
  /** The two editable in-plane axes (0=x 1=y 2=z), given the face normal. */
  const holeAxes = (n: [number, number, number]): [number, number] => {
    const k = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])].indexOf(Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])));
    return k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
  };
  function startHole() {
    const f = selectedFeature;
    if (!f || f.kind !== "face") return;
    const n: [number, number, number] = [f.nx ?? 0, f.ny ?? 0, f.nz ?? 1];
    const at: [number, number, number] = [...(f.at ?? [f.cx, f.cy, f.cz])] as [number, number, number];
    const snap = 1;
    for (const i of holeAxes(n)) at[i] = snapV(at[i], snap); // magnet the click straight away
    setHoleDraft({ at, normal: n, diameter: 5, depth: 0, snap, ref: null, picking: false });
    setSelectedFeature(null);
  }
  function setHoleAxis(axis: number, value: number) {
    setHoleDraft((d) => {
      if (!d) return d;
      const at = [...d.at] as [number, number, number];
      at[axis] = snapV(value, d.snap);
      return { ...d, at };
    });
  }
  async function applyHole() {
    const d = holeRef.current;
    if (!d || !result || result.source.kind !== "code" || !sel || activeKind !== "replicad") {
      if (d) setMessages((m) => [...m, { id: mid(), role: "assistant", text: "The hole tool works on Precise (CAD) models.", error: true }]);
      setHoleDraft(null);
      return;
    }
    const src = result.source;
    const rc = result.recenter ?? [0, 0, 0];
    const op = {
      type: "hole" as const,
      at: [d.at[0] + rc[0], d.at[1] + rc[1], d.at[2] + rc[2]] as [number, number, number],
      normal: d.normal,
      diameter: d.diameter,
      depth: d.depth,
    };
    setHoleDraft(null);
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), op] });
      const what = `⌀${d.diameter} mm ${d.depth > 0 ? `pocket, ${d.depth} mm deep` : "through-hole"}`;
      applyResult(res, project?.name ?? "Model", `Drilled a ${what}`, `hole ${d.diameter}`);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Drilled a **${what}** — free, no AI. Undo reverts it; it also rides along when sliders rebuild the model.` }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't drill there: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }
  function pickFaces(faces: PickedFeature[], additive = false) {
    setSelectedFaces((prev) => {
      if (!additive) return faces;
      // Shift-click adds to the set — dedup by centre so re-clicking a face is a no-op.
      const keyOf = (f: PickedFeature) => `${f.cx}|${f.cy}|${f.cz}`;
      const have = new Set(prev.map(keyOf));
      return [...prev, ...faces.filter((f) => !have.has(keyOf(f)))];
    });
    if (!additive) setFacesText("");
    if (faces.length) { setSelectedFeature(null); setActivePinId(null); setPinText(""); }
  }

  /** Multi-face quick edit: extrude EVERY selected face by the same amount — one local
      rebuild, no AI. Positive pushes out, negative pockets in. */
  async function applyDirectOpFaces(size: number) {
    if (!selectedFaces.length || !size) return;
    if (!result || result.source.kind !== "code" || !sel || activeKind !== "replicad") {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Direct edits work on Precise (CAD) models.", error: true }]);
      return;
    }
    const src = result.source;
    const rc = result.recenter ?? [0, 0, 0];
    const ops: PointOp[] = selectedFaces.map((f) => {
      const at = f.at ?? [f.cx, f.cy, f.cz];
      return { type: "extrude", at: [at[0] + rc[0], at[1] + rc[1], at[2] + rc[2]], size };
    });
    const n = ops.length;
    setSelectedFaces([]);
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), ...ops], preview: false });
      applyResult(res, project?.name ?? "Model", `Extruded ${n} faces by ${size} mm`, `extrude ${n} faces ${size} mm`);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Extruded **${n} face${n > 1 ? "s" : ""}** by ${size} mm — free, no AI. Undo reverts all of them at once.` }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't extrude all ${n} faces by ${size} mm — ${String(err?.message ?? err)}. Try a smaller amount, or apply faces one at a time.`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }
  function askAiFaces() {
    if (!selectedFaces.length || !facesText.trim()) return;
    const note = facesText.trim();
    const faces = selectedFaces;
    setSelectedFaces([]);
    setSelectMode(false);
    setFacesText("");
    const size = dims ? `The whole part measures about ${dims.x} × ${dims.y} × ${dims.z} mm. ` : "";
    const list = faces
      .map((f, i) => `  ${i + 1}. the ${f.label} centred at x=${f.cx}, y=${f.cy}, z=${f.cz} mm, facing (${f.nx}, ${f.ny}, ${f.nz}), about ${f.w} × ${f.h} mm`)
      .join("\n");
    void send(
      `Modify the current CAD model: ${note}. ${size}Apply this to these ${faces.length} selected faces (coordinates are Z-up, in millimetres):\n${list}\n` +
        `Apply the change consistently to each listed face and leave the rest of the part unchanged. Return the full updated code.`,
      "precise",
    );
  }
  /** Describe the picked face/edge/vertex precisely so the AI edits exactly it. */
  function featureDirective(f: PickedFeature): string {
    if (f.kind === "face") {
      const shape = f.curved ? "curved surface" : "flat face";
      return `Apply this on the ${f.label} — a ${shape} facing (${f.nx}, ${f.ny}, ${f.nz}), ` +
        `centred at x=${f.cx} mm, y=${f.cy} mm, z=${f.cz} mm, spanning about ${f.w} × ${f.h} mm. ` +
        `Keep the change ON this surface and centred on it unless I say otherwise.`;
    }
    if (f.kind === "edge") {
      if (f.closed) {
        return `Apply this to the closed edge loop (e.g. a rim) around x=${f.cx} mm, y=${f.cy} mm, z=${f.cz} mm, ` +
          `about ${f.len} mm total length. Target just this whole edge loop (e.g. a fillet or chamfer around it).`;
      }
      return `Apply this to the edge running from (${f.ax}, ${f.ay}, ${f.az}) to (${f.bx}, ${f.by}, ${f.bz}) mm, ` +
        `about ${f.len} mm long (midpoint x=${f.cx}, y=${f.cy}, z=${f.cz}). Target just this whole edge (e.g. a fillet or chamfer along it).`;
    }
    return `Apply this at the corner/vertex at x=${f.cx} mm, y=${f.cy} mm, z=${f.cz} mm. Target just this corner (e.g. round or chamfer it).`;
  }
  function askAiFeature() {
    if (!selectedFeature || !faceText.trim()) return;
    const f = selectedFeature;
    const note = faceText.trim();
    setSelectedFeature(null);
    setSelectMode(false);
    setFaceText("");
    const size = dims ? `The whole part measures about ${dims.x} × ${dims.y} × ${dims.z} mm. ` : "";
    void send(
      `Modify the current CAD model: ${note}. ${size}${featureDirective(f)} ` +
        `(coordinates are Z-up, in millimetres). Leave the rest of the part unchanged and return the full updated code.`,
      "precise",
    );
  }

  // Direct geometry op on the picked edge / corner / face — computed by replicad in
  // the worker with NO AI call (free). Commits a version so Undo works.
  async function applyDirectOp(type: PointOp["type"], size: number) {
    const f = selectedFeature;
    if (!f || !size) return;
    if (!result || result.source.kind !== "code" || !sel || activeKind !== "replicad") {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Direct edits work on Precise (CAD) models.", error: true }]);
      return;
    }
    const src = result.source;
    // Picked coords are in display space; map them back to the engine's own coords
    // (the display is recentred on the bed) so the finder hits the real edge/face.
    const p = f.at ?? [f.cx, f.cy, f.cz];
    const rc = result.recenter ?? [0, 0, 0];
    const op: PointOp = { type, at: [p[0] + rc[0], p[1] + rc[1], p[2] + rc[2]], size };
    setSelectedFeature(null);
    setSelectedFaces([]);
    setStatus("generating");
    const runOp = async (o: PointOp, note?: string) => {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), o] });
      const amount = Math.abs(o.size);
      const label =
        type === "extrude" ? `${o.size >= 0 ? "Extruded" : "Recessed"} the face by ${amount} mm`
        : type.includes("chamfer") ? `Chamfered the ${f.kind === "face" ? "face" : f.kind === "vertex" ? "corner" : "edge"} by ${amount} mm`
        : `Rounded the ${f.kind === "face" ? "face" : f.kind === "vertex" ? "corner" : "edge"} by ${amount} mm`;
      applyResult(res, project?.name ?? deriveName("Edited part"), `${label} — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`, `direct ${type}`);
      // Plain successes stay out of the chat (History records them); clamped sizes DO get
      // a message — the user asked for a number they didn't get.
      if (note) setMessages((m) => [...m, { id: mid(), role: "assistant", text: `${label}${note}` }]);
    };
    try {
      await runOp(op);
    } catch (err: any) {
      // When OCCT rejects a size, the worker probes for the biggest one that DOES fit and
      // tags it "(max=X)". Apply that instead of just complaining — and say both numbers.
      const max = Number(/\(max=([\d.]+)\)/.exec(String(err?.message ?? ""))?.[1]);
      if (max > 0 && max < Math.abs(size)) {
        try {
          await runOp(
            { ...op, size: size < 0 ? -max : max },
            ` — you asked for ${Math.abs(size)} mm, but about ${max} mm is the most that fits there, so that's what I applied. Undo if you'd rather not.`,
          );
          return;
        } catch { /* even the probed max failed in-chain — fall through to the original error */ }
      }
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: String(err?.message ?? err).replace(/ \(max=[\d.]+\)/, ""), error: true }]);
      setGeometry(result.geometry); // the op failed — clear any lingering live-drag preview
    } finally {
      setStatus("idle");
    }
  }

  // ---- Live push-pull preview: rebuild the REAL solid while the arrow drags (Shapr-style),
  // so the fillet/extrude appears on the model in real time instead of only on release.
  // Two kernels: extrude drags boolean a closed prism against the display mesh in the
  // Manifold worker (pure mesh math, ~60fps-class); fillet drags — and any Manifold
  // failure — rebuild through OCCT. One build in flight at a time; only the newest dragged
  // value is kept (coalescing). gen invalidates the loop on commit/cancel; OCCT stays the
  // source of truth (the commit always rebuilds through the CAD worker). ----
  const livePrev = useRef({ next: null as { d: number; solid: Float32Array | null } | null, running: false, gen: 0 });

  function previewDirectOp(dist: number, solid?: Float32Array | null) {
    setLiveDragMm(dist); // keep the quick-edit mm box in sync (pre-existing behaviour)
    const f = selectedFeature;
    if (!f || !result || result.source.kind !== "code" || !sel || activeKind !== "replicad") return;
    const lp = livePrev.current;
    lp.next = { d: dist, solid: solid ?? null };
    if (lp.running) return;
    lp.running = true;
    const gen = lp.gen;
    // Snapshot the drag's inputs once — they are fixed for the drag's duration.
    const baseGeom = result.geometry;
    const src = result.source;
    const rc0 = result.recenter ?? [0, 0, 0];
    const p = f.at ?? [f.cx, f.cy, f.cz];
    const at: [number, number, number] = [p[0] + rc0[0], p[1] + rc0[1], p[2] + rc0[2]];
    const type: PointOp["type"] = f.kind === "face" ? "extrude" : "fillet";
    void (async () => {
      try {
        while (lp.next !== null && lp.gen === gen) {
          const { d, solid: prism } = lp.next;
          lp.next = null;
          const size = type === "extrude" ? d : Math.abs(d);
          if (Math.abs(size) < 0.05) continue;

          // Fast path: Manifold boolean of the prism against the committed display mesh.
          // Same display coords in and out — no recenter drift correction needed.
          if (prism && type === "extrude") {
            try {
              if (await previewSetBase(baseGeom)) {
                const pos = await previewBoolean(prism, d);
                if (lp.gen !== gen) break;
                if (pos) {
                  const g = new THREE.BufferGeometry();
                  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
                  g.computeVertexNormals(); // soup → flat per-face normals, the CAD look
                  g.userData.preview = true; // viewer skips per-tick frills (edge overlay)
                  setGeometry(g);
                  continue;
                }
              }
            } catch { /* fall through to the OCCT preview */ }
            if (lp.gen !== gen) break;
          }

          try {
            const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), { type, at, size }], preview: true });
            if (lp.gen !== gen) break; // committed/cancelled while building — drop it
            // Hold the display frame steady mid-drag: each rebuild recentres against its NEW
            // bounds, which would make the model creep under the arrow. Shift the preview back
            // into the pre-drag frame; the commit snaps to the proper frame as it always did.
            const rc1 = res.recenter ?? [0, 0, 0];
            const [dx, dy, dz] = [rc1[0] - rc0[0], rc1[1] - rc0[1], rc1[2] - rc0[2]];
            if (dx || dy || dz) res.geometry.translate(dx, dy, dz);
            res.geometry.userData.preview = true; // viewer skips per-tick frills (edge overlay)
            setGeometry(res.geometry);
          } catch { /* past the feasible limit at this size — keep the last good preview */ }
        }
      } finally {
        lp.running = false;
      }
    })();
  }

  /** Select/deselect the whole part: bounding box + anchors AND the move gizmo, Spline-style —
   *  selecting an object IS having transform handles on it. Other tools stand down. */
  function selectAttach(id: string | null, additive = false) {
    if (!id) {
      setSelAttachIds([]);
      setTransformMode("off");
      return;
    }
    setSelAttachIds((sids) => (additive ? (sids.includes(id) ? sids.filter((x) => x !== id) : [...sids, id]) : [id]));
    setModelSelected(false);
    setTransformMode("move");
    setSelectMode(false);
    setMeasureMode(false);
    setSelectedFeature(null);
    setSelectedFaces([]);
  }

  function selectModel(sel: boolean) {
    setModelSelected(sel);
    if (sel) setSelAttachIds([]);
    setTransformMode(sel ? "move" : "off");
    if (sel) {
      setSelectMode(false);
      setMeasureMode(false);
      setActivePinId(null);
      setPinText("");
      setSelectedFeature(null);
      setSelectedFaces([]);
    }
  }

  /** "Put an Apple logo on the back": ask the AI to DRAW the emblem as clean SVG paths,
   *  extrude it, and drop it on the model as a movable attachment — position, then Merge. */
  async function aiLogoToAttachment(request: string) {
    const ph = mid();
    setMessages((m) => [...m, { id: mid(), role: "user", text: request }, { id: ph, role: "assistant", text: "Drawing the logo as clean vector paths…", streaming: true }]);
    setStatus("generating");
    try {
      let effLlm: LlmSettings = llm.provider === "anthropic" ? { ...llm, model } : llm;
      if (effLlm.provider === "openrouter" && effLlm.model === AUTO_MODEL) {
        const pick = pickAutoModel(cachedOpenRouterModels(), { prompt: request, isEdit: true });
        if (pick) effLlm = { ...effLlm, model: pick.model.id };
      }
      const system = [
        "You draw clean, single-colour vector emblems for 3D printing.",
        "Return ONLY one <svg> element and nothing else: viewBox=\"0 0 100 100\", solid filled paths (fill=\"black\"), no strokes, no <text>, no gradients, no clip-paths.",
        "Closed, non-self-intersecting paths; the shape centred and filling most of the viewBox.",
      ].join(" ");
      const raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system, [{ role: "user", content: `Draw: ${request}` }], {}, effectiveProxy);
      const svgText = /<svg[\s\S]*?<\/svg>/i.exec(raw)?.[0];
      if (!svgText) throw new Error("the model didn't return a usable SVG — try rephrasing (e.g. \"a minimalist apple silhouette logo\")");
      const { geometry: g, dims: d } = extrudeSvg(svgText, { sizeMm: 25, heightMm: 0.8 });
      addAttachment(g, request.match(/\b([a-z0-9-]+)\s+(?:logo|emblem|badge|icon|symbol)/i)?.[1] ?? "logo");
      setMessages((m) => m.map((x) => (x.id === ph ? { ...x, streaming: false, model: shortModelName(effLlm.model), text: `Drew it and placed it on the model as a new object (${d.x} × ${d.y} mm, 0.8 mm raised). Drag the arrows to position it on the back, corner dots to resize, then **Merge** in the Objects panel to make it part of the case. Not right? ✕ removes it — ask again with more detail.` } : x)));
    } catch (err: any) {
      setMessages((m) => m.map((x) => (x.id === ph ? { ...x, streaming: false, error: true, text: `Couldn't draw that logo: ${String(err?.message ?? err)}` } : x)));
    } finally {
      setStatus("idle");
    }
  }

  /** Fuse attachments into the model via the Manifold worker → one printable mesh.
   *  `ids` = which objects to merge (undefined = all of them), unioned one at a time. */
  async function mergeAttachments(ids?: string[]) {
    const targets = attachments.filter((a) => !ids || ids.includes(a.id));
    if (!targets.length || !geometry || !result) return;
    setStatus("generating");
    try {
      let baseGeom = geometry;
      let g: THREE.BufferGeometry | null = null;
      for (const t of targets) {
        const baked = viewer.current?.bakeAttachment(t.id);
        if (!baked) throw new Error(`couldn't read ${t.name}'s placement`);
        if (!(await previewSetBase(baseGeom))) throw new Error("this model's mesh couldn't be welded for a boolean");
        const pos = await previewBoolean(baked, 1);
        if (!pos) throw new Error(`the union with ${t.name} failed — try moving it so it overlaps`);
        g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        baseGeom = g;
      }
      g!.computeVertexNormals();
      g!.computeBoundingBox();
      const sz = g!.boundingBox!.getSize(new THREE.Vector3());
      const dims = { x: Math.round(sz.x * 10) / 10, y: Math.round(sz.y * 10) / 10, z: Math.round(sz.z * 10) / 10 };
      const names = targets.map((t) => t.name).join(" + ");
      const res: EngineResult = {
        kind: "generative",
        geometry: g!,
        dims,
        source: { kind: "gen", provider: "merge", model: names },
        supportsStep: false,
        glb: geometryToSTL(g!),
      };
      // The merged arrangement is committed for real — the dry-fit sandbox (if any) is
      // over. Forget it WITHOUT dissolving, so any not-yet-merged separated parts
      // survive as ordinary objects instead of vanishing with the sandbox.
      separatedRef.current = null;
      setSeparated(false);
      applyResult(res, `${project?.name ?? "Model"} + ${names}`, `Merged ${names} into the model — ${dims.x} × ${dims.y} × ${dims.z} mm`, `merge ${names}`);
      const mergedIds = new Set(targets.map((t) => t.id));
      setAttachments((a) => a.filter((x) => !mergedIds.has(x.id)));
      setSelAttachIds([]);
      setTransformMode("off");
      setModelSelected(false);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Merged **${names}** into the model — one printable solid now (mesh: STL/3MF; STEP needs the pre-merge version in History). Undo brings the pieces back.` }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't merge: ${String(err?.message ?? err)}`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Physical surface texture: subdivide + displace the current model's mesh (any kind).
   *  CAD models become meshes here — precision-edit first, texture last (History keeps both). */
  async function applySurfaceTexture(pattern: "knurl" | "honeycomb" | "noise", scale: number, depth: number) {
    if (!geometry || !result) return;
    setStatus("generating");
    try {
      const src = geometry.index ? geometry.toNonIndexed() : geometry;
      const positions = new Float32Array(src.getAttribute("position").array as Float32Array);
      if (src !== geometry) src.dispose();
      const pos = await displaceMesh(positions, { pattern, scale, depth });
      if (!pos) throw new Error("this mesh couldn't be welded into a closed solid");
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.computeBoundingBox();
      const sz = g.boundingBox!.getSize(new THREE.Vector3());
      const dims = { x: Math.round(sz.x * 10) / 10, y: Math.round(sz.y * 10) / 10, z: Math.round(sz.z * 10) / 10 };
      const res: EngineResult = {
        kind: "generative",
        geometry: g,
        dims,
        source: { kind: "gen", provider: "texture", model: pattern },
        supportsStep: false,
        glb: geometryToSTL(g),
      };
      const wasCad = activeKind === "replicad";
      applyResult(res, project?.name ?? deriveName("Textured part"), `${pattern} surface texture (${depth} mm) — ${dims.x} × ${dims.y} × ${dims.z} mm`, `texture ${pattern}`);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Applied a **${pattern}** surface texture (${depth} mm ${depth >= 0 ? "raised" : "engraved"}, ${scale} mm cells) — it's real printable geometry now.${wasCad ? " The model became a mesh (STL/3MF; the parametric CAD version stays in History/Undo)." : ""}` }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't texture this model: ${String(err?.message ?? err)}`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Inspector edit: uniform-scale the part so the given axis hits `target` mm. */
  function scaleToDim(axis: "x" | "y" | "z", target: number) {
    if (!geometry || !dims) return;
    const factor = target / dims[axis];
    if (!Number.isFinite(factor) || factor <= 0.001) return;
    geometry.computeBoundingBox();
    const c = geometry.boundingBox!.getCenter(new THREE.Vector3());
    void authorObjectOp({ kind: "scale", factor: Math.round(factor * 1000) / 1000, center: [c.x, c.y, c.z] });
  }

  /** Commit a whole-body transform-gizmo drag as ONE parametric op (rotate/scale). The gizmo
   *  reports its pivot in display coords; map the pivot centre back to engine coords (+recenter),
   *  exactly like applyDirectOp does for picked points. No AI, no tokens. */
  async function authorObjectOp(commit: TransformCommit) {
    if (!result || result.source.kind !== "code" || !sel || activeKind !== "replicad") return;
    const src = result.source;
    const rc = result.recenter ?? [0, 0, 0];
    // translate.delta is a pure vector — recenter-invariant. rotate/scale pivot about a picked
    // centre, which is in display coords → map it back to engine coords (+recenter).
    let op: CadOp;
    if (commit.kind === "translate") {
      op = { type: "translate", delta: commit.delta };
    } else {
      const c = commit.center;
      const center: [number, number, number] = [c[0] + rc[0], c[1] + rc[1], c[2] + rc[2]];
      op = commit.kind === "rotate"
        ? { type: "rotate", axis: commit.axis, angleDeg: commit.angleDeg, center }
        : { type: "scale", factor: commit.factor, center };
    }
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), op] });
      const label =
        commit.kind === "translate"
          ? "Moved the part"
          : commit.kind === "rotate"
          ? `Rotated ${Math.round(commit.angleDeg)}°`
          : `Scaled to ${Math.round(commit.factor * 100)}%`;
      applyResult(res, project?.name ?? deriveName("Edited part"), `${label} — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`, `transform ${commit.kind}`);
      // Routine transforms stay out of the chat — History and the status bar record them.
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Measure tool: first click sets an anchor, second click records a point-to-point
   *  measurement (a labelled distance line in the viewer). No AI, no model change. */
  function onMeasurePoint(p: [number, number, number]) {
    if (!measurePending) { setMeasurePending(p); return; }
    setMeasurements((m) => [...m, { id: mid(), a: measurePending, b: p }]);
    setMeasurePending(null);
  }
  /** Drag-a-line measure: both ends arrive at once (viewer-side tape drag). */
  function onMeasureSegment(a: [number, number, number], b: [number, number, number]) {
    setMeasurements((m) => [...m, { id: mid(), a, b }]);
    setMeasurePending(null); // a stray earlier single click shouldn't chain into the next one
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
    if (pendingRef.current) discardPending(true); // a new ask supersedes the held proposal
    const p = promptText.trim();
    if (status === "generating") return;
    if (forceMode && forceMode !== mode) setMode(forceMode); // keep the UI switch in sync
    // "Add a <thing> logo/emblem" while a model exists → the AI DRAWS it as SVG and it
    // lands as a movable attachment — far cleaner than regenerating the whole part.
    if (p && result && geometry && (forceMode ?? mode) === "precise"
      && /\b(logo|emblem|badge|crest|icon|silhouette|symbol)\b/i.test(p)
      && llmReady(llm.provider === "anthropic" ? { ...llm, model } : llm, { anthropic: key, ...llmKeys })) {
      await aiLogoToAttachment(p);
      return;
    }

    // Fresh chat + the user never touched the engine switch → route by what the words
    // describe. Organic/sculptural things are beyond CAD's reach and belong on the mesh
    // engine; dimensioned functional parts belong in CAD. One notice, one tap to override.
    let routedMode: Mode | null = null;
    if (!forceMode && !result && !modeTouched.current && p) {
      const organic = ORGANIC_RE.test(p) && !CADISH_RE.test(p);
      const cadish = CADISH_RE.test(p) && !ORGANIC_RE.test(p);
      if (mode === "precise" && organic) routedMode = "generative";
      else if (mode === "generative" && cadish) routedMode = "precise";
      if (routedMode) {
        setMode(routedMode);
        setMessages((m) => [...m, {
          id: mid(), role: "assistant",
          text: routedMode === "generative"
            ? "This sounds organic/sculptural — I routed it to **Generative (AI mesh)**, which models freeform shapes far better than CAD. Tap Precise (CAD) above to override."
            : "This sounds like a dimensioned, functional part — I routed it to **Precise (CAD)** for exact measurements and STEP export. Tap Generative (AI mesh) above to override.",
        }]);
      }
    }
    // The mode switch decides: Generative -> mesh provider; Precise + photo -> vision CAD.
    const useGen = (routedMode ?? forceMode ?? mode) === "generative";

    if (useGen) {
      if (!p && !image) return;
      let ge = override?.genEng ?? genEng; // retry-with-model can override the engine
      if (ge.provider === "auto") {
        const pick = pickAutoGenEngine({ hasImage: !!image, prompt: p, hasKey: (id) => !!providerKeys[id] });
        ge = { provider: pick.provider, model: pick.model };
        setAutoPick(`Auto → ${pick.label} (${pick.reason})`);
      } else {
        setAutoPick("");
      }
      const prov = getProvider(ge.provider);
      if (prov?.needsKey && !providerKeys[prov.id]) {
        setShowSettings(true);
        return;
      }
      // Web-grounded dimensions for TEXT mesh prompts that name a real product — the same
      // lookup Precise uses, so "a phone stand for an iPhone 17 Pro" is proportioned from
      // real numbers. Skipped for photo inputs (the photo IS the reference).
      let genPrompt = p;
      if (p && !image && detectProductQuery(p)) {
        const rk = { geminiKey: llmKeys["gemini"], geminiModel: llm.provider === "gemini" ? llm.model : "", anthropicKey: key, openrouterKey: llmKeys["openrouter"], openrouterModel: llm.provider === "openrouter" ? llm.model : "" };
        if (canResearch(rk)) {
          try {
            const genCtx = result && project ? `the part "${project.name}"` : undefined;
            const rr = await researchDimensions(p, rk, genCtx);
            if (rr) {
              genPrompt = `${p}\n\nReal product measurements (researched online, mm):\n${rr.text}`;
              setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Measurements found online:\n${rr.text}`, sources: rr.sources }]);
            }
          } catch { /* research is best-effort */ }
        }
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
        const res = await genEngine.current.build({ kind: "gen", image: image?.blob, views: { left: views.left?.blob, back: views.back?.blob, right: views.right?.blob }, prompt: genPrompt || undefined, provider: ge.provider, model: genModel });
        const name = deriveName(p || "Photo model");
        const summary = `Generated a mesh — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm (${prov?.label ?? ge.provider})`;
        const how = await deliverResult(res, name, summary, p || "(image upload)", true);
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: summary + (how === "pending" ? " — it's on the canvas as a preview: Apply to keep it, or Discard." : ""), streaming: false } : x)));
      } catch (err: any) {
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: friendlyNet(String(err?.message ?? err)), error: true, streaming: false } : x)));
      } finally {
        setStatus("idle");
      }
      return;
    }

    // ---- precise (LLM -> replicad/primitive; photo = vision -> exact CAD) ----
    if (!p && !image) return;
    let effLlm: LlmSettings = override?.llm ?? (llm.provider === "anthropic" ? { ...llm, model } : llm); // retry-with-model override
    // OpenRouter "Auto": classify this request and pick a concrete model (cheap-fast
    // for small edits, strong/reasoning for fresh or complex work) so the user doesn't
    // hand-pick among hundreds — and we don't pay for a big model on a tiny edit.
    if (effLlm.provider === "openrouter" && effLlm.model === AUTO_MODEL) {
      const pick = pickAutoModel(cachedOpenRouterModels(), { prompt: promptText, isEdit: !!result, hasImage: !!image });
      const chosen = pick?.model.id ?? llmPreset("openrouter").defaultModel;
      effLlm = { ...effLlm, model: chosen };
      setAutoPick(pick ? `Auto → ${shortModelName(chosen)} (${pick.reason})` : `Auto → ${shortModelName(chosen)}`);
    } else if (effLlm.provider === "openrouter" && image && cachedOpenRouterModels().find((x) => x.id === effLlm.model)?.vision === false) {
      // Hand-picked model that can't SEE the attached photo → OpenRouter 404s ("No
      // endpoints found that support image input"). Swap to a vision pick and say so.
      const pick = pickAutoModel(cachedOpenRouterModels(), { prompt: promptText, isEdit: !!result, hasImage: true });
      if (pick) {
        const from = shortModelName(effLlm.model);
        effLlm = { ...effLlm, model: pick.model.id };
        setAutoPick(`${from} can't see photos → ${shortModelName(pick.model.id)}`);
      } else {
        setAutoPick("");
      }
    } else {
      setAutoPick("");
    }
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
    // "Circle it and ask": a marked screenshot of the CURRENT model edits the existing
    // program (the marker is a pointer), unlike a photo which rebuilds from scratch.
    const markupEdit = !!visionImage?.markup && kind === "replicad" && result?.source.kind === "code" && !!result.source.code;
    const markupCode = markupEdit && result?.source.kind === "code" ? result.source.code ?? "" : "";
    // The circle was raycast into the scene when drawn — hand the AI the exact program-
    // frame coordinates it covers, so "the marked region" isn't guesswork.
    let markupRegionLine = "";
    if (markupEdit && visionImage?.region) {
      const rg = visionImage.region;
      const rc0 = result?.recenter ?? [0, 0, 0];
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const lo = rg.min.map((v, i) => r1(v + rc0[i]));
      const hi = rg.max.map((v, i) => r1(v + rc0[i]));
      const cc = rg.centroid.map((v, i) => r1(v + rc0[i]));
      markupRegionLine = ` The marked region maps to these coordinates in the program's own frame (mm, Z-up): x ${lo[0]} to ${hi[0]}, y ${lo[1]} to ${hi[1]}, z ${lo[2]} to ${hi[2]} (centre ≈ ${cc.join(", ")}); the circled surface faces roughly (${rg.normal.join(", ")}). The feature(s) whose geometry lies in that box are the target.`;
    }
    setInput("");
    setStreamingText("");
    setStreamingThink("");
    setMessages((m) => [...m, { id: mid(), role: "user", text: p || (visionImage ? (visionImage.markup ? "Change the marked region" : "Recreate this part") : ""), image: visionThumb, mode: "precise" }]);
    const placeholderId = mid();
    setMessages((m) => [...m, { id: placeholderId, role: "assistant", text: "Thinking…", streaming: true }]);
    setStatus("generating");

    // Product research: when the request names a real-world product ("a case
    // for my iPhone 17 Pro"), look up its exact measurements on the web first
    // so the CAD code is built from real numbers instead of guesses. Runs via
    // Gemini's free search grounding or Claude's web-search tool; best-effort —
    // if neither key is set or the lookup fails, generation continues as before.
    let researched: string | null = null;
    let researchSources: { url: string; title?: string }[] = [];
    // Web research is gated by the composer's Web toggle:
    //   On   → always look up the web before building
    //   Auto → smart: only when the request names a real-world product
    //   Off  → never
    // In Auto we also skip when a photo is attached (unless guided), since the
    // picture is the reference; when forced On, honor the user's explicit intent.
    const researchKeys = {
      geminiKey: llmKeys["gemini"],
      geminiModel: llm.provider === "gemini" ? llm.model : "",
      anthropicKey: key,
      openrouterKey: llmKeys["openrouter"],
      openrouterModel: llm.provider === "openrouter" ? llm.model : "",
    };
    // Text-only web research is pointless — and actively confusing — when a photo IS the
    // reference and the prompt names no product ("make it look like this"): the research model
    // never sees the image, so it replies "no image was provided". Only research with an image
    // attached when the text actually names a real product to look up (e.g. "iPhone 16 Pro case").
    const productNamed = detectProductQuery(p);
    // The researcher can't see the chat — tell it what's already on the canvas so it
    // never asks "what is this part?" about a model the user is simply editing.
    const partBlurb = messages.find((m) => m.role === "assistant" && !m.error && !m.streaming)?.text.split("\n")[0]?.slice(0, 220) ?? "";
    const partContext = result && project
      ? `the part "${project.name}"${dims ? `, currently ${Math.round(dims.x * 10) / 10} × ${Math.round(dims.y * 10) / 10} × ${Math.round(dims.z * 10) / 10} mm` : ""}${partBlurb ? ` — ${partBlurb}` : ""}`
      : undefined;
    const wantWeb = !!p
      && (!visionImage || guided || productNamed)
      && (webMode === "on" || (webMode === "auto" && productNamed && (!visionImage || guided)));
    if (wantWeb && webMode === "on" && !canResearch(researchKeys)) {
      // Forced on but no browsing-capable key — tell the user rather than silently skip.
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Web search needs a Google Gemini (free), Claude, or OpenRouter key — add one in Settings → AI brain, or switch the Web toggle to Auto/Off.", error: true }]);
    } else if (wantWeb) {
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "Researching the product's dimensions online…", streaming: true } : x)));
      const rr = await researchDimensions(p, researchKeys, partContext);
      researched = rr?.text ?? null;
      researchSources = rr?.sources ?? [];
      if (researched) {
        // Show the found measurements as their own note, above the working placeholder —
        // with the pages the lookup actually used, so the numbers can be checked.
        setMessages((m) => {
          const idx = m.findIndex((x) => x.id === placeholderId);
          const note = { id: mid(), role: "assistant" as const, text: `Measurements found online:\n${researched}`, sources: researchSources };
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
      (visionImage ? (markupEdit ? markupAddendum(visionImage.view ? viewPhrase(visionImage.view) : "") : VISION_ADDENDUM) : "") +
      (guided ? REPLACEMENT_ADDENDUM : "") +
      (importFileRef.current ? IMPORT_ADDENDUM : "") +
      // Anchor every turn to what's on the canvas — requests like "add a hole in the
      // center" refer to THIS part; never ask the user what the part is.
      (partContext ? `\n\nCurrent canvas: the user is working on ${partContext}. Edit requests refer to this part.` : "");
    const userMsg: ApiMsg = visionImage
      ? {
          role: "user",
          content: [
            { type: "image", mediaType: visionImage.blob.type || "image/png", dataBase64: visionThumb!.split(",")[1] },
            {
              type: "text",
              text: markupEdit
                ? `Here is the current replicad program:\n\`\`\`js\n${markupCode}\n\`\`\`\n\nThe screenshot shows this model as currently rendered; the red marker circles the region to change.${markupRegionLine}\nApply this change there: ${p || "improve the marked region"}${extras}`
                : (p || "Recreate this part as precise, printable CAD. Estimate dimensions from the photo.") + extras,
            },
          ],
        }
      : { role: "user", content: pWithFacts };
    // Cap the rolling context so long sessions don't slow down / blow the window.
    let history: ApiMsg[] = [...apiHistory.current.slice(-16), userMsg];
    let finalRaw = "";
    let lastThink = ""; // final reasoning text, attached to the reply for later reading
    let ok = false;
    let lastErrMsg = ""; // stop early when retries hit the IDENTICAL wall — don't burn 3 slow AI calls

    // ---- edit-block fast path: for a small change to an existing CAD program, ask the
    // model for only the changed lines (SEARCH/REPLACE), apply + re-execute locally, and
    // save output tokens. Fully guarded — ANY problem falls through to the full-regen loop
    // below, so this can only ever save cost, never break an edit.
    const editing =
      kind === "replicad" && !visionImage && !guided && result?.source.kind === "code" && !!result.source.code;
    const currentCode = editing && result?.source.kind === "code" ? result.source.code ?? "" : "";
    const currentOps = result?.source.kind === "code" ? result.source.ops : undefined;
    if (editing && currentCode) {
      try {
        const editMsg: ApiMsg = {
          role: "user",
          content:
            `Here is the current replicad program:\n\`\`\`js\n${currentCode}\n\`\`\`\n\n` +
            `Apply this change: ${pWithFacts}\n\nReply with SEARCH/REPLACE blocks only (see EDIT MODE).`,
        };
        // Include the recent conversation so the edit has full context — the user may refer back
        // to earlier turns ("make it match what I said before"). The edit-block savings are on
        // OUTPUT tokens (only changed lines come back), so adding input history keeps them intact.
        const editHistory: ApiMsg[] = [...apiHistory.current.slice(-12), editMsg];
        const raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system + EDIT_BLOCK_ADDENDUM, editHistory, { onToken: (_t, full) => setStreamingText(full), onThinking: (_t, full) => { lastThink = full; setStreamingThink(full); } }, effectiveProxy);
        finalRaw = raw;
        const newCode = hasEditBlocks(raw) ? applyEditBlocks(currentCode, parseEditBlocks(raw)) : extractJsBlock(raw);
        if (newCode && newCode.trim() && newCode !== currentCode) {
          const editParams = result?.source.kind === "code" ? result.source.params : undefined;
          const res = await sel.engine.build({ kind: "code", code: newCode, params: editParams, ops: currentOps });
          const summary = `Updated the model — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`;
          const how = await deliverResult(res, project?.name ?? deriveName(p), summary, p);
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: summary + (how === "pending" ? " — preview on the canvas (green = added, red = removed): Apply or Discard." : ""), streaming: false, model: shortModelName(effLlm.model), thinking: lastThink || undefined } : x)));
          // Record the resulting FULL code in history so the next turn has accurate context.
          apiHistory.current = [...apiHistory.current.slice(-16), { role: "user", content: pWithFacts }, { role: "assistant", content: "```js\n" + newCode + "\n```" }];
          ok = true;
        }
      } catch {
        /* fall through to the reliable full-regenerate loop */
      }
      if (ok) { setStatus("idle"); setStreamingText(""); setStreamingThink(""); return; }
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "Thinking…", streaming: true } : x)));
    }

    let usedLocal = effLlm.provider === "local";
    /** Reachability failures only (fetch/network errors, timeouts, provider/relay
        5xx) — a model's bad output or a key problem must NOT quietly swap brains. */
    const isNetErr = (err: any) =>
      /failed to fetch|networkerror|load failed|err_internet|err_network|err_connection|timed? ?out|http 5\d\d|bad gateway|service unavailable|gateway time|relay error|couldn'?t reach|cannot reach|unreachable/i.test(String(err?.message ?? err));
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        let raw: string;
        try {
          raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system, history, { onToken: (_t, full) => setStreamingText(full), onThinking: (_t, full) => { lastThink = full; setStreamingThink(full); } }, effectiveProxy);
        } catch (err: any) {
          // Cloud brain unreachable + the on-device model is already on this machine →
          // answer locally instead of failing (works fully offline).
          if (effLlm.provider === "local" || !isNetErr(err) || !localSupported() || !localDownloaded()) throw err;
          usedLocal = true;
          setMessages((m) => {
            const idx = m.findIndex((x) => x.id === placeholderId);
            const note = { id: mid(), role: "assistant" as const, text: "Couldn't reach the cloud brain — answering with the **on-device model** instead (smaller: great for simple parts, weaker on complex ones)." };
            return idx < 0 ? [...m, note] : [...m.slice(0, idx), note, ...m.slice(idx)];
          });
          raw = await generateLlm({ provider: "local", model: "" }, { anthropic: key, ...llmKeys }, system, history, { onToken: (_t, full) => setStreamingText(full), onThinking: (_t, full) => { lastThink = full; setStreamingThink(full); } }, effectiveProxy);
        }
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
          const how = await deliverResult(res, name, summary, p, !!visionImage);
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: summary + (how === "pending" ? " — preview on the canvas (green = added, red = removed): Apply or Discard." : ""), streaming: false, model: usedLocal ? "on-device" : shortModelName(effLlm.model), thinking: lastThink || undefined } : x)));
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

  /** One tap on a gallery card: build the canned parametric program — no AI, no key.
      Always lands in a FRESH project (startNew), so it never buries the user's work. */
  async function loadTemplate(t: Template) {
    if (status === "generating") return;
    setShowTemplates(false);
    setEntered(true);
    if (projectRef.current || messages.length) startNew();
    setMode("precise");
    let s = sel;
    if (!s) {
      setBooting(true);
      s = await getEngineSelection(); // same memoized boot as the effect — no double kernel
      setSel(s);
      setBooting(false);
    }
    if (s.kind !== "replicad") {
      setMessages([{ id: mid(), role: "assistant", text: "Templates need the full CAD kernel, which couldn't load in this browser — try reloading the page.", error: true }]);
      return;
    }
    setStatus("generating");
    try {
      const res = await s.engine.build({ kind: "code", code: t.code });
      applyResultNoCommit(res);
      // Commit into a NEW project directly (the closure's `project` is stale after startNew).
      const snap = appendVersion(newProject(t.name, res.kind), {
        engine: res.kind,
        summary: t.summary,
        code: t.code,
        dims: res.dims,
      });
      projectRef.current = snap; // the chat-sync effect must append to THIS project, not spawn a shell
      persist(snap);
      setMessages([{ id: mid(), role: "assistant", text: t.summary }]);
    } catch (err: any) {
      setMessages([{ id: mid(), role: "assistant", text: `Couldn't build the ${t.name} template: ` + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
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

  // Rebuild the viewer from a project's HEAD (live) fields — shared by restore, undo/redo,
  // and opening a project. Does not append or persist; the caller owns that.
  async function rebuildHead(next: Project) {
    seedHistory(next.engine, next.code, next.spec);
    clearImage();
    if (next.engine === "generative" && next.glb) {
      await showFromGlb(next.glb, { kind: "gen", provider: next.genSource?.provider ?? "", model: next.genSource?.model ?? "", prompt: next.genSource?.prompt });
    } else if (sel) {
      if (sel.engine.setImport) {
        await sel.engine.setImport(next.importFile ?? null);
        importFileRef.current = next.importFile ?? null;
      }
      const bi: BuildInput =
        next.engine === "replicad"
          ? { kind: "code", code: next.code ?? "", params: next.params, ops: next.ops }
          : { kind: "spec", spec: parseSpec(JSON.stringify(next.spec)) };
      applyResultNoCommit(await sel.engine.build(bi));
    }
  }

  async function restoreTo(versionId: string) {
    if (!project) return;
    dissolveSeparation(); // restoring rebuilds the model — drop the sandbox's floating parts
    const next = restoreVersion(project, versionId);
    persist(next);
    try {
      await rebuildHead(next);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restored an earlier version." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restore failed to rebuild: " + String(err?.message ?? err), error: true }]);
    }
  }

  // Undo/redo step HEAD back/forward over the append-only version history, without
  // appending — so a redo stays available until the next real edit.
  const hIdx = project ? headIndex(project) : -1;
  // While the dry-fit sandbox is open, Undo means "regroup" — that's the last action.
  const canUndo = separated || (!!project && hIdx > 0);
  const canRedo = !!project && hIdx >= 0 && hIdx < project.versions.length - 1;
  const [navBusy, setNavBusy] = useState(false);
  async function stepHead(dir: -1 | 1) {
    if (!project || navBusy) return;
    const i = headIndex(project);
    const target = project.versions[i + dir];
    if (!target) return;
    setNavBusy(true);
    dissolveSeparation(); // the rebuild below replaces the model — floating split parts must not linger
    const next = navigateHead(project, target.id);
    persist(next);
    setActivePinId(null);
    setSelectedFeature(null);
    try {
      await rebuildHead(next);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: (dir < 0 ? "Undo" : "Redo") + " failed to rebuild: " + String(err?.message ?? err), error: true }]);
    } finally {
      setNavBusy(false);
    }
  }
  const undo = () => {
    if (separatedRef.current) regroupParts(); // un-separate first; history stays untouched
    else void stepHead(-1);
  };
  const redo = () => stepHead(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return; // don't hijack typing (let the field's own undo work too)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) { if (canRedo) redo(); }
        else if (canUndo) undo();
        return;
      }
      // 1–4 switch the Select tool's mode (Face / Edge / Corner / Point) while it's on.
      if (selectMode && !e.metaKey && !e.ctrlKey && !e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        const k = (["face", "edge", "vertex", "point"] as SelectKind[])[Number(e.key) - 1];
        setSelectKind(k);
        if (k === "point") setSelectedFeature(null); else { setActivePinId(null); setPinText(""); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, canRedo, hIdx, navBusy, project, selectMode]);

  async function openProjectById(p: Project) {
    setShowLibrary(false);
    setGeometry(null); // clear first so the newly-opened project gets framed (not left at the old camera)
    setProject(p);
    setMessages((p.chat ?? []).map((c) => ({ id: mid(), role: c.role, text: c.text, error: c.error, image: c.image })));
    setPins(p.pins ?? []);
    setPlateOf(p.plates?.of ?? {});
    setPlateCount(p.plates?.count ?? 1);
    setPlateNames(p.plates?.names ?? {});
    setActivePlate(0);
    separatedRef.current = null;
    setSeparated(false);
    setAttachments([]);
    setSelAttachIds([]);
    setActivePinId(null);
    setGuided(false); // guided is a per-session intent — don't leak it into another project
    setMode(p.engine === "generative" ? "generative" : "precise");
    try {
      await rebuildHead(p);
    } catch {
      /* leave viewer empty if HEAD doesn't rebuild */
    }
  }

  function startNew() {
    localStorage.removeItem("moldable_last_project");
    projectRef.current = null;
    setPins([]);
    setPlateOf({});
    setPlateCount(1);
    setPlateNames({});
    setActivePlate(0);
    separatedRef.current = null;
    setSeparated(false);
    setAttachments([]);
    setSelAttachIds([]);
    setActivePinId(null);
    setSelectMode(false);
    setSelectedFeature(null);
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
    return <KeyCard model={model} onContinue={saveKey} onExample={loadExample} onTemplates={() => { setEntered(true); setShowTemplates(true); }} onFree={enterFree} />;
  }

  return (
    <>
      <Workspace
        projectName={project?.name ?? "Untitled part"}
        onRename={renameProject}
        activeKind={activeKind}
        genLabel={genEng.provider === "auto" ? "Auto — best engine" : getProvider(genEng.provider)?.label ?? genEng.provider}
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
        setMode={(m) => { modeTouched.current = true; setMode(m); }}
        webMode={webMode}
        onCycleWeb={cycleWeb}
        guided={guided}
        onStartGuided={startGuided}
        fit={fit}
        onFit={applyFit}
        brain={{ provider: llm.provider, model: llm.provider === "anthropic" ? model : llm.model }}
        hasBrainKey={(prov) => (prov === "anthropic" ? !!key : prov === "house" ? !!house : !llmPreset(prov).needsKey || !!llmKeys[prov])}
        onPickBrain={pickBrain}
        autoPick={autoPick}
        genProvider={genEng.provider}
        genModel={genEng.model}
        hasGenKey={(prov) => { const pr = getProvider(prov); return !pr?.needsKey || !!providerKeys[prov]; }}
        onPickEngine={pickEngine}
        imageUrl={image?.url ?? null}
        imageMarkup={!!image?.markup}
        imageNote={image?.region ? `covers ≈ ${Math.max(0.1, Math.round((image.region.max[0] - image.region.min[0]) * 10) / 10)} × ${Math.max(0.1, Math.round((image.region.max[1] - image.region.min[1]) * 10) / 10)} × ${Math.max(0.1, Math.round((image.region.max[2] - image.region.min[2]) * 10) / 10)} mm` : null}
        onPickImage={pickImage}
        onMarkup={attachMarkup}
        onClearImage={clearImage}
        aiPreview={{
          active: !!pending,
          hasDiff: !!pending?.diff,
          apply: applyPending,
          discard: () => discardPending(),
          mode: aiApply,
          setMode: setAiApply,
        }}
        aiDiff={pending?.diff ?? null}
        holeCtl={{
          draft: holeDraft,
          canStart: !!selectedFeature && selectedFeature.kind === "face" && !selectedFeature.curved && activeKind === "replicad",
          axes: holeDraft ? holeAxes(holeDraft.normal) : null,
          start: startHole,
          cancel: () => setHoleDraft(null),
          patch: (patch) => setHoleDraft((d) => (d ? { ...d, ...patch } : d)),
          setAxis: setHoleAxis,
          apply: () => void applyHole(),
        }}
        views={{ left: views.left?.url, back: views.back?.url, right: views.right?.url }}
        onPickView={pickView}
        onClearView={clearView}
        multiViewEngine={usesMultiView(genEng.provider, genEng.model)}
        onMeasure={() => setShowMeasure(true)}
        messages={messages}
        status={status}
        input={input}
        setInput={setInput}
        onSend={send}
        onRetryModel={retryWithModel}
        onExample={loadExample}
        onTemplate={(t) => void loadTemplate(t)}
        onOpenTemplates={() => setShowTemplates(true)}
        resume={project ? null : resume?.name ?? null}
        onResume={() => void resumeLast()}
        geometry={geometry}
        dims={dims}
        report={report}
        modelSelected={(modelSelected || transformMode !== "off") && !attachSelected}
        onModelSelect={selectModel}
        onScaleTo={scaleToDim}
        attachments={attachments}
        selAttachIds={selAttachIds}
        onAttachSelect={selectAttach}
        onMergeAttachments={(ids?: string[]) => { void mergeAttachments(ids); }}
        onRemoveAttachment={removeAttachment}
        partCount={partCount}
        separated={separated}
        separatedIds={separatedRef.current?.ids ?? []}
        onSeparateParts={separateParts}
        onRegroup={regroupParts}
        onCheckFit={(ids) => void checkFit(ids)}
        onMakeFit={(ids) => void makeItFit(ids)}
        onDropToPlate={dropToPlate}
        onRenameAttachment={renameAttachment}
        clipboardCtl={{
          canPaste: !!clipName,
          pasteName: clipName,
          copy: (t) => void copyObject(t),
          paste: () => pasteObject(),
          duplicate: duplicateObject,
        }}
        snap={snap}
        setSnap={setSnap}
        plateFor={plateFor}
        plateCtl={{
          count: plateCount,
          names: plateNames,
          rename: renamePlate,
          assign: assignPlate,
          add: addPlate,
          remove: removePlate,
          exportEach: exportPlates,
          exportProject: exportPlatesProject,
        }}
        activePlate={activePlate}
        setActivePlate={setActivePlate}
        showcase={showcase}
        setShowcase={setShowcase}
        appearance={appearance}
        setAppearance={setAppearance}
        texture={result?.texture ?? null}
        onApplySurface={(pat, sc, d) => { void applySurfaceTexture(pat, sc, d); }}
        printer={printer}
        onOpenPrinterSettings={() => { setSettingsPane("printer"); setShowSettings(true); }}
        wireframe={wireframe}
        setWireframe={setWireframe}
        showDims={dimsMode === "always" || (dimsMode === "select" && (modelSelected || transformMode !== "off") && !attachSelected)}
        dimsMode={dimsMode}
        setDimsMode={setDimsMode}
        units={units}
        setUnits={setUnits}
        viewerRef={viewer}
        tab={tab}
        setTab={setTab}
        codeText={codeBuffer}
        streamingText={streamingText}
        streamingThink={streamingThink}
        onRerun={rerun}
        cadDefaults={cadDefaults}
        paramValues={paramValues}
        onApplyParams={applyParams}
        onSaveParams={saveParamsVersion}
        onOpenSlicer={openSlicer}
        onRepair={repairMesh}
        onSimplify={simplifyMesh}
        onSplit={splitMesh}
        splitCtl={{ pieces: splitPieces, exportPiece, exportAll: exportAllPieces, clear: () => setSplitPieces(null) }}
        versions={project?.versions ?? []}
        onRestore={restoreTo}
        undoCtl={{ undo, redo, canUndo, canRedo, busy: navBusy }}
        supportsStep={result?.supportsStep ?? false}
        canExport={(f) => (result?.kind === "generative" ? genEngine.current.canExport(f) : sel?.engine.canExport(f) ?? false)}
        onExport={exportAs}
        onOpenSettings={() => { setSettingsPane("ai"); setShowSettings(true); }}
        onOpenLibrary={() => setShowLibrary(true)}
        onNew={startNew}
        pins={pins}
        pinCtl={{
          active: activePin,
          text: pinText,
          setText: setPinText,
          askAi: askAiPin,
          saveNote: savePinNote,
          del: deletePin,
          clearAll: clearAllPins,
          close: () => setActivePinId(null),
          pick: pickPin,
          select: selectPin,
        }}
        featureCtl={{
          mode: selectMode,
          toggleMode: () => setSelectMode((m) => { const on = !m; if (on) { setTransformMode("off"); setMeasureMode(false); setMeasurePending(null); } else { setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); } return on; }),
          kind: selectKind,
          // Switching mode clears the other kind's selection so only one edit target is live.
          setKind: (k) => { setSelectKind(k); setSelectedFaces([]); if (k === "point") setSelectedFeature(null); else { setActivePinId(null); setPinText(""); } },
          selected: selectedFeature,
          text: faceText,
          setText: setFaceText,
          pick: (f: PickedFeature) => { setLiveDragMm(null); pickFeature(f); },
          pickFaces,
          askAi: askAiFeature,
          directOp: applyDirectOp,
          // Drag handle: a flat face gets a drag-to-extrude arrow; an edge/corner gets a
          // drag-to-round arrow (pointing radially outward so dragging out grows the radius).
          pushArrow: (() => {
            const f = selectedFeature;
            if (!(selectMode && activeKind === "replicad" && f)) return null;
            if (selectKind === "face" && f.kind === "face" && !f.curved)
              return { center: [f.cx, f.cy, f.cz] as [number, number, number], normal: [f.nx ?? 0, f.ny ?? 0, f.nz ?? 1] as [number, number, number], kind: "extrude" as const };
            if ((selectKind === "edge" && f.kind === "edge") || (selectKind === "vertex" && f.kind === "vertex")) {
              const rad = Math.hypot(f.cx, f.cy);
              const dir: [number, number, number] = rad > 1e-3 ? [f.cx / rad, f.cy / rad, 0] : [0, 0, 1];
              return { center: [f.cx, f.cy, f.cz] as [number, number, number], normal: dir, kind: "fillet" as const };
            }
            return null;
          })(),
          pushPull: (dist: number) => {
            // End of an arrow drag: stop the live-preview loop before committing.
            livePrev.current.gen++;
            livePrev.current.next = null;
            if (Math.abs(dist) < 0.01) {
              if (result) setGeometry(result.geometry); // dragged back to ~0 → restore the real model
              return;
            }
            const f = selectedFeature;
            if (f?.kind === "face") applyDirectOp("extrude", dist);
            else applyDirectOp("fillet", Math.abs(dist));
          },
          pushLive: previewDirectOp,
          liveMm: liveDragMm,
          clear: () => {
            livePrev.current.gen++;
            livePrev.current.next = null;
            if (result) setGeometry(result.geometry); // drop any un-committed live preview
            setLiveDragMm(null);
            setSelectedFeature(null);
          },
        }}
        facesCtl={{
          faces: selectedFaces,
          text: facesText,
          setText: setFacesText,
          askAi: askAiFaces,
          directOp: (size) => void applyDirectOpFaces(size),
          clear: () => setSelectedFaces([]),
        }}
        transformCtl={{
          mode: transformMode,
          // Entering Transform turns off Select/Measure and clears any pick (one tool owns the pointer).
          setMode: (m) => { setTransformMode(m); setModelSelected(m !== "off"); if (m !== "off") { setSelectMode(false); setMeasureMode(false); setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); } },
          commit: authorObjectOp,
          busy: status === "generating",
        }}
        measureCtl={{
          mode: measureMode,
          toggle: () => setMeasureMode((on) => {
            const next = !on;
            if (next) { setSelectMode(false); setTransformMode("off"); setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); }
            else setMeasurePending(null);
            return next;
          }),
          pending: measurePending,
          items: measurements,
          point: onMeasurePoint,
          segment: onMeasureSegment,
          remove: (id) => setMeasurements((m) => m.filter((x) => x.id !== id)),
          clear: () => { setMeasurements([]); setMeasurePending(null); },
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
          aiApply={aiApply}
          onSaveAiApply={setAiApply}
          userTint={userTint}
          onSaveTint={saveUserTint}
          theme={theme}
          onSaveTheme={setThemeState}
          units={units}
          onSaveUnits={(u) => setUnits(() => u)}
          dimsMode={dimsMode}
          onSaveDimsMode={setDimsMode}
          lastSyncAt={lastSyncAt}
          onSynced={markSynced}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLibrary && <LibraryModal onOpen={openProjectById} onClose={() => setShowLibrary(false)} currentId={project?.id} />}
      {showTemplates && <TemplatesModal onPick={(t) => void loadTemplate(t)} onClose={() => setShowTemplates(false)} busy={status === "generating"} />}
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
          hasModel={!!geometry}
          initialMode={geometry ? "attach" : "extrude"}
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

/** "…, seen from the front-right and above" — orients a marked screenshot for the AI. */
function viewPhrase(v: { azimuthDeg: number; elevationDeg: number }): string {
  const az = ((v.azimuthDeg % 360) + 360) % 360;
  const names = ["front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left"];
  const horiz = names[Math.round(az / 45) % 8];
  const vert = v.elevationDeg > 55 ? ", nearly top-down" : v.elevationDeg > 25 ? " and above" : v.elevationDeg < -10 ? " and below" : "";
  return `, seen from the ${horiz}${vert}`;
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

function KeyCard({ model, onContinue, onExample, onTemplates, onFree }: { model: string; onContinue: (k: string, m: string) => void; onExample: () => void; onTemplates: () => void; onFree: () => void }) {
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
        <button className="link" onClick={onTemplates}>Or start from a template — phone stand, hooks, boxes… no key needed →</button>
        <button className="link" onClick={onExample}>Or view the built-in example model →</button>
      </div>
    </div>
  );
}

/** One visually-bounded settings group: a title, an optional one-line hint, then its
    controls — the "categorize, don't overwhelm" building block of the Settings modal. */
function SGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="sgroup">
      <div className="sgroup-head">
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </section>
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
  aiApply,
  onSaveAiApply,
  userTint,
  onSaveTint,
  theme,
  onSaveTheme,
  units,
  onSaveUnits,
  dimsMode,
  onSaveDimsMode,
  lastSyncAt,
  onSynced,
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
  initialPane?: SettingsPane;
  aiApply: "ask" | "auto";
  onSaveAiApply: (v: "ask" | "auto") => void;
  userTint: string;
  onSaveTint: (c: string) => void;
  theme: "light" | "dark";
  onSaveTheme: (t: "light" | "dark") => void;
  units: "mm" | "in";
  onSaveUnits: (u: "mm" | "in") => void;
  dimsMode: "select" | "always" | "off";
  onSaveDimsMode: (m: "select" | "always" | "off") => void;
  lastSyncAt: number | null;
  onSynced: () => void;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<SettingsPane>(initialPane ?? "ai");
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
        onSynced();
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
  // OpenRouter has hundreds of models — fetch the live catalogue so the model box
  // becomes a type-to-search picker (with prices) instead of a blind slug field.
  const [orModels, setOrModels] = useState<ORModel[]>(() => cachedOpenRouterModels());
  const [orReasoning, setOrReasoning] = useState<ReasoningEffort>(() => getReasoningEffort());
  useEffect(() => {
    if (lp === "openrouter") void fetchOpenRouterModels().then(setOrModels);
  }, [lp]);
  const orRecs = recommendedForApp(orModels);

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
          {(["ai", "mesh", "printer", "appearance", "sync"] as const).map((t) => (
            <button key={t} className={pane === t ? "on" : ""} onClick={() => setPane(t)}>
              {t === "ai" ? "AI brain" : t === "mesh" ? "3D engine" : t === "printer" ? "Printer" : t === "appearance" ? "Appearance" : "Sync"}
            </button>
          ))}
        </div>

        {pane === "appearance" && (
          <>
            <p className="pane-desc">How Moldable looks and measures.</p>
            <SGroup title="Look">
              <label>Theme</label>
              <div className="seg sm" role="radiogroup" aria-label="Theme">
                <button className={theme === "light" ? "on" : ""} onClick={() => onSaveTheme("light")}>Light</button>
                <button className={theme === "dark" ? "on" : ""} onClick={() => onSaveTheme("dark")}>Dark</button>
              </div>
              <label>Your chat bubble colour</label>
              <div className="tint-swatches">
                {BUBBLE_TINTS.map((t) => (
                  <button
                    key={t.color}
                    type="button"
                    className={`tint-swatch${userTint.toLowerCase() === t.color.toLowerCase() ? " on" : ""}`}
                    style={{ ["--sw" as string]: t.color }}
                    title={t.label}
                    aria-label={t.label}
                    onClick={() => onSaveTint(t.color)}
                  >
                    <span className="tint-dot" />
                    {t.label}
                  </button>
                ))}
              </div>
            </SGroup>
            <SGroup title="Workspace" hint="also switchable from the viewer's View menu">
              <label>Units</label>
              <div className="seg sm" role="radiogroup" aria-label="Units">
                <button className={units === "mm" ? "on" : ""} onClick={() => onSaveUnits("mm")}>Millimetres</button>
                <button className={units === "in" ? "on" : ""} onClick={() => onSaveUnits("in")}>Inches</button>
              </div>
              <label>Dimensions box</label>
              <div className="seg sm" role="radiogroup" aria-label="When to show dimensions">
                <button className={dimsMode === "select" ? "on" : ""} onClick={() => onSaveDimsMode("select")} title="Size lines appear when you select the object">On select</button>
                <button className={dimsMode === "always" ? "on" : ""} onClick={() => onSaveDimsMode("always")}>Always</button>
                <button className={dimsMode === "off" ? "on" : ""} onClick={() => onSaveDimsMode("off")}>Off</button>
              </div>
            </SGroup>
          </>
        )}

        {pane === "ai" && (
          <>
            <p className="pane-desc">The brain that writes your CAD code in <b>Precise</b> mode.</p>
            <SGroup title="Brain" hint="Gemini & Groq have free tiers · Claude is the most accurate">
            <label>Provider</label>
            <select
              value={lp}
              onChange={(e) => {
                const np = e.target.value as LlmProviderId;
                setLp(np);
                setLmodel(np === "anthropic" ? "" : llmPreset(np).defaultModel);
              }}
            >
              {LLM_PRESETS.filter((pr) => (pr.id !== "house" || !!houseStatusNow()) && (pr.id !== "local" || localSupported())).map((pr) => (
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
                <li><b>One key for all of them</b> — OpenRouter. Pick from the “Recommended for precise CAD” list (Claude, GPT, Gemini Pro, DeepSeek…); some are free. Prices vary per model.</li>
                <li><b>Thinking / reasoning</b> — models tagged “thinks” (DeepSeek R1, o-series, Gemini/Claude reasoning) work through tricky geometry step-by-step before writing code — more accurate on complex parts, a bit slower. Turn thinking up or off under OpenRouter → “Thinking (reasoning)”.</li>
                <li><b>Fastest / most private</b> — Groq (free tier) / Ollama (free, runs on your machine).</li>
              </ul>
              <p className="fine">These pick the <b>Precise (CAD)</b> brain that writes accurate parametric models. The <b>Generative</b> mesh engines (photo/text → mesh) live in the “3D engine” tab.</p>
              <p className="fine">Tip: name a real product — "a case for my iPhone 17 Pro" — and with the composer’s <b>Web</b> toggle on Auto/On, Moldable looks up its exact dimensions online first (via Gemini, Claude, or OpenRouter’s web plugin).</p>
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
                {lp === "openrouter" && (
                  <>
                    <label>Model choice</label>
                    <div className="or-recs">
                      <button
                        type="button"
                        className={`or-rec${lmodel === AUTO_MODEL ? " on" : ""}`}
                        onClick={() => setLmodel(AUTO_MODEL)}
                        title="Auto — Moldable picks the model per request: a cheap-fast model for small edits, a strong reasoning model for new or complex parts. Saves tokens."
                      >
                        Auto
                        <span className="or-think" title="Picks a model per request">smart</span>
                      </button>
                    </div>
                    <p className="fine">Auto = Moldable picks per request (cheap model for small edits, strong reasoning model for new/complex parts) to save tokens.</p>
                  </>
                )}
                {lp === "openrouter" && orRecs.length > 0 && (
                  <>
                    <label>Recommended for precise CAD</label>
                    <div className="or-recs">
                      {orRecs.map((mm) => (
                        <button
                          type="button"
                          key={mm.id}
                          className={`or-rec${lmodel === mm.id ? " on" : ""}`}
                          onClick={() => setLmodel(mm.id)}
                          title={`${mm.id}${fmtORPrice(mm.inPrice) ? ` · ${fmtORPrice(mm.inPrice)}` : ""}${mm.reasoning ? " · thinks (reasoning)" : ""}`}
                        >
                          {shortModelName(mm.id)}
                          {mm.reasoning && <span className="or-think" title="Reasoning / thinking model">thinks</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {lp === "openrouter" ? (
                  <details className="adv">
                    <summary>More models &amp; thinking effort</summary>
                    <label>Model — type to search all</label>
                    <input
                      value={lmodel}
                      onChange={(e) => setLmodel(e.target.value)}
                      placeholder={lpre.defaultModel || "model-name"}
                      list="openrouter-models"
                      autoComplete="off"
                    />
                    <datalist id="openrouter-models">
                      {orModels.map((mm) => (
                        <option key={mm.id} value={mm.id}>{mm.name}{mm.reasoning ? " · thinks" : ""}{fmtORPrice(mm.inPrice) ? ` — ${fmtORPrice(mm.inPrice)}` : ""}</option>
                      ))}
                    </datalist>
                    <label>Thinking (reasoning)</label>
                    <select
                      value={orReasoning}
                      onChange={(e) => {
                        const v = e.target.value as ReasoningEffort;
                        setOrReasoning(v);
                        try { localStorage.setItem("moldable_or_reasoning", v); } catch {}
                      }}
                    >
                      <option value="off">Off — faster, cheaper</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium — recommended</option>
                      <option value="high">High — deepest, slowest</option>
                    </select>
                    <p className="fine">
                      “Thinks” models reason through tricky geometry before writing code — more accurate, a bit slower.
                      {orModels.length ? ` ${orModels.length} models available — browse ` : " Browse "}
                      <a className="link-inline" href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">openrouter.ai/models</a>. Currently using: <b>{lmodel || lpre.defaultModel}</b>
                    </p>
                  </details>
                ) : (
                  <>
                    <label>Model id</label>
                    <input
                      value={lmodel}
                      onChange={(e) => setLmodel(e.target.value)}
                      placeholder={lpre.defaultModel || "model-name"}
                      autoComplete="off"
                    />
                    <p className="fine">{lpre.keyHint}</p>
                  </>
                )}
              </>
            )}
            </SGroup>
            <SGroup title="AI changes" hint="how results land on the canvas">
              <div className="seg sm" role="radiogroup" aria-label="How AI changes apply">
                <button className={aiApply === "ask" ? "on" : ""} onClick={() => onSaveAiApply("ask")} title="Every AI result is shown as an on-canvas preview with green/red change highlights — nothing commits until you tap Apply">
                  Preview &amp; confirm
                </button>
                <button className={aiApply === "auto" ? "on" : ""} onClick={() => onSaveAiApply("auto")} title="AI results apply immediately (Undo still reverts any change)">
                  Apply automatically
                </button>
              </div>
              <p className="fine choice-hint">{aiApply === "ask" ? "AI proposals appear as a preview (green = added, red = removed) and wait for your Apply." : "AI results land immediately — Undo still brings anything back."}</p>
            </SGroup>
          </>
        )}

        {pane === "mesh" && (
          <>
            <p className="pane-desc">Turns a photo or text into a mesh in <b>Generative</b> mode.</p>
            <SGroup title="Engine" hint="Hugging Face is free · fal's Hunyuan 3D Pro is the most accurate">
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
            </SGroup>
            <SGroup title="Access">
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
            </SGroup>
          </>
        )}

        {pane === "printer" && (
          <>
            <p className="pane-desc">Used by the bed-fit check and the Printability report.</p>
            <SGroup title="Your printer">
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
            </SGroup>
            <SGroup title="Print checks">
              <label>Overhang warning threshold (°)</label>
              <input type="number" value={oh} onChange={(e) => setOh(+e.target.value)} />
              <p className="fine">45° is the standard FDM rule of thumb; raise it for PLA, lower for ABS.</p>
            </SGroup>
          </>
        )}

        {pane === "sync" && (
          <>
            <p className="pane-desc">Sign in once — your projects, chats and settings follow you to any device, encrypted in your browser before upload.</p>
            <SGroup title="Cloud account">
            {syncMsg && <div className={`sync-status${syncErr ? " err" : ""}`} role="status">{syncMsg}</div>}
            {cloudEmail ? (
              <>
                <p className="fine">Signed in as <b>{cloudEmail}</b> — everything syncs automatically.</p>
                <p className="fine sync-when">
                  {lastSyncAt
                    ? <>Last synced: <b>{new Date(lastSyncAt).toLocaleString()}</b></>
                    : "Not synced yet — it'll sync automatically after your next change."}
                </p>
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy} onClick={() => doCloud("sync")}>Sync now</button>
                  <button className="ghost sm" disabled={cloudBusy} onClick={() => doCloud("signout")}>Sign out</button>
                </div>
                <details className="adv">
                  <summary>What syncs, exactly?</summary>
                  <p className="fine">Projects (their code, versions, chats, thumbnails), plus your settings and keys — encrypted in your browser before upload, private to your account. 3D meshes and imported STEP files stay on each device (they're big; CAD models rebuild from their code). On another device, just sign in the same way.</p>
                </details>
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

            </SGroup>
            <SGroup title="File backup" hint="no account needed — an encrypted file you keep">
              <details className="adv">
                <summary>Back up or restore with an encrypted file</summary>
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
                <p className="fine">Zero-knowledge: the file is encrypted with your passphrase and never uploaded. Restore it anywhere with the same passphrase.</p>
              </details>
            </SGroup>
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
