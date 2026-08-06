import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Workspace, FILAMENT_SWATCHES } from "./components/Workspace";
import { LibraryModal } from "./components/LibraryModal";
import { MeasureModal } from "./components/MeasureModal";
import type { SvgMode, SvgParams } from "./components/ExtrudeModal";
import { geometryToSTL } from "./print/stl";
import type { SplitPiece } from "./print/split";
import type { ViewerHandle, PickedFeature, SelectKind, TransformMode, TransformCommit, Measurement } from "./components/Viewer";
import { getEngineSelection, type EngineSelection } from "./engine/selectEngine";
import { previewSetBase, previewBoolean, previewIntersect, growMesh, displaceMesh, type SurfacePattern } from "./engine/previewEngine";
import { splitConnectedParts, connectedPartCount, meshVolume } from "./print/separate";
import type { GenerativeEngine } from "./engine/generativeEngine";
import type { BuildInput, EngineResult, ExportFormat, CadOp, PointOp, HoleOp, ScrewOp } from "./engine/types";
import { MODELS, type ApiMsg } from "./llm/anthropic";
import { LLM_PRESETS, llmPreset, llmReady, generateLlm, getReasoningEffort, type LlmSettings, type LlmProviderId, type ReasoningEffort } from "./llm/llm";
import { fetchHouseStatus, houseStatus as houseStatusNow, type HouseStatus } from "./llm/house";
import { localSupported, localDownloaded } from "./llm/local";
import { detectProductQuery, researchDimensions, canResearch } from "./llm/research";
import { classifyIntent, polishMeshPrompt } from "./llm/router";
import { refineRequest, applyAnswers, defaultAnswers, type ClarifyQuestion } from "./llm/clarify";
import { draftPlan, planToPrompt, type BuildPlan } from "./llm/plan";
import { detectOllama, type OllamaInfo } from "./llm/ollamaDetect";
import { imageAdvice } from "./llm/imageAdvice";
import { downscaleImage } from "./lib/downscale";
import { MAGNET_SIZES, magnetPocket, type MagnetSize, type MagnetFit } from "./lib/magnets";
import { SCREW_SIZES, screwCut, type ScrewSize, type ScrewFit } from "./lib/screws";
import { loadLedger, resetLedger, fmtUSD, fmtTok } from "./llm/pricing";
import { fetchOpenRouterModels, cachedOpenRouterModels, fmtORPrice, recommendedForApp, shortModelName, pickAutoModel, AUTO_MODEL, type ORModel } from "./llm/openrouterModels";
import { REPLICAD_SYSTEM_PROMPT, FALLBACK_JSON_PROMPT, VISION_ADDENDUM, markupAddendum, IMPORT_ADDENDUM, REPLACEMENT_ADDENDUM, EDIT_BLOCK_ADDENDUM, fitDirective, replicadRepairMessage, jsonRepairMessage } from "./llm/prompts";
import { fitClearance, fitCalibration, saveFitCalibration, boreNote, type FitId } from "./lib/fit";
import { hasEditBlocks, parseEditBlocks, applyEditBlocks } from "./llm/editBlocks";
import { repairGeometry } from "./print/repair";
import { preflightExport, preflightSummary } from "./print/preflight";
import { bakeMeshTransform, composeXform, applyStoredMeshXform, fitToBedFactor, scaleAboutBase } from "./print/resize";
import { blobToDataURL } from "./gen/util";
import { extractJsBlock, extractJsonObject } from "./llm/extract";
import { parseSpec } from "./cad/spec";
import { extractParams, humanizeParam, type CadParams } from "./cad/params";
import { EXAMPLE_SPEC, EXAMPLE_REPLICAD, IMPORT_PASSTHROUGH } from "./cad/example";
import { TemplatesModal } from "./components/TemplatesModal";
import { TEMPLATES, templateThumb, type Template } from "./cad/templates";
import { openInSlicer, type SlicerTarget } from "./lib/slicer";
import { IconGitHub, IconGoogle, IconX, IconArrowUp, IconPaperclip, IconCube, IconGlobe, IconSun, IconMoon } from "./components/icons";
import { SOLIDS, sliceAt, iso, type IsoView } from "./launch/plateSolids";
import { analyzePrintability, DEFAULT_PRINTER, thinWallLimitMM, type PrintabilityReport, type PrinterDefaults } from "./print/printability";
import { overhangOverlay } from "./print/overhang";
import { suggestOrientation, type OrientSuggestion } from "./print/orient";
import { pocketFacing } from "./print/pockets";
import type { ThinWallReport } from "./print/thinwalls";
import { PRINTERS, PRINTER_BRANDS, printerKey } from "./print/printers";
import { PROVIDERS, getProvider, usesMultiView, pickAutoGenEngine, costLabel, costUsd } from "./gen/registry";
import { recordSpend, spendSummary } from "./gen/ledger";
import { providerBalance, BALANCE_CAPABLE, BALANCE_DASHBOARDS } from "./gen/balance";
import { newProject, putProject, getProject, listProjects } from "./store/projects";
import { appendVersion, replaceHeadVersion, restoreVersion, navigateHead, headIndex } from "./store/versions";
import type { Project, Pin, Version } from "./store/types";
import { uid } from "./lib/id";
import type { PickedPoint } from "./components/Viewer";
import type { BuildProgress } from "./components/BuildStage";
import { downloadBlob, safeFileName } from "./lib/download";
import { exportSettings, importSettings } from "./lib/backup";
import { IS_DESKTOP } from "./lib/desktopUpdate";
import { DEFAULT_RELAY, cloudSessionState, cloudReachable, isNetworkError, cloudSignUp, cloudSignIn, cloudSignOut, cloudSyncPush, cloudSyncPull, cloudOAuth, cloudMagicLink, cloudResetPassword, cloudSetPassword, onAuthChange, hasAuthReturn, completeAuthReturn } from "./lib/cloud";

// On-demand UI (code-split): the SVG modal's svg/extrude graph carries
// three-bvh-csg + SVGLoader — it only loads when an SVG is actually dropped.
// Suspense fallback is null: it opens from a tap and the chunk is tiny (and
// PWA-precached), so there's nothing to skeleton. (TemplatesModal stays eager —
// its TemplateStrip renders on the first screen.)
const ExtrudeModal = lazy(() => import("./components/ExtrudeModal").then((m) => ({ default: m.ExtrudeModal })));

// GLB/STL parsing (GLTFLoader + friends) loads with the first mesh that needs it.
const loadAnyMesh = async (f: Blob | File) => (await import("./gen/loadMesh")).loadAnyMesh(f);

// Per-face paint persists as base64 of the per-triangle palette-index array — compact in
// JSON (cloud sync) and structured-clone-safe in IndexedDB. Chunked to dodge the
// String.fromCharCode spread limit on large meshes.
function u8ToB64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToU8(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

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
  // While streaming, the bubble is a step timeline: `steps` are the COMPLETED stages
  // (checked off, connector line drawn) and `text` is the ACTIVE one — so in-place
  // progress rewrites ("running 40%") tick the live row without growing the list.
  steps?: string[];
  thinking?: string; // the model's reasoning stream, kept collapsed for the curious
  sources?: { url: string; title?: string }[]; // web pages a research lookup used
  images?: string[]; // product photos a research lookup found (display-only <img> URLs)
  usage?: { inTok: number; outTok: number; usd: number | null; est: boolean }; // beta cost meter, summed over retries
  clarify?: ClarifyState; // a request too vague to build — the questions, in the chat
  /** Plan mode: the spec to agree on BEFORE anything is generated. `done` freezes the
   *  card as a record of what was actually built from. */
  plan?: { prompt: string; plan: BuildPlan; done?: boolean; chose?: "build" | "skip" };
  /** A paid mesh generation waiting on one tap — price on the button, free CAD as the
   *  other exit. `done` freezes the card as a record of what was chosen. */
  confirm?: { text: string; yes: string; no: string; prompt: string; done?: boolean; chose?: "mesh" | "cad" };
  /** A one-tap suggestion the app is CONFIDENT about but won't do silently — convert
   *  an inch-unit import, take the computed print orientation. One card type for all
   *  of them; `kind` tells the dispatcher what accepting means. The card freezes
   *  either way, so the transcript records what was chosen. */
  offer?: { text: string; yes: string; no: string; kind: "inches" | "orient" | "flush"; done?: boolean; accepted?: boolean };
  /** A live web lookup. The step timeline said "Searching the web…" in the same grey
   *  as every other stage, so a lookup that takes 20 s read as the app hanging — and
   *  with the globe deliberately switched ON, nothing confirmed it was actually
   *  online. This gets its own block under the timeline (like the reasoning panel):
   *  a pulsing globe while it runs, then what it came back with. */
  web?: { query: string; done?: boolean; found?: boolean; sources?: { url: string; title?: string }[] };
  // Direct-edit receipt (magnet pockets, holes…). Repeating the same action rewrites
  // THIS message with a running count instead of posting another identical bubble.
  receipt?: string;
  receiptCount?: number;
};

/** A question card sitting in the transcript. `answers` opens pre-filled with every
 *  recommended option, so Build it works before the user touches anything; `done`
 *  freezes the card once it has been built from or skipped, leaving it readable as a
 *  record of what was actually chosen. */
export type ClarifyState = {
  prompt: string;                   // the request the questions are about
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  done?: boolean;
};
export type Mode = "precise" | "generative";
export type ModePref = "auto" | Mode; // composer switch: Auto lets the app pick the engine

export type SettingsPane = "ai" | "mesh" | "printer" | "appearance" | "sync";
// User chat-bubble tint presets (mixed over the bubble base in CSS, both themes).
export const DEFAULT_USER_TINT = "#498a6f";
export const BUBBLE_TINTS: { label: string; color: string }[] = [
  { label: "Green", color: "#498a6f" },
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
// Thumbnail style version: bump when the studio look changes so the Library knows
// which saved previews are stale and quietly re-shoots them.
const THUMB_V = 2;

// Fresh-chat engine routing: organic/sculptural language → the generative mesh engine
// (CAD can't sculpt); dimensioned/functional language → Precise CAD. Both matching →
// leave the user's current mode alone.
const ORGANIC_RE = /\b(figurine|figure|statue|sculpt(?:ure|ed)?|character|creature|animal|dog|cat|dragon|dinosaur|mask|bust|head of|face of|monster|superhero|iron\s?man|batman|pokemon|pikachu|skull|gnome|ornament|organic|life[- ]?like|realistic (?:model|version))\b/i;
const CADISH_RE = /\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|in\b)|bracket|mount(?:ing)?|holder|case|enclosure|adapter|clip|hook|gear|thread(?:ed)?|screw|bolt|hole|stand|tray|spacer|hinge|clamp|knob|plate|wall thickness|tolerance|snap[- ]?fit|press[- ]?fit)\b/i;
// A model is already on the canvas and the words ask for sculptural work ON it
// ("sculpt organic vines on it", "make it look like a dragon") — CAD can't sculpt;
// the mesh engine can, seeded with a clean snapshot of the current model.
const SCULPT_EDIT_RE = /\b(sculpt|organic|life[- ]?like|ornate|flowing|artistic(?:ally)?|statue|figurine|creature|character)\b/i;
// In Generative mode with a model on canvas: do the words point AT the model
// (refine it) rather than ask for a brand-new object?
const REFINE_REF_RE = /\b(it|this|these|the (?:part|model|piece|current|existing)|refine|sculpt|smooth(?:er)?|detail(?:s|ed)?|texture)\b/i;
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

/** OpenRouter "Auto" needs the live catalogue to route. It used to be fetched only
 *  when Settings was opened — so on a fresh device every Auto pick silently fell back
 *  to the preset default (gemini-2.5-flash), which is exactly what users saw. */
async function ensureOrCatalog(): Promise<ORModel[]> {
  const have = cachedOpenRouterModels();
  if (have.length) return have;
  return fetchOpenRouterModels();
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
  // "entered" survives reloads for free-mode users too (not only key holders). The flag
  // was being WRITTEN and never read, so every refresh dumped you back on the launchpad
  // mid-session. Now a reload puts you back in the workspace you were in; the launchpad
  // is reached deliberately — New chat, or the wordmark.
  const [entered, setEnteredState] = useState(() => {
    try { return localStorage.getItem("moldable_entered") === "1"; } catch { return false; }
  });
  // The Launchpad's staggered entrance is a first-impression, worth 770 ms when the page
  // loads. Now that the wordmark navigates back to it mid-session it would replay on every
  // trip — and the resume chip and recents animate in LAST, so the one thing a returning
  // user came for is the slowest to arrive. Play it on arrival, not on the way back.
  const [beenHome, setBeenHome] = useState(false);
  const setEntered = (v: boolean) => {
    if (v) localStorage.setItem("moldable_entered", "1");
    else localStorage.removeItem("moldable_entered"); // going home un-enters — the flag has to follow
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
  // Warm the OpenRouter catalogue whenever OpenRouter is the brain, so "Auto" can
  // route from the very first request instead of falling back to the default model.
  useEffect(() => {
    if (llm.provider === "openrouter") void fetchOpenRouterModels();
  }, [llm.provider]);
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
  const lastSyncRef = useRef<number | null>(null);
  const markSynced = () => {
    const t = Date.now();
    localStorage.setItem("moldable_last_sync", String(t));
    lastSyncRef.current = t;
    setLastSyncAt(t);
    setSyncState("synced");
  };
  // "Signed in but the sync service is unreachable from here" — a real state (blocked
  // network, captive portal, sleep) that used to render as plain "signed out" while
  // the cached models stayed visible. Kept separate so the UI can say the truth and
  // the reconnect loop below knows to keep trying.
  const [cloudOffline, setCloudOffline] = useState(false);
  const cloudOfflineRef = useRef(false);
  cloudOfflineRef.current = cloudOffline;

  // Debounced auto-sync: any local change (project or settings) runs a full two-way
  // cycle shortly after, but only while signed in.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** One two-way cycle: merge the account's changes in, push this device's out.
      A network failure flips the honest offline flag instead of pretending idle. */
  const runSync = async () => {
    if (!accountEmailRef.current) return;
    setSyncState("syncing");
    try {
      const r = await cloudSyncPush();
      if (!r) { setSyncState("idle"); return; } // no live session (offline boot) — the reconnect loop owns recovery
      markSynced();
      setCloudOffline(false);
      if (r.adopted.length || r.deleted.length) onRemoteProjects(r.adopted, r.deleted);
    } catch (e) {
      setSyncState("idle");
      if (isNetworkError(e)) setCloudOffline(true);
    }
  };
  // Timers and [] effects below would otherwise capture their first render — route
  // through a ref so every cycle runs with the CURRENT closures (engine, project…).
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;
  const scheduleSync = () => {
    if (!accountEmailRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSyncRef.current(), 2500);
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
      // Reload so React state picks up adopted settings — but AT MOST ONCE per
      // browser session. Without this cap, any synced key that legitimately
      // differs on every boot turns "reload to apply" into an endless reload
      // loop that flashes the app white every few seconds (it happened).
      const reloaded = sessionStorage.getItem("moldable_pull_reloaded");
      if (r && (r.settings > 0 || r.projects > 0) && !reloaded) {
        try { sessionStorage.setItem("moldable_pull_reloaded", "1"); } catch { /* private mode */ }
        setTimeout(() => window.location.reload(), 400);
      }
    } catch {
      setSyncState("idle");
    }
  }

  useEffect(() => {
    void cloudSessionState().then((s) => {
      setAccountEmail(s.email);
      setCloudOffline(s.offline);
      if (s.email && !s.offline) void pullOnSignIn();
    }).catch(() => {});
    let unsub: (() => void) | undefined;
    void onAuthChange((em) => {
      if (em) {
        setAccountEmail(em);
        setCloudOffline(false);
        void pullOnSignIn();
      } else if (!cloudOfflineRef.current) {
        // A null session while cut off is the NETWORK talking, not the user — the
        // remembered account stays until a reachable server actually refuses it.
        setAccountEmail(null);
        pulledRef.current = false;
      }
    }).then((u) => (unsub = u)).catch(() => {});
    return () => unsub?.();
  }, []);

  // Periodic safety-net autosync: a full two-way cycle (their changes in, ours out)
  // on a timer, so nothing depends on a single change path remembering to sync —
  // and so a device left open adopts what other devices push. No-op while signed out.
  useEffect(() => {
    const id = setInterval(() => void runSyncRef.current(), 45_000);
    return () => clearInterval(id);
  }, []);

  // The way back online: a device that lost the sync service re-checks on every
  // "maybe it's back" signal — the browser regaining network, waking to the tab, or
  // a slow timer — and picks its session and library straight back up. Nobody
  // should ever have to sign in again because of wifi.
  const reconnectBusy = useRef(false);
  async function tryReconnect() {
    if (reconnectBusy.current || !cloudOfflineRef.current) return;
    reconnectBusy.current = true;
    try {
      const s = await cloudSessionState();
      if (s.email && !s.offline) {
        setAccountEmail(s.email);
        setCloudOffline(false);
        pulledRef.current = false; // full pull again — the account may have moved on
        await pullOnSignIn();
      } else if (!s.email) {
        // Reachable server, no recoverable session: the sign-in genuinely ended.
        setAccountEmail(null);
        setCloudOffline(false);
        setAuthNotice("Your sign-in expired while this device was offline — sign in again in Settings → Sync to keep syncing.");
      }
    } finally {
      reconnectBusy.current = false;
    }
  }
  const tryReconnectRef = useRef(tryReconnect);
  tryReconnectRef.current = tryReconnect;
  useEffect(() => {
    const onOnline = () => void tryReconnectRef.current();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void tryReconnectRef.current();
      // Returning to the tab also freshens a healthy session — another device may
      // have pushed while this one slept.
      if (accountEmailRef.current && !cloudOfflineRef.current && Date.now() - (lastSyncRef.current ?? 0) > 30_000) void runSyncRef.current();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(() => void tryReconnectRef.current(), 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, []);

  /** What the canvas shows while a build runs: the name, the live phase, and a real
   *  percentage when the engine reports one (mesh does; CAD has phases instead). */
  const [genProgress, setGenProgress] = useState<BuildProgress | null>(null);
  const [sel, setSel] = useState<EngineSelection | null>(null);
  const [booting, setBooting] = useState(false);
  // Lazy: the mesh-engine module (GLB loaders, export helpers) loads with the
  // first generative build/export, not at mount. Every use site is async already.
  const genEngineRef = useRef<GenerativeEngine | null>(null);
  async function getGenEngine(): Promise<GenerativeEngine> {
    if (!genEngineRef.current) {
      const { GenerativeEngine } = await import("./engine/generativeEngine");
      genEngineRef.current ??= new GenerativeEngine();
    }
    return genEngineRef.current;
  }

  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const apiHistory = useRef<ApiMsg[]>([]);
  /** The last few chat bubbles as plain text — the model's short-term memory. apiHistory
   *  only holds successful API turns and gets re-seeded to bare code on undo/redo and
   *  project open, so "like I said two messages ago" lived nowhere the model could see
   *  (a real report). The transcript is the durable record; this digests it. */
  const chatDigest = (maxTurns = 10, maxChars = 350): string =>
    messagesRef.current
      .filter((m) => !m.streaming && !m.clarify && !m.error && m.text)
      .slice(-maxTurns)
      .map((m) => `${m.role === "user" ? "User" : "App"}: ${m.text.length > maxChars ? m.text.slice(0, maxChars) + "…" : m.text}`)
      .join("\n");
  // Mesh texture toggle: OFF by default ("print-first") — engines return a clean
  // gray geometry-only mesh, which is also the cheaper call on every paid engine
  // (fal Hunyuan textures cost ~3× the white mesh). ON asks for baked color.
  const [genTexture, setGenTextureState] = useState<"on" | "off">(() => (localStorage.getItem("moldable_gen_texture") === "on" ? "on" : "off"));
  const toggleGenTexture = () =>
    setGenTextureState((v) => {
      const next = v === "on" ? "off" : "on";
      localStorage.setItem("moldable_gen_texture", next);
      scheduleSync();
      return next;
    });
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
  /** The live result, readable from callbacks that outlive their render. Canvas tools
   *  fire from listeners installed by an earlier render, so reading `result` there can
   *  hand a build the PREVIOUS op chain — two magnet pockets placed in quick succession
   *  had the second drop the first from the version it recorded. */
  const resultRef = useRef<EngineResult | null>(null);
  resultRef.current = result;
  const [splitPieces, setSplitPieces] = useState<(SplitPiece & { plate?: number })[] | null>(null);
  const [autoPick, setAutoPick] = useState(""); // "Auto → <model> (<why>)" note when OpenRouter Auto picks a model
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  geometryRef.current = geometry;
  const [modelSelected, setModelSelected] = useState(false); // whole-part selection (bounding box)
  const [attachments, setAttachments] = useState<{ id: string; geometry: THREE.BufferGeometry; name: string; tint?: string }[]>([]); // free-floating objects (logos, badges, parts…)
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
  // Per-part fill colour (Bambu-style): objectId ("model" or an attachment id) → hex.
  // Painted parts render tinted in the viewer and export as filament slots the slicer picks up.
  const [partColors, setPartColors] = useState<Record<string, string>>({});
  const colorFor = (key: string): string | undefined => partColors[key];
  const setPartColor = (key: string, hex: string | null) =>
    setPartColors((m) => {
      const next = { ...m };
      if (hex) next[key] = hex;
      else delete next[key];
      return next;
    });
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
  /** Everything on the canvas, with its plate — the shared input for EVERY 3MF export.
   *  `modelGeom` overrides the model's mesh: preflight may have repaired it, and the
   *  repaired result isn't in React state yet when the export runs. */
  function collectPlateParts(modelGeom?: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; name: string; plate: number; color?: string; paint?: Uint8Array; paintPalette?: string[] }[] | null {
    const geometry = modelGeom ?? geometryRef.current;
    if (!geometry) return null;
    // The model's per-face paint rides along only when its triangle count still matches
    // (a CAD edit reshuffles triangles → drop the stale paint rather than mispaint).
    const triCount = geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
    const modelPaint = facePaint && facePaint.length === triCount ? facePaint : undefined;
    // Split pieces sent to their own plates replace the single model entry: each is
    // re-CENTRED on its plate (the tiled layout was for showing them together).
    const plated = splitPieces?.length && splitPieces.some((pc) => pc.plate != null) ? splitPieces : null;
    const parts = plated
      ? plated.map((pc, i) => {
          const g = pc.geometry.clone();
          g.computeBoundingBox();
          const bb = g.boundingBox!;
          g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
          return { geometry: g, name: `Part ${i + 1}`, plate: pc.plate ?? 1, color: pc.color, paint: undefined as Uint8Array | undefined, paintPalette: undefined as string[] | undefined };
        })
      : [{ geometry, name: project?.name ?? "model", plate: plateFor("model"), color: colorFor("model"), paint: modelPaint, paintPalette: modelPaint ? FILAMENT_SWATCHES : undefined }];
    for (const a of attachments) {
      const baked = viewer.current?.bakeAttachment(a.id);
      if (!baked) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(baked, 3));
      parts.push({ geometry: g, name: a.name, plate: plateFor(a.id), color: colorFor(a.id), paint: undefined, paintPalette: undefined });
    }
    return parts;
  }
  /** Analyse + auto-repair once, ahead of ANY export. Every download path runs this —
      shipping an unchecked mesh out of one menu and a checked one out of another is
      how a user ends up printing a hole they were told didn't exist. */
  function prepareExport() {
    if (!result) return null;
    const pf = preflightExport(result, printer);
    if (pf.repaired) {
      const rr = pf.result.kind === "generative" ? { ...pf.result, glb: geometryToSTL(pf.result.geometry), meshXform: undefined } : pf.result;
      applyResult(rr, project?.name ?? "Model", "Auto-repaired the mesh for export (watertight)", "auto-repair for export");
    } // viewer + report show exactly what was exported
    return pf;
  }
  /** Painting is per-triangle data only the 3MF carries. Every export that drops it says
      so — EVERY time, not once, because the second silent STL is the one that gets
      printed in a single colour by someone who thought the paint went with it. */
  function paintCaveat(format: string): string {
    if (format === "3mf" || !facePaint?.some((v) => v)) return "";
    return `Your painted colours are not in this file — ${format.toUpperCase()} has nowhere to put them. Export 3MF to keep them.`;
  }
  /** What a repeat of the same export still needs to say: nothing, unless something
      actually happened to the file (paint dropped, mesh repaired). */
  const exportBrief = (label: string, pf: ReturnType<typeof preflightExport>, caveat: string) =>
    caveat ? `${label} ${caveat}` : pf.repaired ? `${label} ${preflightSummary(pf)}` : undefined;
  /** The 3MF the app hands out for "the model": everything on the canvas as named
      objects in one file, with part colours and per-face paint intact. Plates are
      flattened — the plate exports below are what honours those. Returns null when
      there's nothing to collect, so the caller can fall back to the engine writer. */
  async function build3MF(modelGeom: THREE.BufferGeometry): Promise<{ blob: Blob; parts: number } | null> {
    const parts = collectPlateParts(modelGeom);
    if (!parts?.length) return null;
    const { write3MF } = await import("./print/exportClient"); // 3MF writer loads on demand
    return { blob: write3MF(parts.map((p) => ({ ...p, plate: 1 })), { title: exportBase() }), parts: parts.length };
  }
  /** One 3MF per non-empty plate — real named <object>s, positioned as placed. */
  async function exportPlates() {
    const pf = prepareExport();
    const all = collectPlateParts(pf?.result.geometry);
    if (!all) return;
    const { write3MF } = await import("./print/exportClient"); // 3MF writer loads on demand
    const plates = new Map<number, typeof all>();
    for (const part of all) {
      if (!plates.has(part.plate)) plates.set(part.plate, []);
      plates.get(part.plate)!.push(part);
    }
    const base = safeFileName(exportBase(), "3mf").replace(/\.[^.]+$/, "");
    const entries = [...plates.entries()].sort((x, y) => x[0] - y[0]);
    const one = (n: number, parts: typeof all) => write3MF(parts, { title: `${exportBase()} — plate ${n}` });
    if (entries.length === 1) {
      downloadBlob(one(entries[0][0], entries[0][1]), `${base}-plate-${entries[0][0]}.3mf`);
    } else {
      // One zip, not N downloads: browsers throttle or block repeated downloadBlob()
      // calls, so a user could silently receive fewer files than they had plates.
      const files: Record<string, Blob> = {};
      for (const [n, parts] of entries) files[`${base}-plate-${n}.3mf`] = one(n, parts);
      downloadBlob(await (await import("./print/exportClient")).zipModelFiles(files), `${base}-plates.zip`);
    }
    explainOnce("export-plates", `Exported ${plates.size} plate${plates.size > 1 ? "s" : ""} as separate 3MF files${entries.length > 1 ? " in one zip" : ""} — each part is a named object, so Bambu Studio / OrcaSlicer can arrange, paint, and set per-part options. ${pf ? preflightSummary(pf) : ""}`);
  }
  /** ONE project 3MF with every plate laid out — Bambu Studio / OrcaSlicer open it with
      the plates intact (each part named, grouped and positioned on its plate). */
  async function exportPlatesProject() {
    const pf = prepareExport();
    const all = collectPlateParts(pf?.result.geometry);
    if (!all) return;
    const { platesToProject3MF } = await import("./print/exportClient"); // 3MF writer loads on demand
    downloadBlob(platesToProject3MF(all, plateCount, { x: printer.bed.x, y: printer.bed.y }, plateNames), safeFileName(`${exportBase()}-plates`, "3mf"));
    const used = new Set(all.map((p) => p.plate)).size;
    explainOnce("export-project", `Exported one project 3MF with ${plateCount} plate${plateCount > 1 ? "s" : ""} (${used} in use) for your ${printer.bed.x}×${printer.bed.y} mm bed. Open it in Bambu Studio or OrcaSlicer — the plates and part placement come through. If your slicer only shows the geometry, use "One file per plate" instead and tell me which slicer version so I can adjust. ${pf ? preflightSummary(pf) : ""}`);
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
    // The canvas is about to show plain part meshes — CAD feature-select can't act on
    // them, so switch it off (the rail keeps the tool visible but disabled until Regroup).
    setSelectMode(false);
    setActivePinId(null);
    setPinText("");
    setSelectedFeature(null);
    setSelectedFaces([]);
    applyResultNoCommit({
      kind: "generative",
      geometry: main,
      dims,
      source: { kind: "gen", provider: "separate", model: `${pieces.length} parts` },
      supportsStep: false,
      glb: geometryToSTL(main),
    });
    // Each separated part gets its own pastel (Meshy-splitter look) — the Objects
    // panel dot matches, so "which part is which" reads at a glance. Display-only:
    // Merge/Regroup restores the single model exactly.
    const PART_TINTS = ["#f0a8a8", "#a8d8b8", "#a8c4f0", "#e8cc98", "#c8b0e8", "#98d4d8"];
    const ids = rest.map((g, i) => addAttachment(g, `Part ${i + 2}`, PART_TINTS[i % PART_TINTS.length]));
    separatedRef.current = { ids, result: prior };
    setSeparated(true);
    explainOnce(
      "separate",
      `Separated the model into **${pieces.length} parts** — the largest stays as the model, the other${rest.length > 1 ? "s are" : " is"} now free object${rest.length > 1 ? "s" : ""} you can move and rotate on their own (in any direction, mid-air included). Try the fit: drag Part 2 over the model, then tap **Check clearance** — it computes the real overlap between the solids. If parts are meant to nest and they collide, **Cut to fit** carves the needed room out of the model. **Undo** or **Regroup parts** puts everything back exactly as it was; **Merge all into model** makes the new arrangement permanent.`,
    );
  }

  /** For parts designed to go INTO each other: carve each selected part's shape — grown
      by an FDM clearance — out of the model at its current position, so it can nest.
      Inside the dry-fit sandbox this stays un-committed (Undo/Regroup restores);
      standalone it commits a version like any other edit. */
  async function makeItFit(ids: string[]) {
    if (!geometry || !result || status === "generating" || !ids.length) return;
    const CLEARANCE = fitClearance(fit); // per side — the chosen fit, shifted by this printer's calibration
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
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Nothing to carve — the selected part isn't overlapping the model. Move it to where it should nest (so they collide), then tap Cut to fit." }]);
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
        text: `Carved **${names}**'s shape out of the model with **${CLEARANCE} mm clearance** per side — it can nest there now. Tap **Check clearance** to confirm (it should pass), and slide the part in and out to eyeball it. ${separatedRef.current ? "**Merge all into model** makes this permanent; **Undo** / **Regroup parts** restores the original." : "Undo restores the un-carved model."}`,
      }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Cut to fit failed: " + String(err?.message ?? err), error: true }]);
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
          lines.push(`✗ **${a.name}** overlaps the model by **${shown}**${pct > 0 ? ` (~${pct}% of the part)` : ""} — they collide at this position. If it's just misplaced, move it and re-check. If these parts are MEANT to nest (a lid into a box, a peg into a hole), tap **Cut to fit** — it carves ${a.name}'s shape plus clearance out of the model right here.`);
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
  /** Keep only the parts of a diff a person would call a change. Islands are scored by
   *  volume: anything under a fraction of the biggest one — or under a flat floor — is
   *  re-tessellation noise spread over the surface, not the edit that was asked for. */
  function significantIslands(soup: Float32Array | null): Float32Array | null {
    if (!soup || soup.length < 9) return null;
    if (meshVolume(soup) < 0.05) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(soup, 3));
    let parts: THREE.BufferGeometry[];
    try {
      parts = splitConnectedParts(g);
    } catch {
      return soup; // can't separate it — better to show the whole diff than nothing
    }
    if (parts.length <= 1) return meshVolume(soup) < 0.5 ? null : soup;
    const scored = parts
      .map((pg) => {
        const arr = (pg.index ? pg.toNonIndexed() : pg).getAttribute("position").array as Float32Array;
        return { arr, vol: Math.abs(meshVolume(arr)) };
      })
      .sort((a, b) => b.vol - a.vol);
    const biggest = scored[0].vol;
    const keep = scored.filter((x) => x.vol >= Math.max(0.5, biggest * 0.04));
    if (!keep.length) return null;
    const total = keep.reduce((n, x) => n + x.arr.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const x of keep) { out.set(x.arr, o); o += x.arr.length; }
    return out;
  }

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
      // Rebuilding a CAD program re-tessellates the WHOLE surface, so the boolean also
      // returns a confetti of sliver shells everywhere the triangles happen to fall
      // differently — which is why filling one hole used to light up the entire model
      // (a real report: the preview misled, even though the applied result was right).
      // Judge each disconnected island on its own and keep only ones with real volume.
      removed = significantIslands(removed);
      added = significantIslands(added);
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
    pendingRef.current = null; // eager: same-tick callers (retry, promote-on-type) must see it gone
  }
  function discardPending(silent = false) {
    const pc = pendingRef.current;
    if (!pc) return;
    setPending(null);
    pendingRef.current = null;
    setGeometry(pc.prevGeometry);
    if (!silent) setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Discarded — the model is unchanged. (The proposal is gone; re-ask any time.)" }]);
  }
  // A follow-up ask that involves the held proposal can't run in the same tick — the
  // send path closes over `result`/`geometry` state, which only reflect the promote
  // (or discard) after a render. Queue the ask; the effect re-enters send() next
  // render, when its closures see the right base model.
  type QueuedAsk = { promptText: string; forceMode?: Mode; override?: { llm?: LlmSettings; genEng?: { provider: string; model: string }; skipClarify?: boolean; skipPlan?: boolean; routeAuto?: boolean } };
  const [queuedAsk, setQueuedAsk] = useState<QueuedAsk | null>(null);
  useEffect(() => {
    if (!queuedAsk || pending) return;
    const q = queuedAsk;
    setQueuedAsk(null);
    void send(q.promptText, q.forceMode, q.override);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedAsk, pending]);
  /** Preview bar's "Try again": drop this iteration and rebuild the same ask fresh. */
  function retryPending() {
    const pc = pendingRef.current;
    if (!pc) return;
    discardPending(true);
    setQueuedAsk({ promptText: pc.promptText });
  }

  const attachSelected = selAttachIds.length > 0;
  const addAttachment = (geometry: THREE.BufferGeometry, name: string, tint?: string): string => {
    const id = mid();
    setAttachments((a) => [...a, { id, geometry, name, tint }]);
    selectAttach(id);
    return id;
  };

  // Chat is a conversation, not an action log. Routine direct actions (separate,
  // drill, merge, export…) explain themselves the FIRST time — after that they run
  // quietly; the canvas/Objects panel/download already show what happened. Persisted
  // per device so the teaching doesn't repeat every session. Errors always post.
  const explainedRef = useRef<Set<string>>((() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("moldable_explained") ?? "[]")); } catch { return new Set<string>(); }
  })());
  /** Attach/refresh the live web-lookup block on a message (see ChatMessage.web). */
  function setWebState(msgId: string, web: NonNullable<ChatMessage["web"]>) {
    setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, web } : x)));
  }
  function explainOnce(key: string, full: string, brief?: string) {
    const seen = explainedRef.current.has(key);
    if (!seen) {
      explainedRef.current.add(key);
      try { localStorage.setItem("moldable_explained", JSON.stringify([...explainedRef.current])); } catch { /* private mode */ }
      appendMsg({ role: "assistant", text: full });
    } else if (brief) {
      appendMsg({ role: "assistant", text: brief });
    }
  }
  /** Receipt for a repeatable direct edit. Doing the same thing again REWRITES the last
   *  message with a running count rather than posting another identical bubble — nine
   *  magnet pockets used to mean nine copies of the same sentence, which buries the
   *  conversation the transcript is actually for. Any other message in between starts a
   *  fresh receipt, so the count always describes one uninterrupted run. */
  function appendMsg(msg: Omit<ChatMessage, "id">) {
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last && last.role === msg.role && last.text === msg.text && !!last.error === !!msg.error) return m;
      return [...m, { id: mid(), ...msg }];
    });
  }
  function postReceipt(key: string, render: (n: number) => string) {
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last && last.role === "assistant" && last.receipt === key) {
        const n = (last.receiptCount ?? 1) + 1;
        return [...m.slice(0, -1), { ...last, text: render(n), receiptCount: n }];
      }
      return [...m, { id: mid(), role: "assistant", text: render(1), receipt: key, receiptCount: 1 }];
    });
  }
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
  // (engine routing is gated on `modePref === "auto"` — see pickMode / send)
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(null);
  const [report, setReport] = useState<PrintabilityReport | null>(null);
  const reportJob = useRef(0); // guards the deferred printability pass against stale results
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const statusRef = useRef<"idle" | "generating">("idle");
  statusRef.current = status;
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
  // Per-face MMU paint tool (Bambu-style): pick a filament, click a face region to fill it.
  const [paintMode, setPaintModeState] = useState(false);
  const [paintTool, setPaintTool] = useState<"fill" | "brush" | "pick">("fill"); // bucket / drag / eyedropper
  const [paintMirror, setPaintMirror] = useState(false); // paint both sides of symmetric models at once
  const [paintSlot, setPaintSlot] = useState(1); // active filament palette index (1-based); 0 = eraser
  const [paintAngle, setPaintAngle] = useState(30); // smart-fill angle (deg)
  const [brushSize, setBrushSize] = useState(8); // brush radius as % of the model's largest dimension
  const [facePaint, setFacePaint] = useState<Uint8Array | null>(null); // model's per-triangle paint
  /** Turn the Paint tool on/off; enabling it disables the other single-owner viewer tools. */
  const setPaintMode = (on: boolean) => {
    setPaintModeState(on);
    if (on) { setSelectMode(false); setTransformMode("off"); setMeasureMode(false); setMeasurePending(null); setSelectedFeature(null); setSelectedFaces([]); }
  };
  /** A committed paint stroke (or erase) — store it; all-zero collapses to "no paint". */
  // Paint strokes get their own undo stack. They aren't model versions (no geometry
  // changes, so the history/rebuild machinery doesn't apply) but they are absolutely
  // something ⌘Z should take back. A model edit clears the stack: paint is keyed to
  // the triangle list, so those states can't be replayed onto new geometry — which
  // also means "stack non-empty" == "the most recent thing you did was paint", giving
  // ⌘Z the last-in-first-out behaviour people expect without tracking global order.
  const facePaintRef = useRef<Uint8Array | null>(null);
  facePaintRef.current = facePaint; // the stacks below read this, never the stale state
  const paintPast = useRef<(Uint8Array | null)[]>([]);
  const paintFuture = useRef<(Uint8Array | null)[]>([]);
  const [paintSteps, setPaintSteps] = useState(0); // re-render so canUndo/canRedo track it
  const syncPaintSteps = () => setPaintSteps(paintPast.current.length * 1000 + paintFuture.current.length);
  const clearPaintHistory = () => {
    paintPast.current = [];
    paintFuture.current = [];
    syncPaintSteps();
  };
  const onPaintStroke = (tc: Uint8Array) => {
    paintPast.current.push(facePaintRef.current ? facePaintRef.current.slice() : null);
    if (paintPast.current.length > 60) paintPast.current.shift(); // bounded — each is one byte per triangle
    paintFuture.current = [];
    syncPaintSteps();
    setFacePaint(tc.some((x) => x) ? tc : null);
  };
  const undoPaint = () => {
    const prev = paintPast.current.pop();
    if (prev === undefined) return false;
    paintFuture.current.push(facePaintRef.current ? facePaintRef.current.slice() : null);
    setFacePaint(prev);
    viewer.current?.restoreFacePaint(prev);
    syncPaintSteps();
    return true;
  };
  const redoPaint = () => {
    const next = paintFuture.current.pop();
    if (next === undefined) return false;
    paintPast.current.push(facePaintRef.current ? facePaintRef.current.slice() : null);
    setFacePaint(next);
    viewer.current?.restoreFacePaint(next);
    syncPaintSteps();
    return true;
  };
  const [measurePending, setMeasurePending] = useState<[number, number, number] | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [liveDragMm, setLiveDragMm] = useState<number | null>(null); // arrow-drag value mirrored into the quick-edit box
  const [selectedFeature, setSelectedFeature] = useState<PickedFeature | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<PickedFeature[]>([]); // box/marquee multi-select
  const [facesText, setFacesText] = useState("");
  const [faceText, setFaceText] = useState("");

  const [mode, setMode] = useState<Mode>("precise"); // RESOLVED engine for the current build (what the viewer/engine use)
  // The user's ENGINE preference: "auto" lets the app classify each new ask and pick
  // Precise (CAD) vs Generative (mesh) for them; "precise"/"generative" force it.
  const [modePref, setModePrefState] = useState<ModePref>(() => {
    const v = localStorage.getItem("moldable_mode_pref");
    return v === "precise" || v === "generative" || v === "auto" ? v : "auto";
  });
  /** Pick the engine preference from the composer switch. Auto re-enables classification;
   *  an explicit choice pins the resolved engine and turns routing off. */
  const pickMode = (pref: ModePref) => {
    setModePrefState(pref);
    try { localStorage.setItem("moldable_mode_pref", pref); } catch { /* ignore */ }
    if (pref === "precise") setMode("precise");
    else if (pref === "generative") setMode("generative");
  };
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
  // UNLABELLED extra reference photos — what a multi-file drop attaches. The named view
  // slots above stay for users who want to say which side is which; these don't ask.
  const [refs, setRefs] = useState<{ blob: Blob; url: string }[]>([]);
  function pickView(slot: ViewSlot, file: File) {
    void downscaleImage(file).then((eff) => {
      setViews((v) => {
        v[slot] && URL.revokeObjectURL(v[slot]!.url);
        return { ...v, [slot]: { blob: eff, url: URL.createObjectURL(eff) } };
      });
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
  // View ▾ Grayscale: hide baked mesh colors so the canvas shows the PRINT, not the
  // paint (display-only — exports and the stored glb keep their texture). Persisted.
  const [grayView, setGrayViewState] = useState(() => localStorage.getItem("moldable_gray") === "1");
  const setGrayView = (v: boolean) => {
    localStorage.setItem("moldable_gray", v ? "1" : "0");
    setGrayViewState(v);
  };
  // View ▾ Build plate: solid slab under the model (default ON — models read as
  // sitting on the printer, not floating on gridlines).
  const [showPlate, setShowPlateState] = useState(() => localStorage.getItem("moldable_plate") !== "0");
  const setShowPlate = (v: boolean) => {
    localStorage.setItem("moldable_plate", v ? "1" : "0");
    setShowPlateState(v);
  };
  // Plate colour + grid opacity (Settings > Appearance > Workspace).
  const [plateColor, setPlateColorState] = useState<string | null>(() => localStorage.getItem("moldable_plate_color") || null);
  const setPlateColor = (v: string | null) => {
    if (v) localStorage.setItem("moldable_plate_color", v);
    else localStorage.removeItem("moldable_plate_color");
    setPlateColorState(v);
    scheduleSync();
  };
  const [gridOpacity, setGridOpacityState] = useState(() => {
    const v = parseFloat(localStorage.getItem("moldable_grid_op") ?? "1");
    return Number.isFinite(v) && v >= 0.15 && v <= 1 ? v : 1;
  });
  const setGridOpacity = (v: number) => {
    localStorage.setItem("moldable_grid_op", String(v));
    setGridOpacityState(v);
    scheduleSync();
  };
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
  // Three-state theme. "system" is the DEFAULT and follows the device live — a device
  // that goes dark at sunset takes the app with it. Touching the toggle pins a choice;
  // Settings can hand it back to the system. The launchpad is the exception, below.
  const [themePref, setThemePrefState] = useState<"light" | "dark" | "system">(() => {
    const saved = localStorage.getItem("moldable_theme");
    return saved === "dark" || saved === "light" ? saved : "system";
  });
  const [sysDark, setSysDark] = useState(() => !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  // The launchpad is a lit stage — the print animation, the wordmark and the one big
  // question are composed for dark, so with no explicit choice it stays dark whatever
  // the device says. Inside the workspace, "system" means system.
  const theme: "light" | "dark" = themePref === "system"
    ? (!entered ? "dark" : sysDark ? "dark" : "light")
    : themePref;
  /** Toggling flips what is on screen and pins it — a toggle that sometimes did
   *  nothing (because the system overruled it) would be worse than no toggle. */
  const setThemeState = (v: "light" | "dark" | ((t: "light" | "dark") => "light" | "dark")) =>
    setThemePrefState(typeof v === "function" ? v(theme) : v);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Mirror the pre-paint inline script in index.html: it sets colorScheme (and a
    // dark backdrop) as INLINE styles before first paint, and inline styles outlive
    // CSS — without updating them here, toggling dark→light kept native form
    // controls (the chat composer) rendering dark in a light UI.
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = theme === "dark" ? "#121213" : "#e8e8e8"; // mirror index.html pre-paint + --page
    if (themePref === "system") localStorage.removeItem("moldable_theme");
    else localStorage.setItem("moldable_theme", themePref);
    scheduleSync(); // no-op until signed in (accountEmailRef guards it)
  }, [theme, themePref]);
  const [units, setUnitsState] = useState<"mm" | "in">(() => (localStorage.getItem("moldable_units") === "in" ? "in" : "mm"));
  const setUnits = (f: (u: "mm" | "in") => "mm" | "in") =>
    setUnitsState((u) => {
      const next = f(u);
      localStorage.setItem("moldable_units", next);
      scheduleSync();
      return next;
    });
  const [input, setInput] = useState("");
  // Ask before guessing, when a fresh request is too vague to build confidently. On by
  // default and switchable off in Settings → Building, because someone who types full
  // specs every time should never see a card.
  const [clarifyOn, setClarifyOn] = useState(() => localStorage.getItem("moldable_clarify") !== "off");
  /** Plan mode: write the spec down and agree it before spending a build. Default ON —
   *  the whole point of the app is a first model that is already right — but one tap
   *  turns it off for someone who knows exactly what they want. */
  const [planOn, setPlanOn] = useState(() => localStorage.getItem("moldable_plan") !== "off");
  const setPlan = (v: boolean) => {
    setPlanOn(v);
    try { localStorage.setItem("moldable_plan", v ? "on" : "off"); } catch { /* private mode */ }
  };
  const setClarify = (v: boolean) => {
    setClarifyOn(v);
    try { localStorage.setItem("moldable_clarify", v ? "on" : "off"); } catch { /* private mode */ }
  };
  // Improve-this-prompt, run from the composer. `improveBefore` holds what the user
  // actually typed so the rewrite is one tap from being undone — a rewrite you cannot
  // take back is a rewrite you have to proofread before every send.
  const [improving, setImproving] = useState(false);
  const [improveBefore, setImproveBefore] = useState<string | null>(null);
  const [improveNote, setImproveNote] = useState<string | null>(null);
  // Typing again means the rewrite is no longer what is in the box, so the offer to
  // revert to "the original" would be a lie. Composer edits route through here; the
  // other setInput callers (voice, Apply-to-prompt) are additive and keep it.
  const onInputChange = (v: string) => {
    setInput(v);
    if (improveBefore !== null) setImproveBefore(null);
    if (improveNote !== null) setImproveNote(null);
  };
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [svgDraft, setSvgDraft] = useState<{ text: string; url: string; name: string } | null>(null);
  const viewer = useRef<ViewerHandle>(null);

  // Warm the CAD kernel AFTER first paint has settled, not at mount: the ~11 MB
  // OCCT wasm fetch+compile otherwise competes with the app chunk, fonts and
  // thumbnails for bandwidth on first load. Anything that needs the engine sooner
  // (template tap, resume, example, chat build) calls ensureEngine() and preempts
  // this — getEngineSelection() is memoized, so first caller wins and everyone
  // shares the same single boot.
  useEffect(() => {
    // NOT gated on `entered`: the ~11 MB OpenCascade WASM compiles while the user is
    // still reading the Launchpad and typing a sentence, so time-to-first-model drops
    // rather than starting the clock at the moment they submit.
    if (sel) return;
    let alive = true;
    let kicked = false;
    let idleId = 0;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      if (!alive || kicked) return;
      kicked = true;
      setBooting(true);
      getEngineSelection()
        .then((s) => alive && setSel(s))
        .finally(() => alive && setBooting(false));
    };
    const whenIdle = () => {
      const ric = (globalThis as any).requestIdleCallback as undefined | ((cb: () => void, o?: any) => number);
      if (ric) idleId = ric(kick, { timeout: 1500 });
      else timerId = setTimeout(kick, 350);
    };
    const onLoad = () => whenIdle();
    if (document.readyState === "complete") whenIdle();
    else {
      window.addEventListener("load", onLoad, { once: true });
      timerId = setTimeout(whenIdle, 3000); // belt & braces: a stalled asset must not block the kernel forever
    }
    return () => {
      alive = false;
      window.removeEventListener("load", onLoad);
      if (timerId) clearTimeout(timerId);
      const cic = (globalThis as any).cancelIdleCallback as undefined | ((id: number) => void);
      if (idleId && cic) cic(idleId);
    };
  }, [entered, sel]);

  /** The engine, booting it NOW if the deferred warm-up hasn't run yet — shared by
   *  every path that needs a build before the idle boot lands (template, resume,
   *  example, chat). Memoized upstream, so calling it "too often" costs nothing. */
  async function ensureEngine(): Promise<EngineSelection> {
    if (sel) return sel;
    setBooting(true);
    try {
      const s = await getEngineSelection();
      setSel(s);
      return s;
    } finally {
      setBooting(false);
    }
  }

  function persist(next: Project) {
    setProject(next);
    void putProject(next);
    scheduleSync();
  }

  // ---- chat memory: every message is saved into the project, continuously ----
  const projectRef = useRef<Project | null>(null);
  const importFileRef = useRef<Blob | null>(null); // the live STEP/STL behind the code's `imported` arg
  const importKindRef = useRef<"step" | "stl">("step"); // how importFileRef parses (STL-as-CAD must not be re-read as STEP)
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

  // ---- per-part colours: save with the project (same debounced pattern) ----
  useEffect(() => {
    const t = setTimeout(() => {
      const pr = projectRef.current;
      if (!pr) return;
      if (JSON.stringify(pr.partColors ?? {}) === JSON.stringify(partColors)) return;
      const next = { ...pr, partColors, updatedAt: Date.now() };
      projectRef.current = next;
      setProject(next);
      void putProject(next);
      scheduleSync();
    }, 600);
    return () => clearTimeout(t);
  }, [partColors]);

  // ---- per-face paint: save with the project (base64 of the per-triangle index array) ----
  useEffect(() => {
    const t = setTimeout(() => {
      const pr = projectRef.current;
      if (!pr) return;
      const nextFp = facePaint ? { count: facePaint.length, b64: u8ToB64(facePaint) } : undefined;
      if (JSON.stringify(pr.facePaint) === JSON.stringify(nextFp)) return;
      const next = { ...pr, facePaint: nextFp, updatedAt: Date.now() };
      projectRef.current = next;
      setProject(next);
      void putProject(next);
      scheduleSync();
    }, 700);
    return () => clearTimeout(t);
  }, [facePaint]);

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
      const next = { ...pr, thumb, thumbV: THUMB_V, updatedAt: Date.now() };
      projectRef.current = next;
      setProject(next);
      void putProject(next);
      scheduleSync();
    }, 500);
    return () => clearTimeout(t);
  }, [geometry]);

  // ---- library thumbnails: silently upgrade stale ones to the studio look ----
  // Old captures were raw viewport grabs (theme background, selection box and gizmo
  // in shot). When the Library opens, rebuild a few stale projects OFF-SCREEN via
  // the CAD worker (or their saved mesh) and re-shoot them studio-style. Bounded
  // per open, sequential, and every touched project is version-stamped so nothing
  // is retried forever.
  const thumbUpgradeRef = useRef(false);
  const [libTick, setLibTick] = useState(0);
  async function refreshLibraryThumbs() {
    if (thumbUpgradeRef.current || !sel) return;
    thumbUpgradeRef.current = true;
    try {
      const all = await listProjects();
      const stale = all
        .filter((p) => (p.thumbV ?? 1) < THUMB_V && p.versions.length > 0 && p.id !== projectRef.current?.id)
        .slice(0, 8);
      let changed = 0;
      for (const p of stale) {
        let shot: string | null = null;
        try {
          if (p.code && sel.kind === "replicad" && !p.importFile) {
            const res = await sel.engine.build({ kind: "code", code: p.code, params: p.params, ops: p.ops });
            shot = viewer.current?.captureGeometryShot(res.geometry) ?? null;
            res.geometry.dispose();
          } else if (p.glb) {
            const { geometry: g } = await loadAnyMesh(new File([p.glb], "model.glb"));
            applyStoredMeshXform(g, p.meshXform); // thumbs show the resized/oriented state
            shot = viewer.current?.captureGeometryShot(g) ?? null;
            g.dispose();
          }
        } catch { /* unbuildable on this device — keep the old thumb, stamp it, move on */ }
        await putProject({ ...p, thumb: shot ?? p.thumb, thumbV: THUMB_V, ...(shot ? { updatedAt: Date.now() } : {}) });
        if (shot) changed++;
      }
      if (changed) {
        setLibTick((t) => t + 1); // the open Library re-queries and repaints
        scheduleSync();
      }
    } finally {
      thumbUpgradeRef.current = false;
    }
  }
  useEffect(() => {
    if (showLibrary && status !== "generating") void refreshLibraryThumbs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLibrary]);

  // ---- finish an OAuth / magic-link return (?code=...) and greet the user ----
  // The greeting is chrome, not conversation. Appending it to `messages` made
  // messages.length > 0, which unmounts the empty state (template strip, guided CTA,
  // suggestion chips) — so every OAuth user landed on a blank chat with nothing to do.
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  // The sign-in POPUP (SignInModal). Opens on demand from any Sign in affordance,
  // and ONCE per device on the first character a signed-out user types — the
  // moment they start making something worth keeping. Dismissing it is remembered
  // (device-local), so it never turns into a nag.
  const [showSignInModal, setShowSignInModal] = useState(false);
  function maybePromptSignIn() {
    if (accountEmailRef.current) return;
    if (localStorage.getItem("moldable_signin_prompted")) return;
    try { localStorage.setItem("moldable_signin_prompted", "1"); } catch { /* private mode */ }
    setShowSignInModal(true);
  }
  // The provider wall, kept as state rather than a dead-end chat line: the sentence the
  // user typed is preserved and offered two live exits (a free key, or build it as a
  // mesh right now). Every branch still ends in geometry.
  const [providerWall, setProviderWall] = useState<string | null>(null);
  // Export used to have no filename control (every path derived it from project.name,
  // silently falling back to "model") and no busy state at all, even though each path
  // is async — a dynamic import plus a worker round-trip for STEP.
  const [exportName, setExportName] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (!hasAuthReturn()) return;
    void completeAuthReturn().then((u) => {
      if (u) {
        setEntered(true);
        setAuthNotice(`Signed in as ${u.email} — your settings and projects can now sync (Settings → Sync).`);
      }
    });
  }, []);

  // ---- session memory: reopen the last project (chat + model) after a reload ----
  useEffect(() => {
    if (project?.id) localStorage.setItem("moldable_last_project", project.id);
  }, [project?.id]);
  useEffect(() => { setExportName(""); }, [project?.id]); // a new project re-derives the default
  const exportBase = () => (exportName.trim() || project?.name || "model");
  /** Every export is async (dynamic import, plus a worker round-trip for STEP). This is
      the only thing that lets the UI say so — nothing disabled or spun before. */
  const busyExport = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => {
    setExporting(true);
    try { await fn(...a); } finally { setExporting(false); }
  };
  // Land on a FRESH start screen; offer the last session as a one-tap resume
  // chip instead of auto-opening it (auto-open replayed stale errors on load).
  const [resume, setResume] = useState<{ id: string; name: string } | null>(null);
  // The four most recently touched projects, shown on the Launchpad as thumbnails.
  // Deliberately NOT a second library page: the Library modal already does thumbnails,
  // search, rename and delete, so the entry screen shows the few you actually want and
  // hands off to it for everything else.
  const [recent, setRecent] = useState<{ id: string; name: string; engine: string; thumb?: string }[]>([]);
  /** Re-read the four most recent projects. Called at boot and again on every return to
      the Launchpad — otherwise the row would still show what existed at page load, and
      the part you had open a second ago would be missing from your own recents. */
  function loadRecent() {
    return listProjects().then((all) => {
      setRecent(
        [...all]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 4)
          .map((p) => ({ id: p.id, name: p.name, engine: p.engine, thumb: p.thumb })),
      );
    }).catch(() => { /* no store yet — the row just doesn't render */ });
  }
  useEffect(() => {
    const id = localStorage.getItem("moldable_last_project");
    if (id) {
      void getProject(id).then((p) => {
        if (!p) return;
        // Reloading INSIDE the workspace reopens what was on the canvas — an empty
        // workspace after a refresh reads as "my work is gone". From the launchpad it
        // stays an offer (the resume chip), because that screen is a deliberate choice.
        if (localStorage.getItem("moldable_entered") === "1") void openProjectById(p);
        else setResume({ id: p.id, name: p.name });
      });
    }
    void loadRecent();
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
      // A rename is a deliberate "save this" moment — sync NOW instead of waiting
      // out the debounce (felt like it hadn't saved).
      void runSync();
    } else {
      const chat = messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, text: m.text, error: m.error, image: m.image }));
      const shell = { ...newProject(clean, "replicad"), chat, pins };
      projectRef.current = shell;
      persist(shell);
    }
  }

  // Quick model/engine switches from the in-chat picker (no keys touched — that
  // stays in Settings). Persist so the choice survives a reload, same as Settings.
  // Local-LLM discovery: one probe of Ollama's well-known port on load. The offer
  // banner shows while a daemon with models is up and Ollama isn't already the brain.
  const [ollamaInfo, setOllamaInfo] = useState<OllamaInfo | null>(null);
  const [ollamaDismissed, setOllamaDismissed] = useState(() => {
    try { return localStorage.getItem("moldable_ollama_dismissed") === "1"; } catch { return true; }
  });
  useEffect(() => { void detectOllama().then(setOllamaInfo); }, []);
  /** Switch the brain to a detected local model — free, private, offline. */
  function useOllama(pickedModel: string) {
    const s: LlmSettings = { provider: "ollama", model: pickedModel };
    localStorage.setItem(LLM_LS, JSON.stringify(s));
    setLlm(s);
    scheduleSync();
  }

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
    // Slimmed at attach time, so the preview, the chip and every request downstream all
    // carry the same right-sized blob (see downscale.ts for the why and the ceilings).
    void downscaleImage(file).then((eff) => {
      setImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob: eff, url: URL.createObjectURL(eff) };
      });
    });
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
    for (const r of refs) URL.revokeObjectURL(r.url);
    setRefs([]);
  }

  /** A multi-file attach (drop, paste, picker): first raster becomes THE reference,
   *  the rest ride along as unlabelled extra references — nobody is made to say which
   *  photo is the front. Non-rasters (SVG, 3D files) keep their special handling via
   *  pickImage, one at a time. */
  function pickImages(files: File[]) {
    const rasters = files.filter((f) => f.type.startsWith("image/") && f.type !== "image/svg+xml");
    const rest = files.filter((f) => !rasters.includes(f));
    if (rest.length) pickImage(rest[0]); // svg/3d: single-file semantics, unchanged
    if (!rasters.length) return;
    if (!image) pickImage(rasters[0]);
    const extras = (image ? rasters : rasters.slice(1)).slice(0, 5 - refs.length);
    if (extras.length) {
      void Promise.all(extras.map((f) => downscaleImage(f))).then((slim) => {
        setRefs((r) => [...r, ...slim.map((b) => ({ blob: b, url: URL.createObjectURL(b) }))]);
      });
    }
  }

  // Paste an image straight from the clipboard (screenshot, copied file) anywhere
  // in the app — INCLUDING the Launchpad, where it lands in the launch composer's
  // attachment chip. The old `entered` gate made paste dead on the front door.
  useEffect(() => {
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

  // ---------------- printability pack: overhang view / orientation / walls / chamfer ----------------
  const [overhangView, setOverhangView] = useState(false);
  const [thinReport, setThinReport] = useState<ThinWallReport | null>(null);
  const [thinShow, setThinShow] = useState(false);
  const [thinBusy, setThinBusy] = useState(false);
  const [orientSug, setOrientSug] = useState<OrientSuggestion | null>(null);
  // Analyses describe ONE mesh — a rebuild invalidates them (the heatmap recomputes itself).
  useEffect(() => {
    setThinReport(null);
    setThinShow(false);
    setOrientSug(null);
  }, [geometry]);
  // The paint-on overlay the viewer draws: thin-wall highlight wins while shown
  // (it's the result the user just asked for), otherwise the live overhang heatmap.
  const analysisOverlay = useMemo(() => {
    if (!geometry) return null;
    if (thinShow && thinReport && thinReport.overlay.triangles > 0) return thinReport.overlay;
    if (overhangView) return overhangOverlay(geometry, printer.overhangThresholdDeg);
    return null;
  }, [geometry, overhangView, thinShow, thinReport, printer.overhangThresholdDeg]);

  function runThinWalls() {
    if (!geometry || thinBusy) return;
    setThinBusy(true);
    // Yield a frame so the button's busy state paints before the scan blocks the thread.
    setTimeout(async () => {
      try {
        const { findThinWalls } = await import("./print/thinwalls"); // three-mesh-bvh loads on demand
        // Coverage scales with the mesh: the flat 800-sample cap left a million-triangle
        // sculpt 99.9% unexamined while the result read as a clean bill of health.
        const pos = geometry.getAttribute("position");
        const tris = Math.floor((geometry.index ? geometry.index.count : pos.count) / 3);
        const rep = findThinWalls(geometry, thinWallLimitMM(printer), { maxSamples: Math.min(6000, Math.max(800, Math.round(tris / 4))) });
        setThinReport(rep);
        setThinShow(rep.thinSamples > 0);
      } catch (err: any) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Wall-thickness check failed: " + String(err?.message ?? err), error: true }]);
      } finally {
        setThinBusy(false);
      }
    }, 30);
  }

  function runOrientSuggest() {
    if (!geometry) return;
    try {
      setOrientSug(suggestOrientation(geometry, printer.overhangThresholdDeg, printer.bed));
    } catch {
      setOrientSug(null);
    }
  }

  /** Rotate the WHOLE model about its centre and rest it on the plate: CAD models get
   *  a parametric rotate op (History/Undo, sliders and export all follow); meshes get
   *  the rotation baked in. Either path ends resting on the plate — CAD display/export
   *  re-ground to z=0, bakeMeshTransform settles meshes there itself. */
  async function rotateOntoPlate(axis: [number, number, number], angleDeg: number, summary: string) {
    if (!geometry || !result) return;
    if (result.source.kind === "code" && activeKind === "replicad") {
      geometry.computeBoundingBox();
      const c = geometry.boundingBox!.getCenter(new THREE.Vector3());
      await authorObjectOp({ kind: "rotate", axis, angleDeg, center: [c.x, c.y, c.z] });
    } else {
      // Mesh model: bake the rotation, keep the ORIGINAL glb + texture, and record
      // the matrix (meshXform) so the orientation survives reopening the project.
      geometry.computeBoundingBox();
      const c = geometry.boundingBox!.getCenter(new THREE.Vector3());
      const m = new THREE.Matrix4()
        .makeTranslation(c.x, c.y, c.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(), THREE.MathUtils.degToRad(angleDeg)))
        .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      const baked = bakeMeshTransform(geometry, m);
      const dd = baked.dims;
      applyResult(
        { ...result, geometry: baked.geometry, dims: dd, meshXform: composeXform(result.meshXform, baked.applied) },
        project?.name ?? "Model",
        `${summary} — ${dd.x} × ${dd.y} × ${dd.z} mm`,
        summary,
      );
    }
  }

  /** Apply the suggested print orientation (auto lay-flat). */
  async function applyOrientation(sug?: OrientSuggestion) {
    const s = sug ?? orientSug;
    if (!s?.improved || !geometry || !result) return;
    await rotateOntoPlate(s.axis, s.angleDeg, "Auto-oriented for printing");
    setOrientSug(null);
    explainOnce(
      "orient",
      `Rotated the part to its best printing orientation and dropped it flat onto the plate — ${s.reason} Less support means faster prints, less filament and cleaner surfaces. Undo reverts it.`,
      `Auto-oriented: ${s.reason}`,
    );
  }

  /** One click: find the best print orientation and rest the part flat on the plate. */
  async function autoOrientDrop() {
    if (!geometry || status === "generating") return;
    let s: OrientSuggestion | null = null;
    try { s = suggestOrientation(geometry, printer.overhangThresholdDeg, printer.bed); } catch { /* degenerate geometry — nothing to say */ }
    if (!s) return;
    setOrientSug(s); // Printability panel shows the numbers either way
    if (!s.improved) {
      appendMsg({ role: "assistant", text: `Left as is — ${s.reason} It's already resting flat on the plate.` });
      return;
    }
    await applyOrientation(s);
  }

  /** "Place on face", slicer-style: rotate the model so the right-clicked face points
   *  at the bed, then rest it on the plate. The user picks the base; no scoring. */
  async function snapFaceToPlate(normal: [number, number, number]) {
    if (!geometry || !result || status === "generating") return;
    const from = new THREE.Vector3(normal[0], normal[1], normal[2]);
    if (from.lengthSq() < 0.5) return; // degenerate triangle — nothing trustworthy to align
    from.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(0, 0, -1));
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (angle < 0.005) {
      appendMsg({ role: "assistant", text: "That face is already flat on the plate." });
      return;
    }
    // Quaternion → axis + degrees (flip the axis when w < 0 so they reproduce q exactly);
    // a 180° flip has no unique axis — any horizontal one works, X is fine.
    const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    const sign = q.w < 0 ? -1 : 1;
    const axis: [number, number, number] = s < 1e-6 ? [1, 0, 0] : [(q.x / s) * sign, (q.y / s) * sign, (q.z / s) * sign];
    await rotateOntoPlate(axis, Math.round(THREE.MathUtils.radToDeg(angle) * 10) / 10, "Rested the picked face on the plate");
    setOrientSug(null); // any auto-orient advice described the old pose
    explainOnce(
      "facesnap",
      "Rotated the model so the face you right-clicked sits flat on the plate — the slicer \"place on face\" move. Great for picking the printing base yourself; **Lay flat — best orientation** (Printability) picks it by support math instead. Undo reverts it.",
      "Rested that face on the plate. Undo reverts it.",
    );
  }

  /** Elephant-foot guard: chamfer every bed-plane edge of the CAD solid. */
  async function applyChamferBottom(size: number) {
    if (!result || result.source.kind !== "code" || !sel || activeKind !== "replicad") {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "The elephant-foot chamfer edits the real CAD solid, so it works on Precise (CAD) models.", error: true }]);
      return;
    }
    const src = result.source;
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), { type: "chamferBottom", size }] });
      applyResult(res, project?.name ?? "Model", `Elephant-foot chamfer: ${size} mm off the bottom edges`, `chamfer bottom ${size}`);
      explainOnce(
        "efoot",
        `Chamfered every bottom edge by **${size} mm** — the elephant-foot guard. The squished first layer bulges outward on most printers; this bevel absorbs the bulge so the footprint stays true and holes near the bed keep their size. Undo reverts it.`,
        `Elephant-foot chamfer ${size} mm applied.`,
      );
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't chamfer the bottom edges: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  // Objects-panel badge: which engine/AI produced the current model. Mesh engines are
  // color-coded per provider; deterministic sources (imports, SVG, split…) read plainly.
  // (Per-CAD-version LLM attribution isn't stored yet — CAD models show "CAD".)
  // Which way the drilled pockets open in the current orientation — the export gate's
  // "will the magnet actually seat" row. Recomputed whenever the model (and so its
  // ops chain, rotations included) changes.
  const pocketReport = useMemo(
    () => pocketFacing(result?.source.kind === "code" ? result.source.ops : undefined),
    [result],
  );
  // Models drilled before pockets seated flush get ONE offer per project to catch up —
  // positions and diameters stay; only the legacy depth padding goes.
  const flushOffered = useRef<string | null>(null);
  useEffect(() => {
    const pid = projectRef.current?.id;
    if (!pid || !result || result.source.kind !== "code" || flushOffered.current === pid) return;
    const legacy = legacyPocketFix(result.source.ops);
    if (!legacy) return;
    flushOffered.current = pid;
    setMessages((m) => [...m, {
      id: mid(), role: "assistant", text: "",
      offer: {
        kind: "flush",
        text: `This model's ${legacy.n} magnet pocket${legacy.n === 1 ? " was" : "s were"} drilled before pockets seated flush — each was cut a little deeper than its magnet, which is why they sit sunken. One tap re-cuts them at exactly magnet depth: same positions, same diameters, only the extra depth goes.`,
        yes: "Re-cut them flush",
        no: "Leave them as drilled",
      },
    }]);
  }, [result]);

  const modelBadge = useMemo(() => {
    if (!result) return null;
    if (result.source.kind === "gen") {
      const src = result.source;
      const colors: Record<string, string> = { hf: "#f59e0b", fal: "#8b5cf6", tripo: "#3b82f6", meshy: "#22c55e", replicate: "#ec4899" };
      const prov = getProvider(src.provider);
      if (prov) {
        const m = prov.models.find((x) => x.id === src.model);
        return { label: (m?.label ?? prov.label).split(" — ")[0].split(" (")[0], color: colors[src.provider] ?? "#64748b" };
      }
      const plain: Record<string, string> = { import: "imported file", svg: "SVG", split: "split", separate: "separated", orient: "auto-orient", scale: "resized" };
      return { label: plain[src.provider] ?? src.provider, color: "#64748b" };
    }
    return { label: result.kind === "replicad" ? "CAD" : "CSG", color: "#376b55" };
  }, [result]);

  function computeReport(geo: THREE.BufferGeometry): PrintabilityReport | null {
    try {
      return analyzePrintability(geo, { bed: printer.bed, overhangThresholdDeg: printer.overhangThresholdDeg });
    } catch {
      return null;
    }
  }

  function applyResult(res: EngineResult, name: string, summary: string, promptText: string, extras?: { splitPieces?: Version["splitPieces"] }) {
    dissolveSeparation(); // a committed result replaces the model — the dry-fit sandbox's floating parts must not linger
    clearPaintHistory(); // strokes are keyed to the old triangle list; they can't replay onto new geometry
    applyResultNoCommit(res);

    // projectRef, not the closure's `project`: canvas tools commit from listeners older
    // than the current render, and appending onto a stale project silently discards the
    // versions recorded since it.
    const base = projectRef.current ?? newProject(name, res.kind);
    const named = base.versions.length === 0 && name ? { ...base, name } : base;
    const snap = appendVersion(named, {
      engine: res.kind,
      summary,
      code: res.source.kind === "code" ? res.source.code : undefined,
      params: res.source.kind === "code" ? res.source.params : undefined,
      ops: res.source.kind === "code" ? res.source.ops : undefined,
      importFile: res.source.kind === "code" ? importFileRef.current ?? undefined : undefined,
      importKind: res.source.kind === "code" && importFileRef.current ? importKindRef.current : undefined,
      spec: res.source.kind === "spec" ? res.source.spec : undefined,
      dims: res.dims,
      glb: res.glb,
      meshXform: res.meshXform,
      genSource: res.source.kind === "gen" ? { provider: res.source.provider, model: res.source.model, prompt: res.source.prompt } : undefined,
      splitPieces: extras?.splitPieces,
    });
    // Chat is synced separately (continuous effect) — keep whatever is there.
    snap.chat = projectRef.current?.chat ?? base.chat;
    persist(snap);
    stampHeadThumb();
  }

  // ---- History thumbnails: every version carries a mini capture of the canvas as it
  // looked when the change landed (current camera, current pose). Deferred a beat so
  // the new geometry has actually painted; ~3-6 KB webp each.
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stampHeadThumb(onlyIfMissing = false) {
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(() => {
      const p = projectRef.current;
      if (!p) return;
      const i = headIndex(p);
      if (i < 0) return;
      if (onlyIfMissing && p.versions[i].thumb) return;
      const shot = viewer.current?.captureMini?.(96);
      if (!shot || p.versions[i].thumb === shot) return;
      const versions = [...p.versions];
      versions[i] = { ...versions[i], thumb: shot };
      const next = { ...p, versions };
      projectRef.current = next;
      setProject(next);
      void putProject(next); // quiet save — the next real change carries it to the cloud
    }, 400);
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
      const merged = defs ? { ...defs, ...(res.source.params ?? {}) } : {};
      setParamValues(merged);
      // Whatever just rendered is, by definition, a set that builds — so it's the
      // rollback target if the next adjustment doesn't.
      lastGoodParams.current = merged;
    } else {
      setCadDefaults(null);
      setParamValues({});
      lastGoodParams.current = null;
    }
  }

  /** Slider change: rebuild the SAME code with new dimensions — no AI call, no version spam. */
  // Every parameter rebuild — live or committed — carries a generation. A newer request
  // invalidates every older one still in flight, so a slow LIVE build finishing after
  // the release commit can't repaint the model with the stale mid-drag value (measured:
  // released at 20 mm, model settled at 17.5 mm).
  const paramGen = useRef(0);
  // `status` in this closure is the render's value, and setStatus is async — two commits
  // dispatched in one event turn (blur-then-click on a row's revert) both read "idle" and
  // both build. The ref is the truth; a commit arriving mid-build is REMEMBERED, not
  // dropped, so a fast second keystroke or click can't be silently lost.
  const paramBusy = useRef(false);
  const paramPending = useRef<{ values: CadParams; key?: string } | null>(null);
  const lastGoodParams = useRef<CadParams | null>(null);
  /** An adjustment is a real edit, so Undo has to cover it — it used to rebuild without
   *  recording anything, and undo skipped straight past every dimension change to the
   *  previous AI turn. Coalesced by key and time so ONE drag (or a run of arrow-key
   *  nudges on the same row) is one undo step instead of forty, and the version carries
   *  `ops`, so stepping back through an adjustment keeps the magnet pockets. */
  const paramEdit = useRef<{ key: string; at: number } | null>(null);
  function recordParamVersion(res: EngineResult, values: CadParams) {
    const proj = projectRef.current;
    if (!proj || res.source.kind !== "code") return;
    // Diff against the version at HEAD — the last state actually recorded. Diffing
    // against "last good" instead recorded nothing at all: every live drag tick builds
    // successfully and moves that mark, so by the time the release committed there was
    // no difference left to describe.
    const i = headIndex(proj);
    const base = { ...(cadDefaults ?? {}), ...(i >= 0 ? proj.versions[i]?.params ?? {} : {}) };
    const changed = Object.keys(values).filter((k) => values[k] !== base[k]);
    if (!changed.length) return;
    const key = changed.slice().sort().join(",");
    const now = Date.now();
    const mark = paramEdit.current;
    const coalesce = !!mark && mark.key === key && now - mark.at < 2500 && headIndex(proj) >= 0
      && /^Adjusted /.test(proj.versions[headIndex(proj)]?.summary ?? "");
    paramEdit.current = { key, at: now };
    const label = changed.map(humanizeParam).join(", ");
    const snap = {
      engine: res.kind,
      summary: `Adjusted ${label} — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`,
      code: res.source.code,
      params: values,
      ops: res.source.ops,
      importFile: importFileRef.current ?? undefined,
      importKind: importFileRef.current ? importKindRef.current : undefined,
      dims: res.dims,
    };
    const next = coalesce ? replaceHeadVersion(proj, snap) : appendVersion(proj, snap);
    next.chat = projectRef.current?.chat ?? proj.chat;
    persist(next);
    stampHeadThumb();
  }
  /** Params whose value is a rounding/bevel size — the ones a shrinking part outgrows. */
  const RADIUS_PARAM_RE = /rad|fillet|chamfer|round|bevel/i;
  /** The #1 way an Adjust value "won't build": the user shrinks a dimension and a
   *  LEFTOVER corner/fillet radius no longer fits it (a 30 mm width cannot carry the
   *  22.5 mm corner round that suited 87). Refusing the size the user actually typed,
   *  over a parameter they didn't touch, reads as a broken slider — so instead find
   *  the largest radius the kernel accepts at the new size and apply both. The kernel
   *  is the ground truth: binary-search real builds, no geometry guessing. */
  async function rescueParams(values: CadParams, changed: string[]): Promise<{ res: EngineResult; key: string; safe: number } | null> {
    if (!sel || !result || result.source.kind !== "code") return null;
    const src = result.source;
    const tryBuild = async (v: CadParams) => {
      try { return await sel.engine.build({ kind: "code", code: src.code, params: v, ops: src.ops }); } catch { return null; }
    };
    // Only radii the user did NOT just type: their typed value is the intent, the
    // leftover radius is the obstacle. Biggest first — it's the likeliest blocker.
    const radii = Object.keys(values)
      .filter((k) => RADIUS_PARAM_RE.test(k) && !changed.includes(k) && typeof values[k] === "number" && (values[k] as number) > 0.5)
      .sort((a, b) => (values[b] as number) - (values[a] as number));
    for (const key of radii) {
      const orig = values[key] as number;
      // Prove this radius IS the blocker before searching: near-zero must build.
      const floor = 0.4;
      if (!(await tryBuild({ ...values, [key]: floor }))) continue;
      let lo = floor, hi = orig; // invariant: lo builds, hi doesn't
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (await tryBuild({ ...values, [key]: mid })) lo = mid; else hi = mid;
      }
      // Step back from the cliff edge — a radius AT the numeric limit builds but
      // leaves knife-edge geometry — and land on a tidy 0.5 step someone might have
      // chosen on purpose.
      const safe = Math.max(floor, Math.floor(lo * 0.95 * 2) / 2);
      const res = await tryBuild({ ...values, [key]: safe });
      if (res) return { res, key, safe };
    }
    return null;
  }
  /** The OTHER way a slider wedges: a point-anchored op — a fillet on a picked edge,
   *  a bevel on a picked face — whose geometry a size change moved out from under it.
   *  The pick point no longer lands on an edge, the whole rebuild throws, and every
   *  later adjustment fails on the same dead op, forever. When that happens, find the
   *  smallest set of point-ops that no longer apply and rebuild without them: the size
   *  the user just typed is the intent; a 2 mm cosmetic fillet is not worth a bricked
   *  panel. The version records the reduced recipe, so Undo restores the fillet. */
  async function rescueOps(values: CadParams): Promise<{ res: EngineResult; dropped: string[] } | null> {
    if (!sel || !result || result.source.kind !== "code") return null;
    const src = result.source;
    const ops = src.ops ?? [];
    const POINTY: Record<string, string> = { fillet: "edge rounding", chamfer: "edge bevel", "face-fillet": "face rounding", "face-chamfer": "face bevel", extrude: "push/pull" };
    const idxs = ops.map((o, i) => (POINTY[o.type] ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return null;
    const tryBuild = async (keep: (i: number) => boolean) => {
      try { return await sel.engine.build({ kind: "code", code: src.code, params: values, ops: ops.filter((_, i) => keep(i)) }); } catch { return null; }
    };
    const label = (i: number) => { const o = ops[i] as PointOp; return `${o.size} mm ${POINTY[o.type] ?? o.type}`; };
    // Newest first — the latest decoration is the likeliest to sit on moved geometry.
    for (const i of [...idxs].reverse()) {
      const res = await tryBuild((j) => j !== i);
      if (res) return { res, dropped: [label(i)] };
    }
    const res = await tryBuild((j) => !POINTY[ops[j].type]);
    if (res) return { res, dropped: idxs.map(label) };
    return null;
  }
  async function applyParams(values: CadParams, editedKey?: string) {
    if (!sel || !result || result.source.kind !== "code") return;
    // A commit that arrives mid-build waits its turn — but it must NOT be replayed
    // verbatim later. The map was assembled from the values the user was LOOKING AT,
    // and by the time it runs a radius rescue may have moved other params; replaying
    // the stale copy would then read as the user editing the radius back up, which
    // both fails and disqualifies it from rescue. Remember WHICH key they edited and
    // rebase onto whatever is true when the turn comes.
    if (paramBusy.current) { paramPending.current = { values, key: editedKey }; return; }
    paramBusy.current = true;
    const gen = ++paramGen.current;
    // The commit supersedes the drag: drop what's queued AND stop the live loop from
    // starting another iteration. Clearing `next` alone left a window — the loop could
    // have already picked a queued value up and would then bump the generation PAST
    // the commit's, so a stale mid-drag value won the race (measured 17.5 vs 20).
    liveParamRun.current.next = null;
    liveParamRun.current.stop = true;
    // Rollback target = the last map that actually BUILT, held in a ref: a queued commit
    // re-enters this function through the same render closure, where `paramValues` is
    // whatever it was at render time.
    const prevValues = lastGoodParams.current ?? paramValues;
    const changed = Object.keys(values).filter((k) => values[k] !== prevValues[k]);
    setParamValues(values);
    setStatus("generating");
    try {
      // ops MUST ride along: drilled holes and magnet pockets live in the op chain, and
      // rebuilding from code+params alone silently erased every one of them.
      const res = await sel.engine.build({ kind: "code", code: result.source.code, params: values, ops: result.source.ops });
      lastGoodParams.current = values;
      if (paramGen.current === gen) {
        applyResultNoCommit(res);
        recordParamVersion(res, values);
      }
    } catch (err: any) {
      // Before refusing, see what's really in the way. First a leftover radius param —
      // only when the user's own edit was a SIZE, not the radius itself (then the
      // refusal is the honest answer: the value they want is impossible).
      const rescue = changed.length && changed.some((k) => !RADIUS_PARAM_RE.test(k))
        ? await rescueParams(values, changed)
        : null;
      // Then a point-anchored fillet/bevel whose edge the size change moved away.
      const shed = !rescue && changed.length ? await rescueOps(values) : null;
      if (paramGen.current === gen) {
        if (rescue) {
          const fixedVals = { ...values, [rescue.key]: rescue.safe };
          lastGoodParams.current = fixedVals;
          setParamValues(fixedVals);
          applyResultNoCommit(rescue.res);
          recordParamVersion(rescue.res, fixedVals);
          appendMsg({
            role: "assistant",
            text: `Done — ${changed.map(humanizeParam).join(", ")} applied. It needed one more change: the part can't carry a ${values[rescue.key]} mm ${humanizeParam(rescue.key).toLowerCase()} at this size, so that came down to ${rescue.safe} mm — the largest that still builds. Undo reverts both together.`,
          });
        } else if (shed) {
          lastGoodParams.current = values;
          setParamValues(values);
          applyResultNoCommit(shed.res);
          recordParamVersion(shed.res, values);
          appendMsg({
            role: "assistant",
            text: `Done — ${changed.map(humanizeParam).join(", ")} applied. The ${shed.dropped.join(" and the ")} you'd added couldn't follow: the spot it was picked on moved with the new size, so it was removed from the recipe. Undo brings it back, or re-apply it on the new shape with Select.`,
          });
        } else {
          // Un-buildable values must NOT stick. Every commit sends the whole map, so a
          // value left in place after a failure rode along on every later adjustment and
          // failed them all — the panel became permanently stuck with no way back but
          // guessing which row was at fault. Roll back and name the culprit (once —
          // appendMsg folds the identical bubble a second identical failure produces).
          setParamValues(prevValues);
          const which = changed.length ? `${changed.map(humanizeParam).join(", ")} ` : "";
          appendMsg({ role: "assistant", text: `${which}won't build at that value — kept the last one that worked. (${String(err?.message ?? err)})`, error: true });
        }
      }
    } finally {
      setStatus("idle");
      paramBusy.current = false;
      // A commit that arrived mid-build is applied now, so nothing is silently dropped.
      const queued = paramPending.current;
      paramPending.current = null;
      if (queued) {
        const base = lastGoodParams.current;
        const v = queued.key && base ? { ...base, [queued.key]: queued.values[queued.key] } : queued.values;
        void applyParams(v, queued.key);
      }
    }
  }
  // ---- Typed dimensions: set a measured distance by typing the number you want ----
  /** What can actually DRIVE a measured distance to a new value. Named parameters
   *  first — changing "magnet spacing" is exact and rebuilds through the same path a
   *  slider does. Failing that, a uniform rescale along the measurement's own axis is
   *  still deterministic and free. Nothing here spends a token: this is arithmetic,
   *  and handing arithmetic to a language model is how you get 9.97 mm. */
  type DimDriver =
    | { kind: "param"; key: string; label: string; current: number }
    | { kind: "scale"; axis: "x" | "y" | "z"; label: string; current: number };

  function dimDrivers(measured: number, span?: [number, number, number]): DimDriver[] {
    const out: DimDriver[] = [];
    // A parameter whose CURRENT value is what the tape reads is almost certainly the
    // one that put those two points there. Tolerance covers tessellation and the
    // user's aim; anything looser starts matching unrelated numbers.
    const tol = Math.max(0.25, measured * 0.02);
    for (const [k, v] of Object.entries(paramValues)) {
      if (typeof v !== "number") continue;
      if (Math.abs(v - measured) <= tol) out.push({ kind: "param", key: k, label: humanizeParam(k), current: v });
      // Half-value too: a diameter measured across a circle is often stored as radius.
      else if (Math.abs(v * 2 - measured) <= tol) out.push({ kind: "param", key: k, label: `${humanizeParam(k)} (radius)`, current: v });
    }
    // …and the fallback: rescale along whichever axis the measurement mostly runs
    // down. Offered last because it moves EVERYTHING, which is right for "make the
    // part 10 mm wider" and wrong for "make this one hole 10 mm".
    if (span && dims) {
      const ax = (["x", "y", "z"] as const).reduce((best, k, i) =>
        Math.abs(span[i]) > Math.abs(span[["x", "y", "z"].indexOf(best) as 0 | 1 | 2]) ? k : best, "x" as "x" | "y" | "z");
      out.push({ kind: "scale", axis: ax, label: `Rescale the whole part (${ax.toUpperCase()})`, current: dims[ax] });
    }
    return out;
  }

  /** Apply a typed dimension through the chosen driver. */
  async function applyTypedDim(driver: DimDriver, measured: number, target: number) {
    if (!(target > 0.01) || Math.abs(target - measured) < 1e-3) return;
    if (driver.kind === "param") {
      // Radius-backed parameters take half of what was measured across the circle.
      const isRadius = driver.label.endsWith("(radius)");
      await applyParams({ ...paramValues, [driver.key]: isRadius ? target / 2 : target });
      return;
    }
    // A whole-body rescale: the measured span grows by the same ratio as the part.
    scaleToDim(driver.axis, (dims?.[driver.axis] ?? 0) * (target / measured));
  }

  // Mid-scrub live preview. Differs from applyParams on purpose: it never flips global
  // status (which disables the very rows being dragged — the old "params feel broken"
  // report), never posts error bubbles (transient mid-drag values legitimately fail to
  // build; release commits through applyParams, which does report), and it queues
  // trailing-latest so a slow kernel rebuild coalesces the stream of drag values
  // instead of piling them up.
  const liveParamRun = useRef<{ running: boolean; next: CadParams | null; stop: boolean }>({ running: false, next: null, stop: false });
  async function applyParamsLive(values: CadParams) {
    if (!sel || !result || result.source.kind !== "code") return;
    setParamValues(values);
    if (liveParamRun.current.running) { liveParamRun.current.next = values; return; }
    liveParamRun.current.running = true;
    liveParamRun.current.stop = false; // a fresh drag clears the previous commit's stop
    const src = result.source;
    let v: CadParams | null = values;
    while (v) {
      if (liveParamRun.current.stop) break; // a commit landed — it owns the model now
      const gen = ++paramGen.current;
      try {
        // preview: coarse mesh, and no limit-probing — an op that stops fitting at a
        // mid-drag value otherwise costs up to eight extra bisection rebuilds per tick
        // to produce an error this loop then throws away.
        const res = await sel.engine.build({ kind: "code", code: src.code, params: v, ops: src.ops, preview: true });
        if (paramGen.current === gen) applyResultNoCommit(res);
      } catch { /* transient drag value — the release commit surfaces real errors */ }
      v = liveParamRun.current.next;
      liveParamRun.current.next = null;
    }
    liveParamRun.current.running = false;
  }

  // ---- Parameter peek -----------------------------------------------------------
  // Sliders are named after variables in generated code (plateWidth, hookReach, tipHeight)
  // and the names change with every model, so reading them tells you nothing about WHICH
  // part of the object they move. Grabbing a slider now builds the model once with that
  // value nudged up and shows the geometric difference on the canvas — the same green/red
  // overlay the AI change preview uses. You see the region before you touch it.
  //
  // Never touches the live model: it builds into a throwaway result and only diffs.
  const [paramPeek, setParamPeek] = useState<Float32Array | null>(null);
  const peekSeq = useRef(0);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cache keyed by (code, every current value, param) — so re-hovering a slider you already
  // looked at is instant, while ANY change to the model or another value invalidates the
  // whole set. A probe is a full OCCT rebuild plus a BVH pass; paying that twice for the
  // same question is the difference between the panel feeling live and feeling laggy.
  const peekCache = useRef(new Map<string, Float32Array | null>());
  // Hash the CODE, not its length: an AI edit that preserves length (`wall = 2` →
  // `wall = 3`) with the same defaultParams was a cache HIT, so the overlay showed the
  // previous model's highlight.
  const hashStr = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const peekKeyBase = (code: string, vals: CadParams) =>
    `${hashStr(code)}:${Object.keys(vals).sort().map((k) => `${k}=${vals[k]}`).join(",")}`;

  function endParamPeek() {
    peekSeq.current++;                       // invalidates any build still in flight
    if (peekTimer.current) { clearTimeout(peekTimer.current); peekTimer.current = null; }
    setParamPeek(null);
  }
  // The overlay is parented to the model's vertices, so it goes stale the moment the
  // model rebuilds — and nothing cleared it: leaving the Adjust panel unmounts the rows
  // without a pointerleave, so a highlight could sit on the canvas indefinitely.
  useEffect(() => { endParamPeek(); }, [geometry, cadDefaults]);

  function peekParam(key: string) {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    // Hover intent: sweeping the cursor across a stack of sliders must not fire a build
    // per row. Only a deliberate rest on one triggers the probe.
    peekTimer.current = setTimeout(() => void runParamPeek(key), 260);
  }

  async function runParamPeek(key: string) {
    const src = result?.source;
    if (!sel || !result || src?.kind !== "code" || status === "generating") return;
    // A scrub that starts inside the hover-intent window must cancel the probe: the live
    // path deliberately leaves `status` idle, so nothing else stops a full extra OCCT
    // build landing mid-drag — which also evicts the kernel's single-entry base cache
    // and makes every following drag tick recompile from scratch.
    if (liveParamRun.current.running || paramBusy.current) return;
    const seq = ++peekSeq.current;
    const base = { ...(src.params ?? {}), ...paramValues };
    const v = base[key];
    if (typeof v !== "number") return;
    // ops in the key AND the build: rotations (gizmo, lay-flat) and drilled/magnet/screw
    // pockets live in the op chain — probing without them diffed the displayed (rotated)
    // model against an unrotated probe, so the highlight drew the part's OLD pose.
    const ck = `${peekKeyBase(src.code, base)}:${hashStr(JSON.stringify(src.ops ?? []))}|${key}`;
    if (peekCache.current.has(ck)) { setParamPeek(peekCache.current.get(ck) ?? null); return; }
    // Big enough to be visible at a glance, small enough that the shape stays itself.
    const bump = Math.max(Math.abs(v) * 0.18, 1.5);
    try {
      const probe = await sel.engine.build({ kind: "code", code: src.code, params: { ...base, [key]: v + bump }, ops: src.ops, preview: true });
      if (seq !== peekSeq.current) return;   // pointer moved on — drop the stale result
      const { affectedFaces } = await import("./print/affected");
      // display = engine - recenter, so probe -> base frame is +rcProbe - rcBase.
      const rcB = result.recenter ?? [0, 0, 0];
      const rcP = probe.recenter ?? [0, 0, 0];
      const faces = affectedFaces(result.geometry, probe.geometry, {
        probeOffset: [rcP[0] - rcB[0], rcP[1] - rcB[1], rcP[2] - rcB[2]],
      });
      if (peekCache.current.size > 40) peekCache.current.clear();   // bounded; keys are per-model anyway
      peekCache.current.set(ck, faces);
      if (seq !== peekSeq.current) return;
      setParamPeek(faces);
    } catch { /* a value that doesn't build just shows no peek */ }
  }

  /** Persist the current slider-adjusted state as a version. */
  function saveParamsVersion() {
    if (!project || !result || result.source.kind !== "code") return;
    const next = appendVersion(project, {
      engine: result.kind === "replicad" ? "replicad" : "primitive",
      summary: `Adjusted parameters — ${result.dims.x} × ${result.dims.y} × ${result.dims.z} mm`,
      code: result.source.code,
      params: result.source.params,
      // appendVersion spreads the snapshot onto the PROJECT ROOT, so anything omitted
      // here is erased from the live project too: without these three, saving after an
      // adjustment wiped every drilled hole and pocket (and the imported STEP solid,
      // leaving the next open to rebuild empty) — from a button that says it keeps them.
      ops: result.source.ops,
      importFile: importFileRef.current ?? undefined,
      importKind: importFileRef.current ? importKindRef.current : undefined,
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
      // A real version: the repaired bytes are re-serialized so undo/redo restores
      // exactly this state (keeping the OLD blob would restore the broken mesh).
      applyResult(
        { ...result, geometry: out.geometry, dims: out.dims, glb: geometryToSTL(out.geometry), meshXform: undefined },
        project?.name ?? "Model",
        `Repaired the mesh — ${out.holesFilled} hole(s) filled, ${out.boundaryEdgesBefore} → ${out.boundaryEdgesAfter} open edges`,
        "repair mesh",
      );
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: `Repaired the mesh: ${out.holesFilled} hole(s) filled, ${out.degenerateRemoved} bad triangle(s) removed, open edges ${out.boundaryEdgesBefore} → ${out.boundaryEdgesAfter}${out.flippedWinding ? ", surface flipped right-side-out" : ""}. Exports now use the repaired mesh. Undo reverts it.`,
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
      const { simplifyGeometry } = await import("./print/simplify"); // meshoptimizer loads on demand
      const out = await simplifyGeometry(result.geometry);
      applyResult(
        { ...result, geometry: out.geometry, dims: out.dims, glb: geometryToSTL(out.geometry), meshXform: undefined },
        project?.name ?? "Model",
        `Simplified — ${out.trianglesBefore.toLocaleString()} → ${out.trianglesAfter.toLocaleString()} triangles`,
        "simplify mesh",
      );
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: `Simplified the model: ${out.trianglesBefore.toLocaleString()} → ${out.trianglesAfter.toLocaleString()} triangles (shape kept within ~1%). Exports use the simplified mesh — click again to halve it further. Undo reverts it.`,
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Simplify failed: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  // ---- Cutting: bed split, freehand pen cut, and the pins that hold parts together --
  /** Pen-cut tool. `pendingCut` is a drawn-but-unapplied stroke — it stays on screen
   *  while the pin settings are chosen and the view is orbited to check the line. */
  const [cutMode, setCutModeState] = useState(false);
  const [pendingCut, setPendingCut] = useState<{ pts: [number, number, number][]; viewDir: [number, number, number] } | null>(null);
  /** Registration pins, and how big. Persisted: a printer's parts want the same fit
   *  every time, and re-picking 5 mm on every cut is a tax. */
  const [connectorsOn, setConnectorsOn] = useState(() => localStorage.getItem("moldable_connectors") !== "off");
  const [pinSize, setPinSize] = useState(() => Number(localStorage.getItem("moldable_pin_mm")) || 5);
  const setConnectors = (v: boolean) => { setConnectorsOn(v); try { localStorage.setItem("moldable_connectors", v ? "on" : "off"); } catch { /* private mode */ } };
  const setPin = (v: number) => { setPinSize(v); try { localStorage.setItem("moldable_pin_mm", String(v)); } catch { /* private mode */ } };
  const setCutMode = (v: boolean) => {
    setCutModeState(v);
    if (!v) setPendingCut(null);
    if (v) { setPaintModeState(false); setMeasureMode(false); setSelectMode(false); }
  };
  // The socket gap is the part-fit setting, not a constant: a press fit means the pins
  // want tapping in, a loose one means they should drop together.
  const connectorOpts = () => (connectorsOn ? { diameter: pinSize, depth: Math.max(2.5, pinSize * 0.8), clearance: fitClearance(fit), maxPerFace: 3 } : null);

  /** Apply the drawn stroke: slice the model along it, pin the halves together. */
  async function applyPenCut() {
    if (!result || !pendingCut || status === "generating") return;
    setStatus("generating");
    try {
      const { penCut, strokeSites, addConnectors, repack } = await import("./print/cut");
      const out = penCut(result.geometry, pendingCut, { kerf: 0.2 });
      if (!out) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "That line didn't separate the model — draw all the way across it (start and finish outside the part) and try again.", error: true }]);
        return;
      }
      let pieces = out.pieces;
      let merged = out.geometry;
      let dims = out.dims;
      let pinned = 0;
      let pinMm = 0; // what actually fitted — a thin part gets a smaller pin, not none
      const opts = connectorOpts();
      if (opts && pieces.length === 2) {
        const box = new THREE.Box3().setFromBufferAttribute(result.geometry.getAttribute("position") as THREE.BufferAttribute);
        const sites = strokeSites(pendingCut, box, Math.max(6, pinSize * 1.6));
        const con = addConnectors(pieces.map((p) => p.geometry), result.geometry, sites, opts);
        pinned = con.added;
        pinMm = con.diameter;
        if (pinned) {
          const packed = repack(con.pieces);
          pieces = packed.pieces;
          merged = packed.geometry;
          dims = packed.dims;
        }
      }
      applyResult(
        {
          kind: "generative",
          geometry: merged,
          dims,
          source: { kind: "gen", provider: "cut", model: "pen-cut", prompt: `cut into ${pieces.length} parts` },
          supportsStep: false,
          glb: geometryToSTL(merged),
        },
        project?.name ?? "Model",
        `Cut into ${pieces.length} parts${pinned ? ` with ${pinned} pin${pinned === 1 ? "" : "s"}` : ""}`,
        "pen cut",
        { splitPieces: pieces.map((pc) => ({ n: (pc.geometry.index ? pc.geometry.toNonIndexed() : pc.geometry).getAttribute("position").count, color: pc.color, dims: pc.dims })) },
      );
      setSplitPieces(pieces);
      setPendingCut(null);
      setCutModeState(false);
      setMessages((m) => [...m, {
        id: mid(), role: "assistant",
        text: pieces.length === 2 && pinned
          ? `Cut along your line into ${pieces.length} parts, with ${pinned} registration pin${pinned === 1 ? "" : "s"} (${Math.round(pinMm * 10) / 10} mm) — one side has the peg, the other the matching socket with ${fitClearance(fit)} mm print clearance (your ${fit} fit${fitCalibration() != null ? ", measured on your printer" : ""}), so they only go together one way. Export each piece separately from the pieces list, or send them to their own plates.`
          : `Cut along your line into ${pieces.length} parts.${opts && pieces.length > 2 ? " Pins are only fitted when the line makes exactly two pieces — this one made more." : opts ? " There was nowhere thick enough for a pin even at the smallest size, so the faces are plain." : ""}`,
      }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Cut failed: " + String(err?.message ?? err), error: true }]);
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
      const { splitToFitBed } = await import("./print/split"); // CSG splitter loads on demand
      const out = splitToFitBed(result.geometry, bed, 5, connectorOpts());
      if (out.parts <= 1) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "This model already fits the bed — no split needed." }]);
        return;
      }
      // The split output is a plain mesh of parts — treat it as a generative result
      // so export writes exactly these arranged pieces (STEP no longer applies).
      // A REAL version (not NoCommit): "Undo skipped straight past my split" was a
      // real report — one Undo now returns to the un-split model, and Redo re-splits
      // from the stored STL without re-running the CSG.
      applyResult(
        {
          kind: "generative",
          geometry: out.geometry,
          dims: out.dims,
          source: { kind: "gen", provider: "split", model: "split-to-fit-bed", prompt: `split into ${out.parts} parts` },
          supportsStep: false,
          glb: geometryToSTL(out.geometry),
        },
        project?.name ?? "Model",
        `Split into ${out.parts} bed-sized pieces${out.pinned ? ` + ${out.pinned} pins` : ""}`,
        "split to fit bed",
        // The merged mesh concatenates pieces in order, so vertex counts + colours are
        // enough to rebuild the per-piece export list after undo/redo/reopen.
        { splitPieces: out.pieces.map((pc) => ({ n: (pc.geometry.index ? pc.geometry.toNonIndexed() : pc.geometry).getAttribute("position").count, color: pc.color, dims: pc.dims })) },
      );
      setSplitPieces(out.pieces); // enables the colour-coded pieces list + per-piece / ZIP export
      setMessages((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: `Split into ${out.parts} colour-coded pieces — each fits your ${bed.x} × ${bed.y} × ${bed.z} mm build volume.${out.pinned ? ` Every cut carries registration pins (${out.pinned} in total, ${pinSize} mm): a peg on one side, a matching socket with 0.2 mm print clearance on the other, so the parts locate themselves instead of being lined up by eye.` : connectorsOn ? " No face had enough material for a pin, so the joints are plain." : ""} Export them as separate STLs/3MFs (or one file), print and assemble. (This replaces the single model; use Undo or History to go back.)`,
        },
      ]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Split failed: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Send every split piece to its own build plate. The canvas keeps showing them
   *  laid out together — the plates take effect in the EXPORTS (project 3MF opens in
   *  Bambu/Orca with one plate per piece, "One file per plate" writes a 3MF each).
   *  The assignment rides the head version's split metadata, so undo/redo/reopen
   *  keep it. */
  function assignPiecePlates() {
    const pieces = splitPieces;
    if (!pieces?.length) return;
    const n = pieces.length;
    setPlateCount((c) => Math.max(c, n));
    setSplitPieces(pieces.map((pc, i) => ({ ...pc, plate: i + 1 })));
    const pr = projectRef.current;
    if (pr) {
      const i = headIndex(pr);
      const hv = i >= 0 ? pr.versions[i] : null;
      if (hv?.splitPieces?.length === n) {
        const versions = [...pr.versions];
        versions[i] = { ...hv, splitPieces: hv.splitPieces.map((m, k) => ({ ...m, plate: k + 1 })) };
        persist({ ...pr, versions });
      }
    }
    explainOnce(
      "piece-plates",
      `Each of the ${n} pieces now has its own build plate. Exports honour it: **Export → Project 3MF** opens in Bambu Studio / OrcaSlicer with one plate per piece (centred), and **One file per plate** writes a separate 3MF each. The canvas keeps showing the pieces laid out together — the plates take effect in the export.`,
      `Each of the ${n} pieces is on its own plate — export as Project 3MF or one file per plate.`,
    );
  }

  // A cut piece keeps its name and its cut-face colour in the file, so a slicer's part
  // list reads "Part 3" instead of an unnamed mesh. Paint doesn't survive a cut (the
  // triangles are new), which is why the receipts say so rather than staying quiet.
  const pieceBlob = async (g: THREE.BufferGeometry, format: "stl" | "3mf", name: string, color?: string) =>
    format === "stl" ? geometryToSTL(g) : (await import("./print/exportClient")).geometryTo3MF(g, { name, color });
  async function exportPiece(index: number, format: "stl" | "3mf") {
    const piece = splitPieces?.[index];
    if (!piece) return;
    const pf = prepareExport();
    const base = safeFileName(exportBase(), format).replace(/\.[^.]+$/, "");
    downloadBlob(await pieceBlob(piece.geometry, format, `Part ${index + 1}`, piece.color), `${base}-part${index + 1}.${format}`);
    if (!pf) return;
    const caveat = paintCaveat(format);
    const label = `Exported part ${index + 1} on its own.`;
    explainOnce("export-piece", `${label} ${preflightSummary(pf)}${caveat ? " " + caveat : ""}`, exportBrief(label, pf, caveat));
  }
  async function exportAllPieces(format: "stl" | "3mf") {
    if (!splitPieces?.length) return;
    const pf = prepareExport();
    const base = safeFileName(exportBase(), format).replace(/\.[^.]+$/, "");
    try {
      const files: Record<string, Blob> = {};
      for (const [i, p] of splitPieces.entries()) files[`${base}-part${i + 1}.${format}`] = await pieceBlob(p.geometry, format, `Part ${i + 1}`, p.color);
      const zip = await (await import("./print/exportClient")).zipModelFiles(files);
      downloadBlob(zip, `${base}-parts-${format}.zip`);
      if (!pf) return;
      const caveat = paintCaveat(format);
      const label = `Exported all ${splitPieces.length} pieces as separate ${format.toUpperCase()} files in one zip.`;
      explainOnce("export-pieces", `${label} ${preflightSummary(pf)}${caveat ? " " + caveat : ""}`, exportBrief(label, pf, caveat));
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Export failed: " + String(err?.message ?? err), error: true }]);
    }
  }

  /** Export a 3MF and get it into a slicer — see lib/slicer.ts for the three routes. */
  async function openSlicer(target: SlicerTarget) {
    if (!result) return;
    const engine = result.kind === "generative" ? await getGenEngine() : sel?.engine;
    if (!engine) return;
    try {
      const pf = prepareExport();
      if (!pf) return;
      // The same file the Export menu writes — the slicer gets the named objects and
      // the paint, not a bare mesh.
      const blob = (await build3MF(pf.result.geometry))?.blob ?? (await engine.export(pf.result, "3mf"));
      const hand = await openInSlicer(target, blob, safeFileName(exportBase(), "3mf"));
      const app = target === "bambu" ? "Bambu Studio" : "OrcaSlicer";
      const said =
        hand.how === "desktop"
          ? hand.opened
            ? `Opened in whichever slicer owns .3mf on this machine. The file is saved at \`${hand.path}\`, and it keeps that name — so after your next edit, hit **Open in slicer** again and then **right-click the object → Reload from disk** in the slicer. Your supports, plate layout and print profile survive; only the shape updates.`
            : `Saved the 3MF at \`${hand.path}\` and opened the folder — nothing on this machine is currently set to open .3mf files. Install a slicer (or open the file with one once, and the OS will remember).`
          : hand.how === "deeplink"
            ? `Sent to ${app}.${target === "bambu" ? " Bambu may ask “not from a trusted site — open anyway?” — that's expected for a file that didn't come from MakerWorld; click yes." : ""} If nothing opened, ${app} may not be installed — the download button works too.`
            : "Downloaded the 3MF — double-click it and it opens in your default slicer. The desktop app opens it directly, and remembers the file so you can reload it there after an edit.";
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: said + " " + preflightSummary(pf) }]);
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

  async function showFromGlb(glb: Blob, source: Extract<BuildInput, { kind: "gen" }>, meshXform?: number[]): Promise<THREE.BufferGeometry> {
    const { geometry: g, dims: d, texture } = await loadAnyMesh(glb);
    // Replay any baked transform (resize / rotate / fit-to-plate) recorded over this glb.
    const dd = applyStoredMeshXform(g, meshXform) ?? d;
    applyResultNoCommit({ kind: "generative", geometry: g, dims: dd, source, supportsStep: false, glb, texture, meshXform });
    return g;
  }

  /** Rebuild the split-pieces export list from a restored merged mesh: the merge
   *  concatenated the pieces in order, so slicing by stored vertex counts recovers
   *  each printable island exactly — no CSG re-run. */
  function reviveSplitPieces(g: THREE.BufferGeometry, meta: NonNullable<Version["splitPieces"]>): (SplitPiece & { plate?: number })[] | null {
    const pos = g.index ? g.toNonIndexed().getAttribute("position") : g.getAttribute("position");
    const total = meta.reduce((a, m) => a + m.n, 0);
    if (!pos || pos.count !== total) return null; // bytes don't match the metadata — don't fake a list
    const arr = pos.array as Float32Array;
    let off = 0;
    const out: (SplitPiece & { plate?: number })[] = [];
    for (const m of meta) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(arr.slice(off * 3, (off + m.n) * 3), 3));
      pg.computeVertexNormals();
      out.push({ geometry: pg, color: m.color, dims: m.dims, plate: m.plate });
      off += m.n;
    }
    return out;
  }

  /** Turn the dropped SVG into a solid — extrude, revolve, or emboss. Persisted
   *  as an STL blob (Z-up mm), so it re-opens through the same path. */
  async function createFromSvg(mode: SvgMode, prm: SvgParams) {
    if (!svgDraft) return;
    try {
      const { extrudeSvg, revolveSvg, embossSvg } = await import("./svg/extrude"); // SVG→solid graph loads on demand
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
    const isStep = /\.(step|stp)$/i.test(f.name);
    if (isStep || /\.stl$/i.test(f.name)) {
      // The kernel warm-up is deferred to post-paint idle — boot it here rather than
      // bouncing a STEP import ("try again") or quietly routing an STL to the mesh path.
      const s = sel ?? (await ensureEngine());
      const asCad = isStep ? ("step" as const) : s.kind === "replicad" && s.engine.setImport ? ("stl" as const) : null;
      if (asCad === "step" && (s.kind !== "replicad" || !s.engine.setImport)) {
        setMessages((m) => [...m, { id: mid(), role: "assistant", text: "STEP import needs the OpenCascade engine, which failed to boot on this device (the app fell back to the primitive engine).", error: true }]);
        return;
      }
      if (asCad) {
        setStatus("generating");
        try {
          await s.engine.setImport!(f, asCad);
          importFileRef.current = f;
          importKindRef.current = asCad;
          const res = await s.engine.build({ kind: "code", code: IMPORT_PASSTHROUGH, params: {} });
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
          if (asCad === "stl") {
            maybeOfferInches(res.dims); // STEP carries real units; STL just carries numbers
            // Downloaded STLs arrive lying however they were modelled — same offer as
            // the mesh path, and only once units are settled (see above).
            if (Math.max(res.dims.x, res.dims.y, res.dims.z) > 13) maybeOfferOrientation(res.geometry);
          }
          setStatus("idle");
          return;
        } catch (err: any) {
          setStatus("idle");
          if (asCad !== "stl") {
            setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't read that STEP file: " + String(err?.message ?? err), error: true }]);
            return;
          }
          // STL that OCCT couldn't solidify → import it as a plain mesh instead (below).
          try { await s.engine.setImport!(null); } catch { /* worker may have respawned */ }
          importFileRef.current = null;
          setMessages((m) => [...m, { id: mid(), role: "assistant", text: "That STL couldn't be converted to an editable solid — importing it as a plain mesh instead (measure, repair, resize, export still work)." }]);
        }
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
      maybeOfferInches(d);
      // Only when the size is trusted: an inch-suspect model gets units settled first —
      // orientation advice on a part that's about to grow 25× would describe the wrong part.
      if (Math.max(d.x, d.y, d.z) > 13) maybeOfferOrientation(g);
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
      explainOnce("hole", `Drilled a **${what}** — free, no AI. Undo reverts it; it also rides along when sliders rebuild the model.`);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't drill there: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  // ---- Magnet tool: catalogue-size pocket placement with hover ghost -------------
  // Pick a disc size (6×2, 8×3, 10×2…), hover the model for a live pocket preview,
  // click to sink it. "Pair through the wall" also pockets the OPPOSITE face on the
  // same axis, so helmet-panel magnet pairs land coaxial. Placement runs the same
  // free CAD "hole" op the drill tool uses — no AI call.
  type MagnetTool = { size: MagnetSize; fit: MagnetFit; pair: boolean; snap: number; placed: { at: [number, number, number]; normal: [number, number, number] }[] };
  const [magnetTool, setMagnetTool] = useState<MagnetTool | null>(null);
  const magnetToolRef = useRef(magnetTool);
  magnetToolRef.current = magnetTool;
  function toggleMagnetTool() {
    setHoleEdit(null); // tool change drops any hole-edit selection
    if (magnetToolRef.current) { setMagnetTool(null); return; }
    dismissOverlays(); // one tool at a time — put down select/measure/paint/hole first
    // Glue by default: a press-fit that works loose drops a magnet inside a finished
    // part, and nobody re-prints a helmet for that. 8×3 is the cosplay-panel staple.
    setMagnetTool({ size: MAGNET_SIZES[5], fit: "glue", pair: false, snap: 1, placed: [] });
  }
  // ---- Non-destructive hole editing -------------------------------------------
  // Magnet pockets and screw holes are OPS in the parametric chain, never baked —
  // so clicking one (with its tool armed) selects it for editing: resize in place,
  // Move (next click re-places it), Remove, or Remove all. Every change rebuilds
  // from the modified chain and lands as a version, so Undo walks back through it.
  const [holeEdit, setHoleEdit] = useState<{ family: "magnet" | "screw"; index: number; moving: boolean } | null>(null);
  const holeEditRef = useRef<typeof holeEdit>(null);
  holeEditRef.current = holeEdit;
  const isFamilyOp = (o: CadOp, family: "magnet" | "screw") =>
    family === "magnet" ? o.type === "hole" && (o as { tag?: string }).tag === "magnet" : o.type === "screw";

  /** Index (into source.ops) of the same-family drilled op under a canvas click:
   *  laterally inside its bore, and between its entry plane and floor along the axis. */
  function holeOpAt(at: [number, number, number], family: "magnet" | "screw"): number {
    const cur = resultRef.current;
    if (!cur || cur.source.kind !== "code") return -1;
    const rc = cur.recenter ?? [0, 0, 0];
    const ops = cur.source.ops ?? [];
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i] as CadOp & { at: [number, number, number]; normal: [number, number, number] };
      if (!isFamilyOp(o, family)) continue;
      const dx = at[0] - (o.at[0] - rc[0]), dy = at[1] - (o.at[1] - rc[1]), dz = at[2] - (o.at[2] - rc[2]);
      const along = dx * o.normal[0] + dy * o.normal[1] + dz * o.normal[2];
      const lat = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      const r = (o.type === "hole" ? o.diameter : o.type === "screw" ? Math.max(o.countersink, o.major) : 0) / 2;
      const depth = (o as { depth?: number }).depth || 12;
      if (lat <= r + 0.4 && along <= 1.5 && along >= -(depth + 1.5)) return i;
    }
    return -1;
  }

  /** Rebuild the CAD solid from a modified op chain (the editing workhorse). */
  async function rebuildWithOps(nextOps: CadOp[], summary: string, prompt: string) {
    const cur = resultRef.current;
    if (!cur || cur.source.kind !== "code" || !sel) return;
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: cur.source.code, params: cur.source.params, ops: nextOps });
      applyResult(res, project?.name ?? "Model", summary, prompt);
      appendMsg({ role: "assistant", text: `${summary}. Undo reverts it.` });
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't rebuild after the hole edit: ${String(err?.message ?? err)}`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Re-place the selected hole at a newly clicked spot (Move mode). */
  async function moveHoleTo(spot: { at: [number, number, number]; normal: [number, number, number] }) {
    const he = holeEditRef.current;
    const cur = resultRef.current;
    if (!he || !cur || cur.source.kind !== "code") return;
    const rc = cur.recenter ?? [0, 0, 0];
    const ops = [...(cur.source.ops ?? [])];
    const o = { ...(ops[he.index] as CadOp & { at: [number, number, number]; normal: [number, number, number] }) };
    o.at = [spot.at[0] + rc[0], spot.at[1] + rc[1], spot.at[2] + rc[2]];
    o.normal = spot.normal;
    ops[he.index] = o;
    setHoleEdit({ ...he, moving: false });
    await rebuildWithOps(ops, he.family === "magnet" ? "Moved the magnet pocket" : "Moved the screw hole", "move hole");
  }

  /** Resize the selected magnet pocket to the tool's (possibly just-changed) preset. */
  async function editMagnetApply(next: { size?: MagnetSize; fit?: MagnetFit }) {
    const t = magnetToolRef.current;
    const he = holeEditRef.current;
    const cur = resultRef.current;
    if (!t || !he || he.family !== "magnet" || !cur || cur.source.kind !== "code") return;
    const size = next.size ?? t.size;
    const fit = next.fit ?? t.fit;
    const { diameter, depth } = magnetPocket(size, fit);
    const ops = [...(cur.source.ops ?? [])];
    ops[he.index] = { ...(ops[he.index] as HoleOp), diameter, depth };
    await rebuildWithOps(ops, `Resized the magnet pocket — ${size.d}×${size.h} mm, ${fit === "press" ? "push fit" : "glued"} (⌀${diameter} × ${depth} mm — seats flush)${boreNote()}`, "resize magnet");
  }

  /** Resize/refit the selected screw hole to the tool's (possibly just-changed) preset. */
  async function editScrewApply(next: { size?: ScrewSize; fit?: ScrewFit; countersink?: boolean }) {
    const t = screwToolRef.current;
    const he = holeEditRef.current;
    const cur = resultRef.current;
    if (!t || !he || he.family !== "screw" || !cur || cur.source.kind !== "code") return;
    const size = next.size ?? t.size;
    const fit = next.fit ?? t.fit;
    const cs = next.countersink ?? t.countersink;
    const cut = screwCut(size, fit, cs);
    const ops = [...(cur.source.ops ?? [])];
    ops[he.index] = { ...(ops[he.index] as ScrewOp), minor: cut.minor, major: cut.major, pitch: cut.pitch, depth: cut.depth, countersink: cut.countersink };
    await rebuildWithOps(ops, `Changed the screw hole — now a ${cut.what}`, "resize screw");
  }

  /** Delete the selected hole from the chain. */
  async function deleteEditedHole() {
    const he = holeEditRef.current;
    const cur = resultRef.current;
    if (!he || !cur || cur.source.kind !== "code") return;
    const ops = [...(cur.source.ops ?? [])];
    ops.splice(he.index, 1);
    setHoleEdit(null);
    await rebuildWithOps(ops, he.family === "magnet" ? "Removed the magnet pocket" : "Removed the screw hole", "remove hole");
  }

  /** Erase every hole this tool ever drilled. */
  async function removeAllHoles(family: "magnet" | "screw") {
    const cur = resultRef.current;
    if (!cur || cur.source.kind !== "code") return;
    const ops = cur.source.ops ?? [];
    const keep = ops.filter((o) => !isFamilyOp(o, family));
    const n = ops.length - keep.length;
    if (!n) return;
    setHoleEdit(null);
    await rebuildWithOps(keep, `Removed all ${n} ${family === "magnet" ? "magnet pocket" : "screw hole"}${n > 1 ? "s" : ""}`, `remove all ${family}`);
  }

  /** How many ops of a family the current model carries (drives "Remove all (N)"). */
  const familyOpCount = (family: "magnet" | "screw") =>
    result?.source.kind === "code" ? (result.source.ops ?? []).filter((o) => isFamilyOp(o, family)).length : 0;

  async function placeMagnet(spot: { at: [number, number, number]; normal: [number, number, number]; back: { at: [number, number, number]; normal: [number, number, number]; thickness: number } | null }) {
    const t = magnetToolRef.current;
    if (!t) return;
    // Read the LIVE result, not the render's: this fires from a canvas listener, so the
    // closure's `result` can predate the pocket placed a moment ago — and building from
    // that op chain drops it.
    const cur = resultRef.current;
    if (!cur || cur.source.kind !== "code" || !sel || activeKind !== "replicad") {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Magnet pockets work on Precise (CAD) models — mesh models can't be drilled. Rebuild the part in Precise mode first.", error: true }]);
      setMagnetTool(null);
      return;
    }
    // Move mode: this click is the pocket's new home. A click ON an existing pocket
    // (outside move mode) selects it for editing instead of drilling a second bore
    // through it.
    if (holeEditRef.current?.family === "magnet" && holeEditRef.current.moving) { await moveHoleTo(spot); return; }
    const hitIx = holeOpAt(spot.at, "magnet");
    if (hitIx >= 0) {
      setHoleEdit({ family: "magnet", index: hitIx, moving: false });
      explainOnce("hole-edit", "That's an existing pocket, so you're now **editing** it: pick a different size/fit to resize it in place, **Move** to re-place it with your next click, or **Remove**. Click bare surface to drill a new one. Everything is undoable.", "Editing that pocket — resize, Move or Remove in the panel.");
      return;
    }
    setHoleEdit(null); // drilling fresh — drop any lingering selection
    const { diameter, depth } = magnetPocket(t.size, t.fit);
    const src = cur.source;
    const rc = cur.recenter ?? [0, 0, 0];
    const mkOp = (at: [number, number, number], normal: [number, number, number]) => ({
      type: "hole" as const,
      tag: "magnet",
      at: [at[0] + rc[0], at[1] + rc[1], at[2] + rc[2]] as [number, number, number],
      normal,
      diameter,
      depth,
    });
    const ops = [mkOp(spot.at, spot.normal)];
    // The paired pocket needs wall to live in: both pockets plus a 0.8 mm web between.
    let pairNote = "";
    if (t.pair) {
      if (spot.back && spot.back.thickness >= depth * 2 + 0.8) {
        ops.push(mkOp(spot.back.at, spot.back.normal));
        pairNote = ` — and a matching one on the back of the same ${Math.round(spot.back.thickness * 10) / 10} mm wall, exactly in line`;
      } else {
        pairNote = spot.back
          ? ` — no back pocket: that wall is only ${Math.round(spot.back.thickness * 10) / 10} mm thick, too thin to hold two ${depth} mm pockets`
          : " — no back pocket: nothing directly behind this spot";
      }
    }
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), ...ops] });
      const what = `${t.size.d}×${t.size.h} mm magnet pocket (${t.fit === "press" ? "press-fit" : "glued"}, ⌀${diameter} × ${depth} mm — seats flush)${boreNote()}${pairNote}`;
      applyResult(res, project?.name ?? "Model", `Added a ${what}`, `magnet ${t.size.d}×${t.size.h}`);
      // One receipt for the whole run, counting up as you place: a far-side pocket is
      // invisible from this angle and a skipped pair (thin wall) would fail silently, so
      // the line has to exist — but it must not repeat itself nine times either. A note
      // that DIFFERS (a declined pair) breaks the run and gets its own line, because
      // that one is news.
      const fitWord = t.fit === "press" ? "press-fit" : "glued in";
      postReceipt(`magnet:${t.size.d}x${t.size.h}:${t.fit}:${pairNote}`, (n) =>
        n === 1
          ? `Added a ${what}.`
          : `Added ${n} ${t.size.d}×${t.size.h} mm magnet pockets (${fitWord}, holes ⌀${diameter} × ${depth} mm deep)${pairNote}.`);
      setMagnetTool((d) => (d ? { ...d, placed: [...d.placed, { at: spot.at, normal: spot.normal }, ...(ops.length > 1 && spot.back ? [{ at: spot.back.at, normal: spot.back.normal }] : [])] } : d));
      explainOnce("magnet", `Sunk a **magnet pocket** — free, no AI. The hole is cut a hair wider than the magnet so a drop of super glue holds it in flush, and it grips right through the plastic. Place another near this one and it snaps square with it — the dashed line shows what it lined up with. Want it exactly under the cursor instead? Set snapping to **Free** in the panel. Undo reverts it.`);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't sink a magnet pocket there: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  // ---- Logo layer: SVG or PNG → its own movable solid on the model ----------------
  // A vector goes straight to the extruder; a bitmap goes through the tracer first,
  // which judges the art BEFORE anything is built — a photo becomes a refusal with
  // reasons, not an unprintable blob. The result is an ATTACHMENT: drag it across any
  // face with the gizmo, size it with the corner dots, then commit it from the Objects
  // panel — Merge raises it (emboss), Engrave carves it in.
  async function addLogoFile(file: File) {
    const name = file.name.replace(/\.(svg|png|jpe?g|webp)$/i, "") || "logo";
    setStatus("generating");
    try {
      let svgText: string;
      let traceNotes: string[] = [];
      if (/\.svg$/i.test(file.name) || file.type === "image/svg+xml") {
        svgText = await file.text();
      } else {
        const { traceBitmap, outlinesToSvg, bitmapToImageData } = await import("./svg/trace");
        const report = traceBitmap(await bitmapToImageData(file));
        if (report.quality === "unusable") {
          setMessages((m) => [...m, { id: mid(), role: "assistant", error: true, text:
            `**${file.name}** can't become a clean logo:\n${report.notes.map((x) => `- ${x}`).join("\n")}\n\nFor a crisp result: solid dark shapes on a light background (or a transparent PNG), hard edges rather than soft gradients, and ~600 px or more on the short side. An SVG traced from the original art is best of all.` }]);
          return;
        }
        traceNotes = report.notes;
        svgText = outlinesToSvg(report);
      }
      const { extrudeSvg } = await import("./svg/extrude");
      const { geometry: g, dims: d } = extrudeSvg(svgText, { sizeMm: 25, heightMm: 1.2 });
      addAttachment(g, name);
      const caveats = traceNotes.length ? `\n\n_${traceNotes.join(" ")}_` : "";
      setMessages((m) => [...m, { id: mid(), role: "assistant", text:
        `Added **${name}** (${d.x} × ${d.y} × ${d.z} mm) as its own layer. Drag it onto any face with the arrows/rings, corner dots resize it. Then in **Objects**: **Merge** raises it off the surface (embossed), **Engrave** carves it in. Both turn the model into a mesh — do CAD edits first.${caveats}` }]);
      explainOnce("logo", `Logos work best as **SVG** (exact curves). PNG/JPG get **traced**: the app finds the ink's outline, so solid, hard-edged, dark-on-light art comes out clean — photos, gradients and fine hairlines don't survive, and the app will say so rather than build a blob.`);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't turn ${file.name} into a logo: ${String(err?.message ?? err)}`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Engrave: subtract the placed attachment(s) from the model — mergeAttachments'
   *  mirror image (boolean −1 instead of +1), for carved-in logos and reliefs. */
  async function engraveAttachments(ids: string[]) {
    const targets = attachments.filter((a) => ids.includes(a.id));
    if (!targets.length || !geometry || !result) return;
    setStatus("generating");
    try {
      let baseGeom = geometry;
      let g: THREE.BufferGeometry | null = null;
      for (const t of targets) {
        const baked = viewer.current?.bakeAttachment(t.id);
        if (!baked) throw new Error(`couldn't read ${t.name}'s placement`);
        if (!(await previewSetBase(baseGeom))) throw new Error("this model's mesh couldn't be welded for a boolean");
        const pos = await previewBoolean(baked, -1);
        if (!pos) throw new Error(`carving ${t.name} out of the model failed — move it so it overlaps the surface`);
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
        source: { kind: "gen", provider: "engrave", model: names },
        supportsStep: false,
        glb: geometryToSTL(g!),
      };
      applyResult(res, project?.name ?? "Model", `Engraved ${names} into the model`, `engrave ${names}`);
      const gone = new Set(targets.map((t) => t.id));
      setAttachments((a) => a.filter((x) => !gone.has(x.id)));
      setSelAttachIds([]);
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Engraved **${names}** into the surface — the shape is carved in wherever it overlapped. Undo brings the layer back to adjust.` }]);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't engrave: ${String(err?.message ?? err)}`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  // ---- Screw tool: hover-place screw holes, same machinery as magnets -------------
  // Three fits (see lib/screws.ts): a clearance hole the screw slides through (with an
  // optional countersink), a ribbed hole the screw bites into — the thread pattern the
  // headphone hook's report asked for — and a heat-set insert pocket. All one free
  // ScrewOp in the kernel; the ribs are the concentric profile the worker revolves.
  type ScrewTool = { size: ScrewSize; fit: ScrewFit; countersink: boolean; snap: number; placed: { at: [number, number, number]; normal: [number, number, number] }[] };
  const [screwTool, setScrewTool] = useState<ScrewTool | null>(null);
  const screwToolRef = useRef(screwTool);
  screwToolRef.current = screwTool;
  function toggleScrewTool() {
    setHoleEdit(null); // tool change drops any hole-edit selection
    if (screwToolRef.current) { setScrewTool(null); return; }
    dismissOverlays();
    setScrewTool({ size: SCREW_SIZES[2], fit: "bite", countersink: true, snap: 1, placed: [] }); // M3 — the maker staple
  }
  async function placeScrew(spot: { at: [number, number, number]; normal: [number, number, number]; back: { at: [number, number, number]; normal: [number, number, number]; thickness: number } | null }) {
    const t = screwToolRef.current;
    if (!t) return;
    const cur = resultRef.current;
    if (!cur || cur.source.kind !== "code" || !sel || activeKind !== "replicad") {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Screw holes work on Precise (CAD) models — mesh models can't be drilled. Rebuild the part in Precise mode first.", error: true }]);
      setScrewTool(null);
      return;
    }
    if (holeEditRef.current?.family === "screw" && holeEditRef.current.moving) { await moveHoleTo(spot); return; }
    const scrHit = holeOpAt(spot.at, "screw");
    if (scrHit >= 0) {
      setHoleEdit({ family: "screw", index: scrHit, moving: false });
      explainOnce("hole-edit", "That's an existing hole, so you're now **editing** it: pick a different size/fit to change it in place, **Move** to re-place it with your next click, or **Remove**. Click bare surface to cut a new one. Everything is undoable.", "Editing that screw hole — resize, Move or Remove in the panel.");
      return;
    }
    setHoleEdit(null);
    const cut = screwCut(t.size, t.fit, t.countersink);
    const src = cur.source;
    const rc = cur.recenter ?? [0, 0, 0];
    const op = {
      type: "screw" as const,
      at: [spot.at[0] + rc[0], spot.at[1] + rc[1], spot.at[2] + rc[2]] as [number, number, number],
      normal: spot.normal,
      minor: cut.minor,
      major: cut.major,
      pitch: cut.pitch,
      depth: cut.depth,
      countersink: cut.countersink,
    };
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: src.code, params: src.params, ops: [...(src.ops ?? []), op] });
      applyResult(res, project?.name ?? "Model", `Added a ${cut.what}`, `screw ${t.size.label}`);
      postReceipt(`screw:${t.size.id}:${t.fit}:${t.countersink}`, (n) =>
        n === 1 ? `Added a ${cut.what}.` : `Added ${n} ${cut.what.replace("hole", "holes").replace("pocket", "pockets")}.`);
      setScrewTool((d) => (d ? { ...d, placed: [...d.placed, { at: spot.at, normal: spot.normal }] } : d));
      explainOnce("screw", `Cut a **screw hole** — free, no AI. "Bites in" bores the plastic tap size and ribs the wall at the thread pitch, so the screw cuts its own path and holds like a tapped hole; "Slides through" is a clearance bore (flush-head cone optional); "Heat-set insert" pockets the brass insert size. Placing another near this one snaps into line. Undo reverts it.`);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't cut a screw hole there: " + String(err?.message ?? err), error: true }]);
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
        const pick = pickAutoModel(await ensureOrCatalog(), { prompt: request, isEdit: true });
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
      const { extrudeSvg } = await import("./svg/extrude"); // SVG→solid graph loads on demand
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
      explainOnce("merge", `Merged **${names}** into the model — one printable solid now (mesh: STL/3MF; STEP needs the pre-merge version in History). Undo brings the pieces back.`);
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Couldn't merge: ${String(err?.message ?? err)}`, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Physical surface texture: subdivide + displace the current model's mesh (any kind).
   *  CAD models become meshes here — precision-edit first, texture last (History keeps both). */
  async function applySurfaceTexture(pattern: SurfacePattern, scale: number, depth: number) {
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
   *  exactly like applyDirectOp does for picked points. No AI, no tokens.
   *  MESH models can't take parametric ops — their transform is BAKED into the geometry
   *  instead (and recorded as meshXform so it survives reopen). Before this branch existed,
   *  a gizmo scale/rotate/move on a generated mesh silently reverted — real user report. */
  async function authorObjectOp(commit: TransformCommit) {
    if (!result || status === "generating") return;
    if (!(result.source.kind === "code" && sel && activeKind === "replicad")) {
      if (result.kind !== "generative" || !result.geometry) return; // primitive spec models: no transform ops
      const c = commit.kind === "translate" ? null : new THREE.Vector3(...commit.center);
      const m =
        commit.kind === "translate"
          ? new THREE.Matrix4().makeTranslation(...commit.delta)
          : commit.kind === "rotate"
            ? new THREE.Matrix4()
                .makeTranslation(c!.x, c!.y, c!.z)
                .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...commit.axis).normalize(), THREE.MathUtils.degToRad(commit.angleDeg)))
                .multiply(new THREE.Matrix4().makeTranslation(-c!.x, -c!.y, -c!.z))
            : new THREE.Matrix4()
                .makeTranslation(c!.x, c!.y, c!.z)
                .multiply(new THREE.Matrix4().makeScale(commit.factor, commit.factor, commit.factor))
                .multiply(new THREE.Matrix4().makeTranslation(-c!.x, -c!.y, -c!.z));
      const baked = bakeMeshTransform(result.geometry, m);
      const label =
        commit.kind === "translate"
          ? "Moved the part"
          : commit.kind === "rotate"
            ? `Rotated ${Math.round(commit.angleDeg)}°`
            : `Scaled to ${Math.round(commit.factor * 100)}%`;
      applyResult(
        { ...result, geometry: baked.geometry, dims: baked.dims, meshXform: composeXform(result.meshXform, baked.applied) },
        project?.name ?? deriveName("Edited part"),
        `${label} — ${baked.dims.x} × ${baked.dims.y} × ${baked.dims.z} mm`,
        `transform ${commit.kind}`,
      );
      return;
    }
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

  /** Typed resize (Resize panel / Fit to plate). Mesh models bake the scale into the
   *  geometry (per-axis allowed, texture kept, recorded as meshXform); CAD models
   *  author a parametric UNIFORM scale op — same path as the gizmo. */
  async function resizeModel(scale: [number, number, number]) {
    if (!result || !geometry || status === "generating") return;
    const s = scale.map((v) => (Number.isFinite(v) && v > 0.001 ? v : 1)) as [number, number, number];
    if (s.every((v) => Math.abs(v - 1) < 1e-3)) return;
    if (result.source.kind === "code" && activeKind === "replicad") {
      geometry.computeBoundingBox();
      const c = geometry.boundingBox!.getCenter(new THREE.Vector3());
      await authorObjectOp({ kind: "scale", factor: Math.round(s[0] * 1000) / 1000, center: [c.x, c.y, c.z] });
    } else if (result.kind === "generative") {
      const baked = bakeMeshTransform(result.geometry, scaleAboutBase(result.geometry, s));
      applyResult(
        { ...result, geometry: baked.geometry, dims: baked.dims, meshXform: composeXform(result.meshXform, baked.applied) },
        project?.name ?? "Model",
        `Resized — ${baked.dims.x} × ${baked.dims.y} × ${baked.dims.z} mm`,
        "resize",
      );
    }
  }

  /** One tap: shrink an oversize model until it fits the printer's plate. */
  async function fitModelToPlate() {
    if (!result) return;
    const f = fitToBedFactor(result.dims, printer.bed);
    if (f >= 1) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Already fits — ${result.dims.x} × ${result.dims.y} × ${result.dims.z} mm in a ${printer.bed.x} × ${printer.bed.y} × ${printer.bed.z} mm build volume.` }]);
      return;
    }
    await resizeModel([f, f, f]);
    explainOnce(
      "fitplate",
      `Scaled the model to ${Math.round(f * 100)}% so it fits your ${printer.bed.x} × ${printer.bed.y} × ${printer.bed.z} mm build volume. Undo reverts it; the Resize panel (Transform → Resize) sets any exact size.`,
      `Fit to plate: scaled to ${Math.round(f * 100)}%.`,
    );
  }

  /** Measure tool: first click sets an anchor, second click records a point-to-point
   *  measurement (a labelled distance line in the viewer). No AI, no model change. */
  // A measurement is a DRAFT until saved: the confirm pill offers Save/Discard, and while
  // drafting, another tap moves the NEAREST end to the newly tapped (snapped) point — so
  // anchor editing needs no drag plumbing, just "tap where it should be". Leaving the
  // tool commits the draft (never silently destroys work); Discard is the explicit out.
  const [draftMeasure, setDraftMeasure] = useState<Measurement | null>(null);
  const draftMeasureRef = useRef(draftMeasure);
  draftMeasureRef.current = draftMeasure;
  function onMeasurePoint(p: [number, number, number]) {
    if (draftMeasureRef.current) {
      const dm = draftMeasureRef.current;
      const d = (q: [number, number, number]) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      setDraftMeasure(d(dm.a) <= d(dm.b) ? { ...dm, a: p } : { ...dm, b: p });
      return;
    }
    if (!measurePending) { setMeasurePending(p); return; }
    setDraftMeasure({ id: mid(), a: measurePending, b: p });
    setMeasurePending(null);
  }
  /** Drag-a-line measure: both ends arrive at once (viewer-side tape drag). Drawing
   *  while a draft is up REPLACES it — dragging again is the natural "redo". */
  function onMeasureSegment(a: [number, number, number], b: [number, number, number]) {
    setDraftMeasure({ id: mid(), a, b });
    setMeasurePending(null); // a stray earlier single click shouldn't chain into the next one
  }
  function saveDraftMeasure() {
    const dm = draftMeasureRef.current;
    if (dm) setMeasurements((m) => [...m, dm]);
    setDraftMeasure(null);
  }
  /** Tap a measurement's LABEL (in measure mode) to delete it — a draft discards. */
  function onMeasureDelete(id: string) {
    if (draftMeasureRef.current?.id === id) { setDraftMeasure(null); return; }
    setMeasurements((m) => m.filter((x) => x.id !== id));
  }
  useEffect(() => {
    // Leaving the tool commits the draft: the old behaviour was instant-commit, so
    // exit keeping the measurement is what nobody will be surprised by.
    if (!measureMode && draftMeasureRef.current) saveDraftMeasure();
  }, [measureMode]);

  // ---------------- generate ----------------
  /** Enter the guided "fix a broken part" flow: precise mode, a photo-first nudge,
   *  and a helper message with the coin/card-for-scale trick. */
  function startGuided() {
    setGuided(true);
    setMode("precise");
    setInput("");
    appendMsg({
      role: "assistant",
      text: "Let's recreate a part that fits. Upload a photo of the broken or original piece (the paperclip below), and tell me any measurements you know. No calipers? Put a coin or a credit card in the shot for scale and I'll work the sizes out. Then pick a Fit — snug is a good default.",
    });
  }

  /** Change the FDM fit. If the current model already exposes a `clearance`
   *  parameter, re-fit live with no AI call; otherwise it applies to the next build. */
  function applyFit(next: FitId) {
    setFit(next);
    if (!result || result.source.kind !== "code") return;
    const key = Object.keys(cadDefaults ?? {}).find((k) => k.toLowerCase() === "clearance");
    if (key) void applyParams({ ...paramValues, [key]: fitClearance(next) });
  }

  // One request at a time, enforced SYNCHRONOUSLY. The `status === "generating"`
  // check inside sendInner reads React state, which doesn't update until a render —
  // and sendInner awaits (intent routing, engine boot) before it ever calls
  // setStatus. So two taps in the same tick both saw "idle" and both ran: two
  // "Thinking…" bubbles side by side, two API calls, and the loser of the race
  // surfacing as a network error. A ref flips the instant the first call enters.
  const sendingRef = useRef(false);
  async function send(promptText: string, forceMode?: Mode, override?: { llm?: LlmSettings; genEng?: { provider: string; model: string }; skipClarify?: boolean; skipPlan?: boolean; routeAuto?: boolean }) {
    if (sendingRef.current) return;
    // Typing while an AI proposal is on canvas BUILDS ON the proposal instead of
    // silently throwing it away: the previewed change is kept as its own version
    // (Undo/History step back through it) and the ask re-runs next render, when the
    // send path's closures see the promoted model as the base.
    if (pendingRef.current) {
      applyPending();
      explainOnce(
        "refine-preview",
        "You typed while a preview was on the canvas, so I kept that change as the base for this request — it's saved as a version and **Undo** steps back to before it. To throw a proposal away instead, hit **Discard** on the preview bar before typing.",
      );
      setInput("");
      setQueuedAsk({ promptText, forceMode, override });
      return;
    }
    sendingRef.current = true;
    setImproveBefore(null); // the composer is being emptied; there is nothing left to revert
    setImproveNote(null);
    try {
      await sendInner(promptText, forceMode, override);
    } finally {
      sendingRef.current = false;
      setGenProgress(null); // the canvas goes back to showing the model, not the build
    }
  }

  /** The plan card's two exits. "Build it" re-sends with the (possibly edited) plan
   *  folded into the brief; "Build without a plan" runs the original words. Either way
   *  the card freezes in the transcript as the record of what was agreed. */
  function planChoose(msgId: string, choice: "build" | "skip", edited?: BuildPlan) {
    const msg = messagesRef.current.find((m) => m.id === msgId);
    const st = msg?.plan;
    if (!st || st.done) return;
    setMessages((m) => m.map((x) => (x.id === msgId
      ? { ...x, plan: { ...st, plan: edited ?? st.plan, done: true, chose: choice } }
      : x)));
    const brief = choice === "build" ? planToPrompt(st.prompt, edited ?? st.plan) : st.prompt;
    // The plan already asked every question worth asking, so clarify would just be a
    // second card in front of the same build.
    void send(brief, undefined, { skipPlan: true, skipClarify: choice === "build" });
  }

  // One tap approves paid mesh runs for the REST of the session — the gate informs,
  // it doesn't nag.
  const meshSpendOk = useRef(false);
  function confirmChoose(msgId: string, yes: boolean) {
    const c = messages.find((x) => x.id === msgId)?.confirm;
    if (!c || c.done) return;
    setMessages((m) => m.map((x) => (x.id === msgId && x.confirm ? { ...x, confirm: { ...x.confirm, done: true, chose: yes ? "mesh" : "cad" } } : x)));
    if (yes) {
      meshSpendOk.current = true;
      void send(c.prompt, "generative", { skipClarify: true });
    } else {
      pickMode("precise");
      void send(c.prompt, "precise", { skipClarify: true });
    }
  }

  /** One-tap offer accepted or declined. Accepting re-runs the underlying tool at TAP
   *  time rather than replaying stale state — the model may have changed since the
   *  card was posted, and both tools recompute from the current geometry anyway. */
  function offerChoose(msgId: string, accepted: boolean) {
    const o = messages.find((x) => x.id === msgId)?.offer;
    if (!o || o.done) return;
    setMessages((m) => m.map((x) => (x.id === msgId && x.offer ? { ...x, offer: { ...x.offer, done: true, accepted } } : x)));
    if (!accepted) return;
    if (o.kind === "inches") void inchRescue();
    else if (o.kind === "orient") void autoOrientDrop();
    else if (o.kind === "flush") void flushPockets();
  }
  /** Convert an inch-unit import: 1 in = 25.4 mm, uniformly. */
  async function inchRescue() {
    const before = resultRef.current?.dims; // state lags the await — scale the numbers we have
    await resizeModel([25.4, 25.4, 25.4]);
    const r1 = (v: number) => Math.round(v * 25.4 * 10) / 10;
    appendMsg({ role: "assistant", text: `Converted from inches — the model is now ${before ? `${r1(before.x)} × ${r1(before.y)} × ${r1(before.z)} mm` : "25.4× bigger"}. Undo reverts it.` });
  }
  /** Pockets drilled before flush seating carried padding in their depth — glue got
   *  0.4 mm of well, press 0.1 — and the magnets sat sunken. The legacy fractions are
   *  unambiguous (flush depths are whole millimetres, every catalogue height is an
   *  integer), so the fix is exact and touches NOTHING else: same spot, same bore,
   *  the padding goes. */
  function legacyPocketFix(ops: readonly CadOp[] | undefined): { fixed: CadOp[]; n: number } | null {
    let n = 0;
    const fixed = (ops ?? []).map((op) => {
      if (op.type !== "hole" || op.tag !== "magnet" || op.depth <= 0) return op;
      const frac = Math.round((op.depth - Math.floor(op.depth)) * 10) / 10;
      if (frac !== 0.4 && frac !== 0.1) return op;
      n++;
      return { ...op, depth: Math.floor(op.depth) };
    });
    return n ? { fixed, n } : null;
  }
  async function flushPockets() {
    const cur = resultRef.current;
    if (!cur || cur.source.kind !== "code" || !sel) return;
    const legacy = legacyPocketFix(cur.source.ops);
    if (!legacy) return;
    setStatus("generating");
    try {
      const res = await sel.engine.build({ kind: "code", code: cur.source.code, params: cur.source.params, ops: legacy.fixed });
      applyResult(res, project?.name ?? "Model", `Re-cut ${legacy.n} magnet pocket${legacy.n === 1 ? "" : "s"} flush — same spots`, "flush pockets");
      appendMsg({ role: "assistant", text: `Re-cut ${legacy.n} magnet pocket${legacy.n === 1 ? "" : "s"} flush — each is now exactly its magnet's height deep, in the same spot with the same diameter. The History entry is your receipt, and Undo reverts.` });
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Couldn't re-cut the pockets: " + String(err?.message ?? err), error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  /** Import sizes that smell like inches: everything under ~half a foot when read as
   *  millimetres, i.e. a "part" smaller than a fingernail. Real millimetre models this
   *  small exist but are rare; inch-authored STLs land here every time. The band's top
   *  end also keeps the CONVERTED size inside a typical build volume, so accepting
   *  can't produce something unprintable. */
  function maybeOfferInches(d: { x: number; y: number; z: number }) {
    const maxDim = Math.max(d.x, d.y, d.z);
    if (maxDim < 0.05 || maxDim > 13) return;
    setMessages((m) => [...m, {
      id: mid(), role: "assistant",
      offer: {
        kind: "inches",
        text: `That came in tiny — ${d.x} × ${d.y} × ${d.z} mm, smaller than a fingernail. Files saved in inches read 25.4× too small here, because STL has no units and this app works in millimetres. If it was designed in inches, one tap fixes it.`,
        yes: "It was inches — scale ×25.4",
        no: `No, it really is ${maxDim} mm`,
      },
      text: "",
    }]);
  }
  /** After an import lands: if the computed print orientation would meaningfully cut
   *  supports, offer it — the app always knew, it just never said. Only for imports;
   *  CAD builds are authored flat and an offer after every edit would be noise. */
  function maybeOfferOrientation(g: THREE.BufferGeometry) {
    try {
      const s = suggestOrientation(g, printer.overhangThresholdDeg, printer.bed);
      if (!s?.improved) return;
      setMessages((m) => [...m, {
        id: mid(), role: "assistant",
        offer: {
          kind: "orient",
          text: `This prints better in a different orientation: ${s.reason.replace(/^Cuts/, "rotating it cuts")} Want it laid that way? It only changes how the part sits on the plate, not its shape.`,
          yes: "Lay it that way",
          no: "Keep it as imported",
        },
        text: "",
      }]);
    } catch { /* degenerate geometry — no advice beats wrong advice */ }
  }

  /** A chip picked, or a measurement typed, on a question card in the transcript. */
  function answerClarify(msgId: string, qid: string, value: string) {
    setMessages((m) => m.map((x) => (
      x.id === msgId && x.clarify
        ? { ...x, clarify: { ...x.clarify, answers: { ...x.clarify.answers, [qid]: value } } }
        : x
    )));
  }

  /** Build from a question card. `withAnswers: false` is the Just build it path — the
   *  request goes exactly as typed, which is the reason every question is optional.
   *  Either way the card freezes rather than disappearing, so the transcript keeps a
   *  record of what was chosen. */
  function buildFromClarify(msgId: string, withAnswers: boolean) {
    const c = messages.find((x) => x.id === msgId)?.clarify;
    if (!c || c.done) return;
    setMessages((m) => m.map((x) => (x.id === msgId && x.clarify ? { ...x, clarify: { ...x.clarify, done: true } } : x)));
    void send(withAnswers ? applyAnswers(c.prompt, c.questions, c.answers) : c.prompt, undefined, { skipClarify: true });
  }

  /** Composer's Improve button. Rewrites what is typed into something specific enough to
   *  build and keeps the original one tap away — this is a button rather than a silent
   *  always-on pass precisely so the words that get built are words the user saw. */
  async function improveInput() {
    const before = input.trim();
    if ((!before && !image) || improving) return;
    setImproving(true);
    setImproveNote(null);
    try {
      let img: { dataBase64: string; mediaType: string } | undefined;
      if (image) {
        try {
          const du = await blobToDataURL(image.blob);
          img = { dataBase64: du.split(",")[1], mediaType: image.blob.type || "image/png" };
        } catch { /* improve from the text alone */ }
      }
      const ref = await refineRequest(
        before,
        llm.provider === "anthropic" ? { ...llm, model } : llm,
        { anthropic: key, ...llmKeys },
        effectiveProxy,
        {
          image: img,
          canvas: result && project ? `the part "${project.name}"` : undefined,
          convo: chatDigest() || undefined,
          engine: mode === "generative" ? "mesh" : "cad",
        },
      );
      const next = ref?.improved.trim();
      if (!ref) setImproveNote("Couldn't reach the AI to rewrite that — send it as it is, or try again.");
      else if (!next || next.toLowerCase() === before.toLowerCase()) setImproveNote("Already specific enough to build.");
      else { setImproveBefore(before); setInput(next); }
    } finally {
      setImproving(false);
    }
  }

  async function sendInner(promptText: string, forceMode?: Mode, override?: { llm?: LlmSettings; genEng?: { provider: string; model: string }; skipClarify?: boolean; skipPlan?: boolean; routeAuto?: boolean }) {
    if (pendingRef.current) discardPending(true); // safety net — send() promotes a held proposal before ever reaching here
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

    // ---- Feedback FIRST, work second. ----
    // The user's message and a working placeholder land in the transcript BEFORE any of
    // the slow pre-work (engine classification, the clarify pass, web research, image
    // encoding). Without this, a launchpad submit with photos showed the EMPTY workspace
    // — template strip and all — for the full pre-work duration, and follow-ups sat
    // silent for up to twenty seconds before anything visibly happened. Every path
    // below either streams into this placeholder, replaces it (clarify card, routing
    // notes insert above it), or resolves it before returning.
    if (!p && !image) return;
    // Snapshot the conversation BEFORE this turn's bubbles post — the digest is what
    // "as I said two messages ago" resolves against, and must not include this ask.
    const convo = chatDigest();
    const userMsgId = mid();
    const placeholderId = mid();
    const preThumb = image ? await blobToDataURL(image.blob) : undefined;
    const preRefThumbs = refs.length ? await Promise.all(refs.map((r) => blobToDataURL(r.blob))) : undefined;
    setInput("");
    setMessages((m) => [...m,
      { id: userMsgId, role: "user", text: p || (image ? (image.markup ? "Change the marked region" : "Recreate this part") : ""), image: preThumb, images: preRefThumbs, mode: forceMode ?? mode },
      { id: placeholderId, role: "assistant", text: "Reading your request…", streaming: true },
    ]);
    // Advancing to a new stage checks the current one off into `steps` (the timeline
    // draws its connector line); writing `text` directly instead updates the active
    // row in place — that's the channel for progress ticks like "running 40%".
    const setStage = (text: string) => {
      setMessages((m) => m.map((x) => (x.id === placeholderId
        ? { ...x, text, steps: x.text && x.text !== text ? [...(x.steps ?? []), x.text] : x.steps, streaming: true }
        : x)));
      // The same line drives the canvas stage. A percentage the provider embedded in
      // its status ("running 40%") is a REAL number, so it becomes the bar; anything
      // else leaves the bar indeterminate rather than inventing one.
      const pm = text.match(/(\d{1,3})\s*%/);
      setGenProgress((g) => ({
        name: g?.name || project?.name || (p ? p.slice(0, 60) : "New part"),
        phase: text,
        pct: pm ? Math.min(100, Number(pm[1])) : null,
        kind: g?.kind ?? "cad",
      }));
    };

    // Fresh chat + the user never touched the engine switch → route by what the words
    // describe. Organic/sculptural things are beyond CAD's reach and belong on the mesh
    // engine; dimensioned functional parts belong in CAD. When the words alone don't
    // decide, the configured brain (OpenRouter, Gemini, Claude, …) classifies the
    // request — tiny, fast, best-effort. One notice, one tap to override.
    const brainLlm: LlmSettings = llm.provider === "anthropic" ? { ...llm, model } : llm;
    const brainKeys = { anthropic: key, ...llmKeys };
    let routedMode: Mode | null = null;
    let refineRoute = false; // routed to mesh specifically to refine the CURRENT model
    // `routeAuto` forces routing regardless of the pref STATE: the Launchpad resets the
    // pref to Auto and sends in the same tick, so this closure still sees the old value.
    if (!forceMode && !result && (modePref === "auto" || override?.routeAuto) && (p || (image && !image.markup))) {
      const organic = ORGANIC_RE.test(p) && !CADISH_RE.test(p);
      const cadish = CADISH_RE.test(p) && !ORGANIC_RE.test(p);
      if (mode === "precise" && organic) routedMode = "generative";
      else if (mode === "generative" && cadish) routedMode = "precise";
      else if (!organic && !cadish) {
        // Words alone don't decide — the brain classifies. With an attachment (a photo
        // OR a hand-drawn sketch), the vision brain judges the OBJECT it shows: a
        // sketched bracket routes to CAD, a sketched dragon to the mesh engine.
        let routeImg: { dataBase64: string; mediaType: string } | undefined;
        if (image && !image.markup) {
          try {
            const dataUrl = await blobToDataURL(image.blob);
            routeImg = { dataBase64: dataUrl.split(",")[1], mediaType: image.blob.type || "image/png" };
          } catch { /* classify from text alone */ }
        }
        setStage("Choosing the right engine for this…");
        const cls = await classifyIntent(p, brainLlm, brainKeys, effectiveProxy, routeImg);
        if (cls === "mesh" && mode === "precise") routedMode = "generative";
        else if (cls === "cad" && mode === "generative") routedMode = "precise";
      }
      if (routedMode) {
        setMode(routedMode);
        setMessages((m) => m.map((x) => (x.id === userMsgId ? { ...x, mode: routedMode! } : x)));
        const seen = image ? "Your attachment looks" : "This sounds";
        setMessages((m) => {
          const note = {
            id: mid(), role: "assistant" as const,
            text: routedMode === "generative"
              ? `${seen} organic/sculptural — **Auto** chose **Generative (AI mesh)**, which models freeform shapes far better than CAD. Switch engines anytime with the buttons above.`
              : `${seen} like a dimensioned, functional part — **Auto** chose **Precise (CAD)** for exact measurements and STEP export. Switch engines anytime with the buttons above.`,
          };
          const i = m.findIndex((x) => x.id === placeholderId);
          return i < 0 ? [...m, note] : [...m.slice(0, i), note, ...m.slice(i)];
        });
      }
    }
    // A CAD model is on the canvas and the ask is sculptural ("make it look like a
    // dragon", "sculpt organic vines on it") — CAD genuinely can't do that. Hop to the
    // mesh engine and refine a SNAPSHOT of the current model; the CAD program stays in
    // History, so nothing is lost.
    if (!forceMode && !routedMode && p && !image && result && geometry && mode === "precise"
      && SCULPT_EDIT_RE.test(p) && !CADISH_RE.test(p) && REFINE_REF_RE.test(p)) {
      routedMode = "generative";
      refineRoute = true;
      setMode("generative");
    }
    // The mode switch decides: Generative -> mesh provider; Precise + photo -> vision CAD.
    const useGen = (routedMode ?? forceMode ?? mode) === "generative";
    setGenProgress((g) => (g ? { ...g, kind: useGen ? "mesh" : "cad" } : g));

    // ---- Plan first: agree the spec before spending the build. ----
    // Ahead of clarify and of every expensive step, because the whole point is to get
    // the FIRST model right rather than converge over four paid rounds. Fresh builds
    // only — an edit already has the canvas as its brief. Best-effort: no brain, a
    // timeout, or an unparseable reply and this falls straight through to the build it
    // would have run anyway.
    if (!override?.skipPlan && planOn && !guided && !result && !image?.markup && (p || image)) {
      setStage("Writing a build plan…");
      let planImg: { dataBase64: string; mediaType: string } | undefined;
      if (image) {
        try {
          const du = await blobToDataURL(image.blob);
          planImg = { dataBase64: du.split(",")[1], mediaType: image.blob.type || "image/png" };
        } catch { /* plan from the text alone */ }
      }
      const draft = await draftPlan(p, brainLlm, brainKeys, effectiveProxy, {
        image: planImg,
        engine: useGen ? "mesh" : "cad",
      });
      if (draft) {
        // The placeholder BECOMES the plan card: nothing is generated until it is
        // approved, so there is no work in flight to narrate.
        setMessages((m) => m.map((x) => (x.id === placeholderId
          ? { id: x.id, role: "assistant" as const, text: "", plan: { prompt: p, plan: draft } }
          : x)));
        return;
      }
    }

    // ---- Too vague to build? Ask — with the answers already filled in. ----
    // After routing, so the questions suit the engine that will actually build (a mesh
    // ask needs pose and style; a CAD ask needs the measurement it has to fit), and
    // before any of the expensive work. Fresh builds only: an edit already has the
    // canvas for context, and a card between every tweak would be a tax rather than a
    // help. Best-effort throughout — no brain, a timeout, or nothing worth asking and
    // this falls through to the identical build it would have run anyway.
    if (!override?.skipClarify && clarifyOn && !guided && !result && !image?.markup && (p || image)) {
      setStage("Checking nothing important is missing…");
      let clarifyImg: { dataBase64: string; mediaType: string } | undefined;
      if (image) {
        try {
          const du = await blobToDataURL(image.blob);
          clarifyImg = { dataBase64: du.split(",")[1], mediaType: image.blob.type || "image/png" };
        } catch { /* ask from the text alone */ }
      }
      const ref = await refineRequest(p, brainLlm, brainKeys, effectiveProxy, {
        image: clarifyImg,
        canvas: result && project ? `the part "${project.name}"` : undefined,
        convo: convo || undefined,
        engine: useGen ? "mesh" : "cad",
      });
      if (ref?.questions.length) {
        // The photo deliberately stays in the composer — Build it re-enters send() and
        // the reference has to still be attached when it does. The card takes the
        // placeholder's seat; the user message went up before the pre-work.
        setMessages((m) => m.map((x) => (x.id === placeholderId
          ? { ...x, text: "", streaming: false, clarify: { prompt: p, questions: ref.questions, answers: defaultAnswers(ref.questions) } }
          : x)));
        return;
      }
    }

    if (useGen) {
      if (!p && !image) return;
      // "Refine the current model as a mesh": no photo attached, but a model is on the
      // canvas and the words point at it → a clean snapshot of the model becomes the
      // reference image for the image→3D engine. Works from the sculpt-route above OR
      // when the user flipped to Generative themselves and said "refine/sculpt it".
      let genImage = image;
      let refinedFromCanvas = false;
      if (!image && p && result && geometry && (refineRoute || REFINE_REF_RE.test(p))) {
        const shot = viewer.current?.captureModelShot();
        if (shot) {
          try {
            genImage = { blob: dataUrlToBlob(shot), url: shot };
            refinedFromCanvas = true;
          } catch { /* snapshot failed — continue as plain text→3D */ }
        }
      }
      let ge = override?.genEng ?? genEng; // retry-with-model can override the engine
      if (ge.provider === "auto") {
        const pick = pickAutoGenEngine({ hasImage: !!genImage, prompt: p, hasKey: (id) => !!providerKeys[id] });
        ge = { provider: pick.provider, model: pick.model };
        setAutoPick(`Auto → ${pick.label} (${pick.reason} · ${costLabel(pick.provider, pick.model) || "price unknown"})`);
      } else {
        setAutoPick("");
      }
      const prov = getProvider(ge.provider);
      if (prov?.needsKey && !providerKeys[prov.id]) {
        setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: `${prov.label} needs an API key — add it in Settings (just opened), then press Retry on your message.`, streaming: false } : x)));
        setShowSettings(true);
        return;
      }
      // Web-grounded dimensions for TEXT mesh prompts that name a real product — the same
      // lookup Precise uses, so "a phone stand for an iPhone 17 Pro" is proportioned from
      // real numbers. Skipped for photo inputs (the photo IS the reference).
      // Short text→3D asks get a free "prompt polish" from the configured brain (the
      // same OpenRouter/Gemini/Claude key that powers Precise) — mesh generators reward
      // detailed visual descriptions. Digits mean the user gave specs: don't paraphrase.
      let genPrompt = p;
      if (p && !genImage && p.length < 120 && !/\d/.test(p)) {
        const polished = await polishMeshPrompt(p, brainLlm, brainKeys, effectiveProxy);
        if (polished && polished.toLowerCase() !== p.toLowerCase()) {
          genPrompt = polished;
          explainOnce(
            "meshpolish",
            `I expanded your ask into a fuller description for the mesh engine (they do best with detail): “${polished}”. From now on I'll do this quietly — add your own detail any time to take over.`,
          );
        }
      }
      // The globe toggle applies here too. A sculpt of something real ("a Lamborghini
      // Gallardo") is exactly when reference PHOTOS matter more than millimetres, so
      // the lookup runs in visual mode and the pictures it finds land in the chat.
      if (p && !genImage && (webMode === "on" || detectProductQuery(p))) {
        const rk = { geminiKey: llmKeys["gemini"], geminiModel: llm.provider === "gemini" ? llm.model : "", anthropicKey: key, openrouterKey: llmKeys["openrouter"], openrouterModel: llm.provider === "openrouter" && llm.model !== AUTO_MODEL ? llm.model : "" };
        if (canResearch(rk)) {
          try {
            const genCtx = result && project ? `the part "${project.name}"` : undefined;
            setWebState(placeholderId, { query: p.slice(0, 90) });
            const rr = await researchDimensions(p, rk, genCtx, { visual: true });
            setWebState(placeholderId, { query: p.slice(0, 90), done: true, found: !!rr, sources: rr?.sources ?? [] });
            if (rr) {
              genPrompt = `${genPrompt}\n\nReal-world reference (researched online):\n${rr.text}`;
              setMessages((m) => [...m, { id: mid(), role: "assistant", text: `Found online:\n${rr.text}`, sources: rr.sources, images: rr.images }]);
            }
          } catch { /* research is best-effort */ }
        }
      }

      // Text-only request on an image-only model? Auto-switch to a text-capable
      // model from the same provider instead of dead-ending the user in Settings.
      let genModel = ge.model;
      let switchedTo: string | null = null;
      if (!genImage && p && prov) {
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
      if (refinedFromCanvas) {
        explainOnce(
          "cad2mesh",
          "Refining your current model as a **mesh**: I snapshotted it and I'm feeding that picture to the image→3D engine along with your words. The trade: the result is a sculpted mesh (STL/OBJ/3MF — prints great, opens in Nomad Sculpt), not parametric CAD, so STEP export and dimension-exact edits don't apply to it. Your CAD version stays safe in **History** — restore it any time.",
          "Refining the current model as a mesh (snapshot → image→3D). The CAD version stays in History.",
        );
      }
      // A PAID mesh generation never starts silently: the first one each session stops
      // for one tap with the price on the button — and offers the free CAD path, since
      // many people don't know mesh engines bill per run and CAD doesn't.
      const estUsd = costUsd(ge.provider, genModel) ?? 0;
      if (estUsd > 0 && !meshSpendOk.current) {
        setMessages((m) => m.map((x) => (x.id === placeholderId ? {
          ...x, streaming: false, text: "",
          confirm: {
            text: `This looks like a job for the ${prov?.label ?? ge.provider} mesh engine — sculpted, organic detail, billed per run (about ${costLabel(ge.provider, genModel) || `$${estUsd.toFixed(2)}`} each). A functional part with exact millimetres builds FREE with your AI key instead.`,
            yes: `Generate the mesh (~$${estUsd.toFixed(2)})`,
            no: "Free CAD part instead",
            prompt: p || "(image upload)",
          },
        } : x)));
        return;
      }
      // Price BEFORE anything runs — the answer to "which platform is going to bill
      // me, and how much?" belongs in the very first line, not on the invoice. The user
      // message and placeholder are already up (posted before the pre-work).
      const costNote = costLabel(ge.provider, genModel);
      const costTag = costNote ? ` · ${costNote}` : "";
      const ph = placeholderId;
      setStage(switchedTo ? `Switched to ${switchedTo} — it supports text → 3D${costTag}. Preparing…` : `Preparing… (${prov?.label ?? ge.provider}${costTag})`);
      setStatus("generating");

      const genEngine = await getGenEngine();
      genEngine.config = { keyFor: (id) => providerKeys[id] || undefined, proxyBase: effectiveProxy };
      genEngine.onProgress = (pr) =>
        // First tick checks "Preparing…" off the step timeline; the rest rewrite the
        // active row in place so queue/percent updates don't grow the list.
        setMessages((m) => m.map((x) => (x.id === ph
          ? { ...x, text: `Generating mesh${costTag}… ${pr.status}`, steps: x.text.startsWith("Generating mesh") ? x.steps : [...(x.steps ?? []), x.text], streaming: true }
          : x)));
      const runGen = async (provId: string, modelId: string, label: string) => {
        let res = await genEngine.build({ kind: "gen", image: genImage?.blob, views: { left: views.left?.blob, back: views.back?.blob, right: views.right?.blob }, prompt: genPrompt || undefined, provider: provId, model: modelId, texture: genTexture === "on" });
        // AI meshes carry no real-world units — engines routinely hand back a "car-sized
        // car" (a real one arrived at 1161 mm on a 320 mm bed). Print-friendly default:
        // shrink anything oversize to fit the plate, say so, and record the scale so it
        // survives reopen. Resize / Fit to plate can make it any size afterwards.
        let fitNote = "";
        const ff = fitToBedFactor(res.dims, printer.bed);
        if (ff < 1) {
          const baked = bakeMeshTransform(res.geometry, scaleAboutBase(res.geometry, [ff, ff, ff]));
          res = { ...res, geometry: baked.geometry, dims: baked.dims, meshXform: composeXform(res.meshXform, baked.applied) };
          fitNote = ` — scaled to fit your ${printer.bed.x}×${printer.bed.y}×${printer.bed.z} mm build volume (AI meshes have no real size; use Resize to make it any size)`;
        }
        const name = deriveName(p || "Photo model");
        const usd = costUsd(provId, modelId) ?? 0;
        recordSpend(provId, modelId, usd); // paid runs land in the local spend ledger
        const spent = usd > 0 ? ` · ${costLabel(provId, modelId)}` : "";
        const summary = `Generated a mesh — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm (${label}${spent})${fitNote}`;
        const how = await deliverResult(res, name, summary, p || "(image upload)", true);
        setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: summary + (how === "pending" ? " — it's on the canvas as a preview: Apply to keep it, or Discard." : ""), streaming: false } : x)));
      };
      try {
        await runGen(ge.provider, genModel, prov?.label ?? ge.provider);
      } catch (err: any) {
        // The free GPU turning a job away (quota drained / Space overloaded) isn't the
        // end when a KEYED engine can take the same request — retry there automatically,
        // once, and say so. Never falls back for real config errors or non-HF failures.
        const msg = String(err?.message ?? err);
        const hfRejected = ge.provider === "hf" && /free GPU rejected|GPU minutes|anonymous quota is tiny|free GPU queue/i.test(msg);
        const alt = hfRejected && !override?.genEng
          ? pickAutoGenEngine({ hasImage: !!genImage, prompt: p, hasKey: (id) => !!providerKeys[id] })
          : null;
        if (alt && alt.provider !== "hf") {
          const altProv = getProvider(alt.provider);
          const altLabel = altProv?.label ?? alt.provider;
          const altCost = costLabel(alt.provider, alt.model);
          const altTag = altCost ? ` (${altCost})` : "";
          // Keep the fallback context in EVERY progress line — the engine's first
          // progress event lands within milliseconds and would otherwise erase the
          // announcement before anyone could read it.
          genEngine.onProgress = (pr) =>
            setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: `Free GPU turned this job away — retrying on your ${altLabel} key${altTag}… ${pr.status}`, streaming: true } : x)));
          setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: `Free GPU turned this job away — retrying on your ${altLabel} key${altTag}…`, steps: [...(x.steps ?? []), x.text], streaming: true } : x)));
          try {
            await runGen(alt.provider, alt.model, altLabel);
          } catch (err2: any) {
            setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: `Free GPU: ${msg}\n\nFallback (${altLabel}): ${friendlyNet(String(err2?.message ?? err2))}`, error: true, streaming: false } : x)));
          }
        } else {
          setMessages((m) => m.map((x) => (x.id === ph ? { ...x, text: friendlyNet(msg), error: true, streaming: false } : x)));
        }
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
      const pick = pickAutoModel(await ensureOrCatalog(), { prompt: promptText, isEdit: !!result, hasImage: !!image });
      const chosen = pick?.model.id ?? llmPreset("openrouter").defaultModel;
      effLlm = { ...effLlm, model: chosen };
      setAutoPick(pick ? `Auto → ${shortModelName(chosen)} (${pick.reason})` : `Auto → ${shortModelName(chosen)} (couldn't load the live model list — using the default)`);
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
      // Intercept inline instead of force-opening Settings on whatever pane was last
      // used and throwing the prompt away. The card keeps the sentence and both exits.
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: "Precise CAD needs an AI provider — pick one in the card below.", streaming: false } : x)));
      setProviderWall(promptText);
      return;
    }
    // The kernel warm-up is deferred to post-paint idle — if a fast first message
    // beats it, boot now (same shared, memoized boot; the status pill narrates it)
    // instead of bouncing the user to "try again in a few seconds". Shadows the
    // state on purpose: the rest of send() must use TODAY's engine, not the
    // closure's possibly-null snapshot.
    const sel = await ensureEngine();

    const kind = sel.kind;
    const visionImage = image; // capture before we clear it
    const visionRefs = refs;   // the unlabelled extras ride with it
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
    setStreamingText("");
    setStreamingThink("");
    // The user message and placeholder went up before the pre-work; from here the
    // shared placeholder narrates this path.
    setStage("Thinking…");
    setStatus("generating");

    // Narrated thinking: every request shows its working steps live in the thinking
    // panel — what the AI is looking at and doing — with the model's own reasoning
    // streaming underneath when the model exposes it. The trail is kept on the
    // finished message too, so "what did it just do?" always has an answer.
    const steps: string[] = [];
    let lastThink = ""; // model reasoning (kept on the reply for later reading)
    const thinkTrail = () => steps.join("\n") + (lastThink ? `\n\n${lastThink}` : "");
    const pushStep = (s: string) => {
      steps.push(`▸ ${s}`); // kept for the saved "Thought process" transcript
      setStage(s); // …and advances the live step timeline in the bubble
    };
    // Live panel shows ONLY the model's own reasoning — the harness steps already
    // read as the timeline above it, so mirroring them here would double them up.
    const onThink = (_t: string, full: string) => {
      lastThink = full;
      setStreamingThink(full);
    };
    if (visionImage) {
      pushStep(visionImage.markup
        ? "Reading your marked screenshot — mapping the circled region onto the model…"
        : "Studying your reference image — outlines, proportions, and any written measurements…");
    }

    // Product research: when the request names a real-world product ("a case
    // for my iPhone 17 Pro"), look up its exact measurements on the web first
    // so the CAD code is built from real numbers instead of guesses. Runs via
    // Gemini's free search grounding or Claude's web-search tool; best-effort —
    // if neither key is set or the lookup fails, generation continues as before.
    let researched: string | null = null;
    let researchImages: string[] = [];
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
      openrouterModel: llm.provider === "openrouter" && llm.model !== AUTO_MODEL ? llm.model : "",
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
      pushStep("Searching the web for the product's real dimensions…");
      // …and say so in its own right: the globe block below the timeline pulses for
      // as long as the lookup runs, so an online step never looks like a stall.
      setWebState(placeholderId, { query: p.slice(0, 90) });
      const rr = await researchDimensions(p, researchKeys, partContext);
      researched = rr?.text ?? null;
      researchSources = rr?.sources ?? [];
      researchImages = rr?.images ?? [];
      setWebState(placeholderId, { query: p.slice(0, 90), done: true, found: !!researched, sources: researchSources });
      if (researched) {
        // Show the found measurements as their own note, above the working placeholder —
        // with the pages the lookup actually used, so the numbers can be checked, and
        // any product photos it found, so the product can be eyeballed.
        setMessages((m) => {
          const idx = m.findIndex((x) => x.id === placeholderId);
          const note = { id: mid(), role: "assistant" as const, text: `Measurements found online:\n${researched}`, sources: researchSources, images: researchImages };
          return idx < 0 ? [...m, note] : [...m.slice(0, idx), note, ...m.slice(idx)];
        });
      }
      setStage("Thinking…");
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
      (partContext ? `\n\nCurrent canvas: the user is working on ${partContext}. Edit requests refer to this part.` : "") +
      // …and to what was SAID. apiHistory only survives successful turns and is
      // re-seeded to bare code on undo/redo, so requirements from earlier bubbles
      // ("32 mm wide, like I said") vanished — each request read as a fresh
      // conversation (a real report). The transcript digest is rebuilt every turn,
      // costs a few hundred tokens, and rides the SYSTEM prompt so it is never
      // recorded into history (no digest-of-digest compounding).
      (convo ? `\n\nRecent conversation (the request may refer back to details here — honour them):\n${convo}` : "");
    // Extra angles the user attached (left / back / right). One photo leaves depth and
    // the far side to guesswork — the model invents them. Handing the vision model
    // every view it has makes proportions and hidden features observed rather than
    // imagined. Labelled so it knows which side it's looking at. Skipped for a markup
    // edit, where the screenshot IS the subject.
    const extraViews: { label: string; blob: Blob }[] = markupEdit
      ? []
      : (["left", "back", "right"] as const)
          .filter((s) => views[s])
          .map((s) => ({ label: s, blob: views[s]!.blob }));
    const extraViewParts = (await Promise.all(extraViews.map(async (v) => {
      const b64 = (await blobToDataURL(v.blob)).split(",")[1];
      return [
        { type: "text" as const, text: `Additional reference — the ${v.label} side of the same object:` },
        { type: "image" as const, mediaType: v.blob.type || "image/png", dataBase64: b64 },
      ];
    }))).flat();
    // Unlabelled extras from a multi-photo drop — same object, angle unstated. The model
    // is told exactly that, so it treats them as additional observations rather than
    // inventing a side for each.
    const refParts = (await Promise.all((markupEdit ? [] : visionRefs).map(async (r) => {
      const b64 = (await blobToDataURL(r.blob)).split(",")[1];
      return [
        { type: "text" as const, text: "Additional reference photo of the same object (angle unspecified):" },
        { type: "image" as const, mediaType: r.blob.type || "image/png", dataBase64: b64 },
      ];
    }))).flat();
    // Product photos the research found, by URL — the PROVIDER fetches them, the only
    // route a browser app has to third-party images. Gated to APIs that accept URL
    // image parts; everyone else still gets the researched TEXT and the chat thumbnails.
    const urlImagesOk = ["anthropic", "openai", "openrouter", "house", "custom"].includes(effLlm.provider);
    const webRefParts = researchImages.length && urlImagesOk && !markupEdit
      ? [
          { type: "text" as const, text: "Product photos found online (visual reference for proportions and features):" },
          ...researchImages.slice(0, 2).map((u) => ({ type: "image_url" as const, url: u })),
        ]
      : [];
    const extraCount = extraViews.length + (markupEdit ? 0 : visionRefs.length);
    if (extraCount) {
      pushStep(`Reading ${extraCount + 1} reference photos${extraViews.length ? ` (front, ${extraViews.map((v) => v.label).join(", ")})` : ""}`);
    }
    const userMsg: ApiMsg = visionImage
      ? {
          role: "user",
          content: [
            { type: "image", mediaType: visionImage.blob.type || "image/png", dataBase64: visionThumb!.split(",")[1] },
            ...extraViewParts,
            ...refParts,
            ...webRefParts,
            {
              type: "text",
              text: markupEdit
                ? `Here is the current replicad program:\n\`\`\`js\n${markupCode}\n\`\`\`\n\nThe screenshot shows this model as currently rendered; the red marker circles the region to change.${markupRegionLine}\nApply this change there: ${p || "improve the marked region"}${extras}`
                : (p || "Recreate this part as precise, printable CAD. Estimate dimensions from the photo.") + extras,
            },
          ],
        }
      : webRefParts.length
        // Text-only ask, but the research found product photos: attach them anyway —
        // "a stand for an iPhone 17" built while LOOKING at the phone beats memory.
        ? { role: "user", content: [...webRefParts, { type: "text", text: pWithFacts }] }
        : { role: "user", content: pWithFacts };
    // Beta cost meter: SUM every attempt for this message — retries are real spend,
    // and hiding them would make the meter lie about what a build actually cost.
    const spent = { inTok: 0, outTok: 0, usd: 0, priced: true, any: false, est: false };
    const onUsage: NonNullable<Parameters<typeof generateLlm>[4]>["onUsage"] = (u) => {
      if (!u.final) return;
      spent.any = true;
      spent.inTok += u.inTok ?? 0;
      spent.outTok += u.outTok ?? 0;
      if (u.usd == null) spent.priced = false; else spent.usd += u.usd;
      spent.est ||= !!u.est;
    };
    const msgUsage = () => (spent.any ? { inTok: spent.inTok, outTok: spent.outTok, usd: spent.priced ? spent.usd : null, est: spent.est } : undefined);
    // Cap the rolling context so long sessions don't slow down / blow the window.
    let history: ApiMsg[] = [...apiHistory.current.slice(-16), userMsg];
    let finalRaw = "";
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
        pushStep(`Writing the change with ${shortModelName(effLlm.model)} (edit mode — only the lines that change)…`);
        const raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system + EDIT_BLOCK_ADDENDUM, editHistory, { onToken: (_t, full) => setStreamingText(full), onThinking: onThink, onUsage }, effectiveProxy);
        finalRaw = raw;
        const newCode = hasEditBlocks(raw) ? applyEditBlocks(currentCode, parseEditBlocks(raw)) : extractJsBlock(raw);
        if (newCode && newCode.trim() && newCode !== currentCode) {
          pushStep("Applying the edit and rebuilding the solid in the CAD kernel…");
          // Carry the user's adjustments forward — but NOT over a value the AI just
          // changed. A committed params map holds every key, and it overrides
          // defaultParams inside main(); so after any adjustment, "make the walls 4 mm"
          // rebuilt with the old 2.5 and reported success on unchanged geometry.
          // A key survives only if the edit left its default alone.
          const prevDefs = cadDefaults ?? {};
          const newDefs = extractParams(newCode) ?? {};
          const kept: CadParams = {};
          for (const [k, v] of Object.entries(result?.source.kind === "code" ? result.source.params ?? {} : {})) {
            if (k in newDefs && newDefs[k] === prevDefs[k]) kept[k] = v;
          }
          const editParams = Object.keys(kept).length ? kept : undefined;
          const res = await sel.engine.build({ kind: "code", code: newCode, params: editParams, ops: currentOps });
          const summary = `Updated the model — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`;
          const how = await deliverResult(res, project?.name ?? deriveName(p), summary, p);
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: summary + (how === "pending" ? " — preview on the canvas (green = added, red = removed): Apply or Discard." : ""), streaming: false, model: shortModelName(effLlm.model), thinking: thinkTrail() || undefined, usage: msgUsage() } : x)));
          // Record the resulting FULL code in history so the next turn has accurate context.
          apiHistory.current = [...apiHistory.current.slice(-16), { role: "user", content: pWithFacts }, { role: "assistant", content: "```js\n" + newCode + "\n```" }];
          ok = true;
        }
      } catch {
        /* fall through to the reliable full-regenerate loop */
      }
      if (ok) { setStatus("idle"); setStreamingText(""); setStreamingThink(""); return; }
      setStage("Thinking…");
    }

    let usedLocal = effLlm.provider === "local";
    /** Reachability failures only (fetch/network errors, timeouts, provider/relay
        5xx) — a model's bad output or a key problem must NOT quietly swap brains. */
    const isNetErr = (err: any) =>
      /failed to fetch|networkerror|load failed|err_internet|err_network|err_connection|timed? ?out|http 5\d\d|bad gateway|service unavailable|gateway time|relay error|couldn'?t reach|cannot reach|unreachable/i.test(String(err?.message ?? err));
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        let raw: string;
        pushStep(attempt === 1
          ? `Writing the ${kind === "replicad" ? "CAD program" : "model spec"} with ${shortModelName(effLlm.model)}…`
          : `Attempt ${attempt} — feeding the build error back so the model can fix its code…`);
        try {
          raw = await generateLlm(effLlm, { anthropic: key, ...llmKeys }, system, history, { onToken: (_t, full) => setStreamingText(full), onThinking: onThink, onUsage }, effectiveProxy);
        } catch (err: any) {
          // Cloud brain unreachable + the on-device model is already on this machine →
          // answer locally instead of failing (works fully offline).
          if (effLlm.provider === "local" || !isNetErr(err) || !localSupported() || !localDownloaded()) throw err;
          usedLocal = true;
          pushStep("Cloud brain unreachable — switching to the on-device model…");
          setMessages((m) => {
            const idx = m.findIndex((x) => x.id === placeholderId);
            const note = { id: mid(), role: "assistant" as const, text: "Couldn't reach the cloud brain — answering with the **on-device model** instead (smaller: great for simple parts, weaker on complex ones)." };
            return idx < 0 ? [...m, note] : [...m.slice(0, idx), note, ...m.slice(idx)];
          });
          raw = await generateLlm({ provider: "local", model: "" }, { anthropic: key, ...llmKeys }, system, history, { onToken: (_t, full) => setStreamingText(full), onThinking: onThink, onUsage }, effectiveProxy);
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
          pushStep("Building the solid in the CAD kernel…");
          const res = await sel.engine.build(bi);
          if (!name) name = deriveName(p);
          if (!summary) summary = `Updated the model — ${res.dims.x} × ${res.dims.y} × ${res.dims.z} mm`;
          const how = await deliverResult(res, name, summary, p, !!visionImage);
          setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: summary + (how === "pending" ? " — preview on the canvas (green = added, red = removed): Apply or Discard." : ""), streaming: false, model: usedLocal ? "on-device" : shortModelName(effLlm.model), thinking: thinkTrail() || undefined, usage: msgUsage() } : x)));
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
          setStage(`Attempt ${attempt} didn't build (${msg.slice(0, 80)}) — retrying…`);
        }
      }
    } catch (err: any) {
      setMessages((m) => m.map((x) => (x.id === placeholderId ? { ...x, text: friendlyNet(String(err?.message ?? err)), error: true, streaming: false, thinking: thinkTrail() || undefined } : x)));
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
    // A mesh template is a sculpt, not a program: it goes through the normal generative
    // path (engine picker, pricing line, the usual progress) with its prompt pre-written.
    // The gallery card says it costs a generation, so the run is never a surprise.
    if (t.kind === "mesh") {
      setMode("generative");
      void send(t.prompt ?? t.summary, "generative");
      return;
    }
    setMode("precise");
    const s = await ensureEngine();
    if (s.kind !== "replicad") {
      setMessages([{ id: mid(), role: "assistant", text: "Templates need the full CAD kernel, which couldn't load in this browser — try reloading the page.", error: true }]);
      return;
    }
    setStatus("generating");
    try {
      const res = await s.engine.build({ kind: "code", code: t.code! });
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
    const s = await ensureEngine();
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
    const engine = result.kind === "generative" ? await getGenEngine() : sel?.engine;
    if (!engine) return;
    try {
      // Print-ready by default: analyse, auto-repair meshes, sanity-check scale/bed.
      const pf = prepareExport();
      if (!pf) return;
      const made = format === "3mf" ? await build3MF(pf.result.geometry) : null;
      downloadBlob(made?.blob ?? (await engine.export(pf.result, format)), safeFileName(exportBase(), format));
      // STEP is a CAD hand-off, not a print file — skip the print-readiness line.
      if (format !== "step") {
        const named = made && made.parts > 1 ? ` All ${made.parts} objects are in the one file, named.` : "";
        const caveat = paintCaveat(format);
        const label = `Exported ${format.toUpperCase()}.`;
        explainOnce("export", `${label} ${preflightSummary(pf)}${named}${caveat ? " " + caveat : ""}`, exportBrief(label, pf, caveat));
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
      const g = await showFromGlb(next.glb, { kind: "gen", provider: next.genSource?.provider ?? "", model: next.genSource?.model ?? "", prompt: next.genSource?.prompt }, next.meshXform);
      // A split version carries its piece layout — revive the per-piece export list
      // (undo/redo/reopen land here) instead of losing it until the next re-split.
      const hv = next.versions[headIndex(next)];
      if (hv?.splitPieces?.length) {
        const pieces = reviveSplitPieces(g, hv.splitPieces);
        if (pieces) {
          setSplitPieces(pieces);
          const maxPlate = Math.max(...pieces.map((pc) => pc.plate ?? 1));
          if (maxPlate > 1) setPlateCount((c) => Math.max(c, maxPlate));
        }
      }
    } else if (next.engine === "generative") {
      // No mesh bytes on THIS device (falling through would "build" empty code and
      // fail with a bare kernel error). Meshes sync through the account's Storage
      // bucket — say what's missing and how to get it instead of an empty viewer.
      throw new Error(
        "This project's 3D mesh isn't stored on this device yet. Meshes sync through your account: sign in on both devices, open the project once where it was made so it uploads, then reopen it here. (Or re-generate / re-import the model.)",
      );
    } else {
      // Boot-on-demand (don't skip the rebuild when a resume/open races the deferred
      // kernel warm-up — that left the viewer empty until the next interaction).
      const s = sel ?? (await ensureEngine());
      if (s.engine.setImport) {
        // The stored kind matters: an STL-as-CAD import re-read as STEP fails with a
        // bare kernel error on every undo/reopen (found by resize-e2e).
        await s.engine.setImport(next.importFile ?? null, next.importKind ?? "step");
        importFileRef.current = next.importFile ?? null;
        importKindRef.current = next.importKind ?? "step";
      }
      const bi: BuildInput =
        next.engine === "replicad"
          ? { kind: "code", code: next.code ?? "", params: next.params, ops: next.ops }
          : { kind: "spec", spec: parseSpec(JSON.stringify(next.spec)) };
      applyResultNoCommit(await s.engine.build(bi));
    }
  }

  async function restoreTo(versionId: string) {
    if (!project) return;
    dissolveSeparation(); // restoring rebuilds the model — drop the sandbox's floating parts
    const next = restoreVersion(project, versionId);
    persist(next);
    try {
      await rebuildHead(next);
      stampHeadThumb();
      // No chat bubble. A restore is a HISTORY event and the History panel already
      // shows it as a step; posting one bubble per restore turned the transcript into
      // sixteen identical lines that buried the actual conversation (a real report).
      // Failures still speak up — those are news.
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: "Restore failed to rebuild: " + String(err?.message ?? err), error: true }]);
    }
  }

  // Undo/redo step HEAD back/forward over the append-only version history, without
  // appending — so a redo stays available until the next real edit.
  const hIdx = project ? headIndex(project) : -1;
  // While the dry-fit sandbox is open, Undo means "regroup" — that's the last action.
  const canUndo = paintPast.current.length > 0 || separated || (!!project && hIdx > 0);
  const canRedo = paintFuture.current.length > 0 || (!!project && hIdx >= 0 && hIdx < project.versions.length - 1);
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
      stampHeadThumb(true); // older versions from before thumbnails existed fill in lazily
    } catch (err: any) {
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: (dir < 0 ? "Undo" : "Redo") + " failed to rebuild: " + String(err?.message ?? err), error: true }]);
    } finally {
      setNavBusy(false);
    }
  }
  // One tool at a time. The rail buttons and the keyboard shortcuts both call these,
  // so a key can never leave two tools armed the way a raw setter would.
  // Guarded on the engine: the rail hides the Select button entirely for a generative
  // mesh (features can't be picked on one), but the keyboard had no such guard — V armed
  // the tool anyway, the Viewer started picking, and the button that would turn it back
  // off was not rendered. Silently doing nothing is the honest behaviour here.
  const toggleSelectTool = () => { if ((result?.kind ?? (mode === "generative" ? "generative" : sel?.kind ?? "primitive")) !== "replicad") return; setSelectMode((m) => { const on = !m; if (on) { setTransformMode("off"); setMeasureMode(false); setMeasurePending(null); setPaintModeState(false); setMagnetTool(null); setScrewTool(null); } else { setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); } return on; }); };
  const toggleMeasureTool = () => setMeasureMode((on) => { const next = !on; if (next) { setSelectMode(false); setTransformMode("off"); setPaintModeState(false); setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); setMagnetTool(null); setScrewTool(null); } else setMeasurePending(null); return next; });
  const toggleTransformTool = () => { const next = transformMode === "off" ? "move" : "off"; setTransformMode(next); setModelSelected(next !== "off"); if (next !== "off") { setSelectMode(false); setMeasureMode(false); setPaintModeState(false); setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); setMagnetTool(null); setScrewTool(null); } };

  const undo = () => {
    // Time travel during a build is a race the user always loses: the in-flight
    // result lands AFTER the undo and silently re-does it. Wait out the build.
    if (statusRef.current === "generating") return;
    if (undoPaint()) return; // strokes come off first — they're the newest thing you did
    if (separatedRef.current) regroupParts(); // un-separate first; history stays untouched
    else void stepHead(-1);
  };
  const redo = () => {
    if (statusRef.current === "generating") return;
    if (redoPaint()) return;
    void stepHead(1);
  };

  /** Tap on empty canvas, or Escape: put down whatever tool is out and close what's
      open. The same routine backs both, so they can never drift apart. */
  const dismissOverlays = () => {
    setSelectMode(false);
    setTransformMode("off");
    setMeasureMode(false);
    setMeasurePending(null);
    setPaintModeState(false);
    setActivePinId(null);
    setPinText("");
    setSelectedFeature(null);
    setSelectedFaces([]);
    setModelSelected(false);
    setHoleDraft(null); // drop any un-drilled hole draft
    setHoleEdit(null); // and any hole-edit selection
    setMagnetTool(null); // magnet mode goes down with the rest
    setScrewTool(null);
  };
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
      // Ctrl+Y — the Windows redo, and muscle memory for plenty of Mac users too.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (canRedo) redo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave every other combo to the OS
      // Escape mirrors clicking empty canvas: put the tool down, close what's open.
      if (e.key === "Escape") { dismissOverlays(); return; }
      // 1–4 switch the Select tool's mode (Face / Edge / Corner / Point) while it's on.
      if (selectMode && ["1", "2", "3", "4"].includes(e.key)) {
        const k = (["face", "edge", "vertex", "point"] as SelectKind[])[Number(e.key) - 1];
        setSelectKind(k);
        if (k === "point") setSelectedFeature(null); else { setActivePinId(null); setPinText(""); }
        return;
      }
      // Single-key tools, like every 3D app. Each toggles, and the setters below
      // already enforce one-tool-at-a-time.
      switch (e.key.toLowerCase()) {
        case "v": toggleSelectTool(); break;
        case "g": toggleTransformTool(); break;
        case "m": toggleMeasureTool(); break;
        case "b": setPaintMode(!paintMode); break;
        case "f": viewer.current?.resetView(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, canRedo, hIdx, navBusy, project, selectMode, transformMode, paintMode, paintSteps]);

  /** A sync cycle adopted or deleted projects that changed on ANOTHER device. Most
      of the time the merged copies just sit in the store (the Library re-lists on
      open) — but the OPEN project deserves words, and the missing-mesh case loads
      the bytes that just arrived instead of leaving the red explainer up. */
  function onRemoteProjects(adopted: string[], deleted: string[]) {
    setLibTick((t) => t + 1);
    const open = projectRef.current?.id;
    if (open && deleted.includes(open)) {
      setAuthNotice("Heads up — this project was deleted on another device. It's still open here; any new change saves it again.");
    } else if (open && adopted.includes(open)) {
      if (!geometryRef.current) {
        void getProject(open).then((fresh) => {
          if (fresh && (fresh.glb || fresh.importFile)) {
            setProject(fresh);
            void rebuildHead(fresh).catch(() => {});
          }
        });
      } else {
        setAuthNotice("This project changed on another device — reopen it from the Library to load the latest.");
      }
    }
  }

  async function openProjectById(p: Project) {
    setShowLibrary(false);
    setGeometry(null); // clear first so the newly-opened project gets framed (not left at the old camera)
    setProject(p);
    setMessages((p.chat ?? []).map((c) => ({ id: mid(), role: c.role, text: c.text, error: c.error, image: c.image })));
    setPins(p.pins ?? []);
    setPlateOf(p.plates?.of ?? {});
    setPlateCount(p.plates?.count ?? 1);
    setPlateNames(p.plates?.names ?? {});
    setPartColors(p.partColors ?? {});
    setFacePaint(p.facePaint?.b64 ? b64ToU8(p.facePaint.b64) : null); // Viewer discards it if the triangle count no longer matches
    clearPaintHistory();
    setPaintModeState(false);
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
    } catch (err: any) {
      // The mesh may have reached the account since this device last pulled (a full
      // pull otherwise only runs at launch) — try once on demand before reporting.
      if (accountEmailRef.current) {
        const pulled = await cloudSyncPull().catch(() => null);
        if (pulled?.meshes) {
          const fresh = await getProject(p.id);
          if (fresh && (fresh.glb || fresh.importFile)) {
            setProject(fresh);
            try {
              await rebuildHead(fresh);
              return;
            } catch { /* fall through to the message below */ }
          }
        }
      }
      // Say WHY the viewer is empty (mesh missing on this device, kernel error…) —
      // a silently blank canvas read as "the app can't open my project" (Mac audit).
      setMessages((m) => [...m, { id: mid(), role: "assistant", text: String(err?.message ?? err), error: true }]);
    } finally {
      // Prompt sync: if the account doesn't hold this project's mesh yet, the next
      // push uploads it now — not whenever the 45 s interval happens to fire.
      scheduleSync();
    }
  }

  function startNew() {
    localStorage.removeItem("moldable_last_project");
    projectRef.current = null;
    setPins([]);
    setPlateOf({});
    setPlateCount(1);
    setPlateNames({});
    setPartColors({});
    setFacePaint(null);
    clearPaintHistory();
    setPaintModeState(false);
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

  /** The wordmark goes home. It used to fire startNew — the same thing the "+ New chat"
      button beside it already does — which left the Launchpad reachable only by reloading
      the page. Nothing is discarded here: the open part stays in memory and in the store,
      and is put back on the Launchpad as the resume chip and the first recent, so the trip
      is round. */
  function goHome() {
    const pr = projectRef.current;
    if (pr) setResume({ id: pr.id, name: pr.name });
    void loadRecent();
    setBeenHome(true);
    setEntered(false);
  }

  const activeKind = result?.kind ?? (mode === "generative" ? "generative" : sel?.kind ?? "primitive");

  if (!entered) {
    // The launchpad is a lit stage — the print animation, the wordmark, the one big
    // question all read as intended on dark. It defaults there regardless of the
    // device, and only an explicit choice (the toggle) overrides it.
    return (
      <>
      <Launchpad
        model={model}
        theme={theme}
        onToggleTheme={() => setThemePrefState(theme === "dark" ? "light" : "dark")}
        onContinue={saveKey}
        onExample={loadExample}
        onAllTemplates={() => { setEntered(true); setShowTemplates(true); }}
        onTemplate={(t) => void loadTemplate(t)}
        onGuided={() => { setEntered(true); startGuided(); }}
        onSkip={() => setEntered(true)}
        resume={resume}
        onResume={() => { setEntered(true); void resumeLast(); }}
        recent={recent}
        onOpenRecent={(id) => { void getProject(id).then((pr) => { if (pr) { setEntered(true); void openProjectById(pr); } }); }}
        onAllProjects={() => { setEntered(true); setShowLibrary(true); }}
        accountEmail={accountEmail}
        cloudOffline={cloudOffline}
        onSignIn={() => setShowSignInModal(true)}
        onFirstInput={maybePromptSignIn}
        onFree={enterFree}
        // A launchpad ask always routes: the front door has no engine switch, so a pref
        // pinned in some earlier session must not silently steer this build. Auto is
        // re-assertable in one tap from the workspace seg once inside.
        onSubmit={(text, engine) => {
          pickMode(engine);
          setEntered(true);
          // A chosen engine is an instruction; only Auto routes (and the paid-mesh
          // confirm still guards anything that bills).
          void send(text, engine === "auto" ? undefined : engine, engine === "auto" ? { routeAuto: true } : undefined);
        }}
        imageUrl={image && !image.markup ? image.url : null}
        refsCount={refs.length}
        onPickFiles={pickImages}
        onClearImage={clearImage}
        webMode={webMode}
        onCycleWeb={cycleWeb}
        photoAdvice={imageAdvice({ provider: llm.provider, mesh: modePref === "generative" })}
        animateIn={!beenHome}
      />
      {showSignInModal && !accountEmail && <SignInModal cloudOffline={cloudOffline} onClose={() => setShowSignInModal(false)} />}
      </>
    );
  }

  return (
    <>
      <Workspace
        projectName={project?.name ?? "Untitled part"}
        onRename={renameProject}
        activeKind={activeKind}
        genLabel={genEng.provider === "auto" ? "Auto — best engine" : getProvider(genEng.provider)?.label ?? genEng.provider}
        fellBack={sel?.fellBack ?? false}
        ollamaOffer={
          ollamaInfo?.models.length && llm.provider !== "ollama" && !ollamaDismissed
            ? {
                count: ollamaInfo.models.length,
                // Prefer a code-capable local model for CAD generation; else the first.
                model: (ollamaInfo.models.find((m) => /coder|qwen|deepseek|codestral/i.test(m.name)) ?? ollamaInfo.models[0]).name,
                onUse: (m: string) => { useOllama(m); },
                onDismiss: () => {
                  setOllamaDismissed(true);
                  try { localStorage.setItem("moldable_ollama_dismissed", "1"); } catch { /* private mode */ }
                },
              }
            : null
        }
        bootError={sel?.bootError}
        authNotice={authNotice}
        onDismissAuthNotice={() => setAuthNotice(null)}
        providerWall={providerWall}
        onWallDismiss={() => setProviderWall(null)}
        onWallAddKey={() => setShowSettings(true)}
        onWallRetry={() => { const t = providerWall; setProviderWall(null); if (t) void send(t); }}
        onWallMesh={() => { const t = providerWall; setProviderWall(null); setMode("generative"); if (t) void send(t, "generative"); }}
        booting={booting || (!sel && mode === "precise")}
        genProgress={genProgress}
        accountEmail={accountEmail}
        theme={theme}
        onToggleTheme={() => setThemeState((t) => (t === "dark" ? "light" : "dark"))}
        onOpenProfile={() => {
          // Signed out, the avatar's job is getting signed IN — the popup, not a
          // settings pane. Signed in, "Account & sync" still opens the full pane.
          if (!accountEmailRef.current) {
            setShowSignInModal(true);
            return;
          }
          setSettingsPane("sync");
          setShowSettings(true);
        }}
        onComposerFocus={maybePromptSignIn}
        onSignOut={() => {
          void cloudSignOut().finally(() => {
            setAccountEmail(null);
            setCloudOffline(false);
            pulledRef.current = false;
            setMessages((mm) => [...mm, { id: mid(), role: "assistant", text: "Signed out. This device keeps its own copy; sign in anywhere to sync again." }]);
          });
        }}
        mode={mode}
        modePref={modePref}
        pickMode={pickMode}
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
        onPickImages={pickImages}
        refsCount={refs.length}
        photoAdvice={imageAdvice({ provider: llm.provider, mesh: mode === "generative" })}
        onMarkup={attachMarkup}
        onClearImage={clearImage}
        aiPreview={{
          active: !!pending,
          hasDiff: !!pending?.diff,
          apply: applyPending,
          discard: () => discardPending(),
          retry: retryPending,
          mode: aiApply,
          setMode: setAiApply,
        }}
        aiDiff={pending?.diff ?? null}
        paramPeek={paramPeek}
        onPeekParam={peekParam}
        onPeekParamEnd={endParamPeek}
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
        magnetCtl={{
          tool: magnetTool,
          canUse: activeKind === "replicad",
          sizes: MAGNET_SIZES,
          toggle: toggleMagnetTool,
          patch: (patch) => setMagnetTool((t) => (t ? { ...t, ...patch } : t)),
          place: (spot) => void placeMagnet(spot),
          pocket: magnetTool ? magnetPocket(magnetTool.size, magnetTool.fit) : null,
          edit: holeEdit?.family === "magnet" ? { moving: holeEdit.moving } : null,
          editApply: (next) => void editMagnetApply(next),
          editMove: () => setHoleEdit((h) => (h ? { ...h, moving: !h.moving } : h)),
          editDelete: () => void deleteEditedHole(),
          editDone: () => setHoleEdit(null),
          removeAll: () => void removeAllHoles("magnet"),
          placedCount: familyOpCount("magnet"),
        }}
        screwCtl={{
          tool: screwTool,
          canUse: activeKind === "replicad",
          sizes: SCREW_SIZES,
          toggle: toggleScrewTool,
          patch: (patch) => setScrewTool((t) => (t ? { ...t, ...patch } : t)),
          place: (spot) => void placeScrew(spot),
          cut: screwTool ? screwCut(screwTool.size, screwTool.fit, screwTool.countersink) : null,
          edit: holeEdit?.family === "screw" ? { moving: holeEdit.moving } : null,
          editApply: (next) => void editScrewApply(next),
          editMove: () => setHoleEdit((h) => (h ? { ...h, moving: !h.moving } : h)),
          editDelete: () => void deleteEditedHole(),
          editDone: () => setHoleEdit(null),
          removeAll: () => void removeAllHoles("screw"),
          placedCount: familyOpCount("screw"),
        }}
        views={{ left: views.left?.url, back: views.back?.url, right: views.right?.url }}
        onPickView={pickView}
        onClearView={clearView}
        multiViewEngine={usesMultiView(genEng.provider, genEng.model)}
        onMeasure={() => setShowMeasure(true)}
        messages={messages}
        status={status}
        input={input}
        setInput={onInputChange}
        onSend={send}
        improveCtl={{
          busy: improving,
          can: !!input.trim() || !!image,
          run: () => void improveInput(),
          before: improveBefore,
          undo: () => { if (improveBefore !== null) { setInput(improveBefore); setImproveBefore(null); } },
          note: improveNote,
          dismissNote: () => setImproveNote(null),
        }}
        clarifyCtl={{ answer: answerClarify, build: buildFromClarify }}
        confirmCtl={{ choose: confirmChoose, offer: offerChoose }}
        planCtl={{ on: planOn, setOn: setPlan, choose: planChoose }}
        onDeleteMessage={(id) => setMessages((m) => m.filter((x) => x.id !== id))}
        onDeleteMessages={(ids) => { const kill = new Set(ids); setMessages((m) => m.filter((x) => !kill.has(x.id))); }}
        onRetryModel={retryWithModel}
        onExample={loadExample}
        onTemplate={(t) => void loadTemplate(t)}
        onOpenTemplates={() => setShowTemplates(true)}
        resume={project ? null : resume?.name ?? null}
        onResume={() => void resumeLast()}
        geometry={geometry}
        dims={dims}
        report={report}
        analysisOverlay={analysisOverlay}
        pockets={pocketReport}
        printPrep={{
          overhangOn: overhangView,
          toggleOverhang: () => { setOverhangView((v) => !v); setThinShow(false); },
          thin: { report: thinReport, busy: thinBusy, run: runThinWalls, shown: thinShow, toggleShown: () => setThinShow((v) => !v) },
          orient: { suggestion: orientSug, run: runOrientSuggest, apply: () => void applyOrientation(), auto: () => void autoOrientDrop(), face: (n) => void snapFaceToPlate(n) },
          chamfer: {
            can: activeKind === "replicad" && result?.source.kind === "code",
            done: result?.source.kind === "code" && (result.source.ops ?? []).some((op) => op.type === "chamferBottom"),
            apply: (size) => void applyChamferBottom(size),
          },
        }}
        modelSelected={(modelSelected || transformMode !== "off") && !attachSelected}
        onModelSelect={selectModel}
        onScaleTo={scaleToDim}
        attachments={attachments}
        selAttachIds={selAttachIds}
        onAttachSelect={selectAttach}
        onMergeAttachments={(ids?: string[]) => { void mergeAttachments(ids); }}
        onEngraveAttachments={(ids: string[]) => { void engraveAttachments(ids); }}
        onAddLogo={(f: File) => { void addLogoFile(f); }}
        onRemoveAttachment={removeAttachment}
        partCount={partCount}
        separated={separated}
        separatedIds={separatedRef.current?.ids ?? []}
        separatedKind={separated ? separatedRef.current?.result.kind ?? null : null}
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
          exportEach: busyExport(exportPlates),
          exportProject: busyExport(exportPlatesProject),
        }}
        activePlate={activePlate}
        setActivePlate={setActivePlate}
        showcase={showcase}
        setShowcase={setShowcase}
        appearance={appearance}
        setAppearance={setAppearance}
        partColors={partColors}
        setPartColor={setPartColor}
        paintCtl={{
          mode: paintMode,
          setMode: setPaintMode,
          tool: paintTool,
          setTool: setPaintTool,
          mirror: paintMirror,
          setMirror: setPaintMirror,
          // Eyedropper result: adopt the picked filament and hand back to the bucket.
          pickSlot: (slot: number) => { setPaintSlot(slot); setPaintTool("fill"); },
          slot: paintSlot,
          setSlot: setPaintSlot,
          angle: paintAngle,
          setAngle: setPaintAngle,
          brushSize,
          setBrushSize,
          palette: FILAMENT_SWATCHES,
          facePaint,
          onStroke: onPaintStroke,
          onEraseAll: () => viewer.current?.eraseFacePaint(),
          hasPaint: !!facePaint,
        }}
        texture={grayView ? null : result?.texture ?? null}
        gray={grayView}
        setGray={setGrayView}
        showPlate={showPlate}
        setShowPlate={setShowPlate}
        plateColor={plateColor}
        gridOpacity={gridOpacity}
        modelBadge={modelBadge}
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
        onEmptyTap={dismissOverlays}
        tab={tab}
        setTab={setTab}
        codeText={codeBuffer}
        streamingText={streamingText}
        streamingThink={streamingThink}
        onRerun={rerun}
        cadDefaults={cadDefaults}
        paramValues={paramValues}
        onApplyParams={applyParams}
        onLiveParams={(v) => void applyParamsLive(v)}
        onSaveParams={saveParamsVersion}
        onOpenSlicer={busyExport(openSlicer)}
        onRepair={repairMesh}
        onSimplify={simplifyMesh}
        onSplit={splitMesh}
        onFitToPlate={() => void fitModelToPlate()}
        splitCtl={{ pieces: splitPieces, exportPiece: busyExport(exportPiece), exportAll: busyExport(exportAllPieces), clear: () => setSplitPieces(null), toPlates: assignPiecePlates, plated: !!splitPieces?.some((pc) => pc.plate != null) }}
        versions={project?.versions ?? []}
        onRestore={restoreTo}
        undoCtl={{ undo, redo, canUndo, canRedo, busy: navBusy || status === "generating" }}
        supportsStep={result?.supportsStep ?? false}
        canExport={(f) => (result?.kind === "generative" ? f === "stl" || f === "obj" || f === "3mf" /* = GenerativeEngine.canExport, inlined so the render path never loads the lazy engine */ : sel?.engine.canExport(f) ?? false)}
        onExport={busyExport(exportAs)}
        exportName={exportName}
        onExportName={setExportName}
        exportDefaultName={project?.name ?? "model"}
        exporting={exporting}
        onOpenSettings={() => { setSettingsPane("ai"); setShowSettings(true); }}
        onOpenLibrary={() => setShowLibrary(true)}
        onNew={startNew}
        onHome={goHome}
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
          toggleMode: toggleSelectTool,
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
          setMode: (m) => { setTransformMode(m); setModelSelected(m !== "off"); if (m !== "off") { setSelectMode(false); setMeasureMode(false); setPaintModeState(false); setActivePinId(null); setPinText(""); setSelectedFeature(null); setSelectedFaces([]); } },
          commit: authorObjectOp,
          rotateBy: (axis, deg) => {
            const a: [number, number, number] = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
            void rotateOntoPlate(a, deg, `Rotated ${deg}° about ${axis.toUpperCase()}`);
          },
          busy: status === "generating",
        }}
        resizeCtl={{
          dims,
          bed: printer.bed,
          perAxis: result?.kind === "generative", // CAD ops are uniform-only
          fits: report?.bedFit.fitsRotated ?? true,
          busy: status === "generating",
          resize: (s) => void resizeModel(s),
          fitToPlate: () => void fitModelToPlate(),
        }}
        genTexCtl={{ on: genTexture === "on", toggle: toggleGenTexture }}
        cutCtl={{
          mode: cutMode,
          toggle: () => setCutMode(!cutMode),
          pending: !!pendingCut,
          onStroke: setPendingCut,
          stroke: pendingCut,
          apply: () => void applyPenCut(),
          clear: () => setPendingCut(null),
          busy: status === "generating",
          connectors: connectorsOn,
          setConnectors,
          pinSize,
          setPinSize: setPin,
        }}
        dimCtl={{ drivers: dimDrivers, apply: (d, measured, target) => void applyTypedDim(d, measured, target) }}
        measureCtl={{
          mode: measureMode,
          toggle: toggleMeasureTool,
          pending: measurePending,
          items: measurements,
          draft: draftMeasure,
          saveDraft: saveDraftMeasure,
          discardDraft: () => setDraftMeasure(null),
          point: onMeasurePoint,
          segment: onMeasureSegment,
          remove: onMeasureDelete, // draft-aware: deleting the draft's label discards it

          clear: () => { setMeasurements([]); setMeasurePending(null); setDraftMeasure(null); },
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
          genTexture={genTexture}
          onToggleGenTexture={toggleGenTexture}
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
          clarifyOn={clarifyOn}
          onSetClarify={setClarify}
          units={units}
          onSaveUnits={(u) => setUnits(() => u)}
          dimsMode={dimsMode}
          onSaveDimsMode={setDimsMode}
          plateColor={plateColor}
          onPlateColor={setPlateColor}
          gridOpacity={gridOpacity}
          onGridOpacity={setGridOpacity}
          lastSyncAt={lastSyncAt}
          onSynced={markSynced}
          accountEmail={accountEmail}
          cloudOffline={cloudOffline}
          onAccountChange={(em, off) => {
            setAccountEmail(em);
            setCloudOffline(off);
            if (em && !off) void pullOnSignIn();
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLibrary && <LibraryModal onOpen={openProjectById} onClose={() => setShowLibrary(false)} currentId={project?.id} refreshTick={libTick} onMutated={scheduleSync} />}
      {showSignInModal && !accountEmail && <SignInModal cloudOffline={cloudOffline} onClose={() => setShowSignInModal(false)} />}
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
        <Suspense fallback={null}>
          <ExtrudeModal
            svgText={svgDraft.text}
            svgUrl={svgDraft.url}
            name={svgDraft.name}
            hasModel={!!geometry}
            initialMode={geometry ? "attach" : "extrude"}
            onCreate={createFromSvg}
            onClose={() => { URL.revokeObjectURL(svgDraft.url); setSvgDraft(null); }}
          />
        </Suspense>
      )}
    </>
  );
}

/** Never show a bare "Failed to fetch" — but leave already-crafted messages alone. */
function friendlyNet(msg: string): string {
  // Safari says "Load failed", Chrome "Failed to fetch" — both are the SAME opaque
  // browser error for "the request didn't complete", which covers being offline, the
  // connection dropping mid-flight, and a blocker. Leading with "check your
  // ad-blocker" blamed the user for what is usually just a dropped connection, so
  // say what we actually know and put the likeliest cause first.
  if (!/^(typeerror:?\s*)?(failed to fetch|networkerror.*|load failed)\.?$/i.test(msg.trim())) return msg;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You're offline — reconnect and try again. (Templates, direct edits, measuring and export all work without a connection.)";
  }
  return "The request to the AI provider didn't get through — usually a dropped connection, so trying again often works. If it keeps failing, check any VPN or ad-blocker (allow the provider's domain for this site).";
}

/** "…, seen from the front-right and above" — orients a marked screenshot for the AI. */
function viewPhrase(v: { azimuthDeg: number; elevationDeg: number }): string {
  const az = ((v.azimuthDeg % 360) + 360) % 360;
  const names = ["front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left"];
  const horiz = names[Math.round(az / 45) % 8];
  const vert = v.elevationDeg > 55 ? ", nearly top-down" : v.elevationDeg > 25 ? " and above" : v.elevationDeg < -10 ? " and below" : "";
  return `, seen from the ${horiz}${vert}`;
}

/** data:… URL → Blob (a viewer snapshot becoming an image→3D input). */
function dataUrlToBlob(u: string): Blob {
  const comma = u.indexOf(",");
  const mime = /data:(.*?)[;,]/.exec(u)?.[1] || "image/png";
  const bin = atob(u.slice(comma + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
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

/* Ambient backdrop: the build plate, drawn the way a slicer draws it — orthographic,
   top-down, axis-aligned, graduated in real millimetres against the configured bed.
   No perspective: a horizon with rails converging on a centred vanishing point reads as
   radar or a coordinate axis, not as a plate, and no amount of tuning removes that.
   It is also the wrong world — the workspace already renders a real perspective plate,
   so the entry screen should point at that, not invent a second fake one.

   The plate is static; the machine is not. A nozzle prints the first layer of a part —
   outer wall, inner wall, then diagonal infill — leaving a bead behind it, then the bed
   clears and the next part starts. That is the machine this app drives, so it is the
   right thing to show. (It replaced a gantry sweep, which read as radar: a bar tracking
   across a grid is a scanner no matter what it reveals.)

   Cost is O(1) per frame regardless of path length: the bead is drawn ONCE onto an
   offscreen layer as the nozzle advances and composited thereafter, so a frame is two
   drawImage calls plus the nozzle dot — not a re-stroke of a few hundred segments. The
   plate is cached the same way. Capped at 30 fps. Nothing here is on the critical path
   for first paint; the canvas simply starts drawing once React mounts it. */

function LaunchBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0, w = 0, h = 0, dpr = 1;
    let view: IsoView | null = null;
    let bedBmp: HTMLCanvasElement | null = null;    // static bed, redrawn on resize/theme
    let partBmp: HTMLCanvasElement | null = null;   // printed layers, drawn incrementally
    let partCtx: CanvasRenderingContext2D | null = null;
    let box = { x: 0, y: 0, w: 0, h: 0 };           // the region a frame touches
    let fade = { from: 0, to: 0 };

    /* Resolve any CSS colour to sRGB by PAINTING it and reading the pixel back. Parsing the
       string does not work here: the theme's page colour is an oklch(), which neither
       getComputedStyle nor canvas fillStyle resolves — both hand it back verbatim, and a
       naive number-scrape reads the 160 degree hue as a blue channel. It painted the whole
       Benchy navy. Letting the browser rasterise it is the only reliable answer. */
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    const rgb = (c: string): [number, number, number] => {
      if (!pctx) return [73, 138, 111];
      pctx.fillStyle = "#000";
      pctx.fillStyle = c;                       // an unparseable value leaves it black
      pctx.fillRect(0, 0, 1, 1);
      const d = pctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    const tokens = () => {
      const cs = getComputedStyle(document.documentElement);
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      const accent = cs.getPropertyValue("--accent").trim() || "#498a6f";
      /* The body colour is the accent mixed toward the page, used at HIGH alpha — not the
         accent itself at low alpha. Stacking a translucent accent thirty times builds a
         muddy wash that reads as faded and flattens the form; one pre-mixed tint laid down
         near-opaque reads as a surface, which is what a printed part is. */
      const a = rgb(accent);
      const p = rgb(cs.getPropertyValue("--launch-bg-page").trim() || (dark ? "#111" : "#eef1ef"));
      const k = dark ? 0.44 : 0.30;
      const body = `rgb(${a.map((v, i) => Math.round(p[i] + (v - p[i]) * k)).join(",")})`;
      return {
        accent,
        body,
        subtle: cs.getPropertyValue("--subt").trim() || "#8b968f",
        ink: cs.getPropertyValue("--ink2").trim() || (dark ? "#e6ebe8" : "#26302b"),
        dark,
        grid: dark ? 0.07 : 0.13,
        gridMajor: dark ? 0.14 : 0.24,
        bezel: dark ? 0.22 : 0.36,
        bead: dark ? 0.94 : 0.97,
      };
    };

    /** Where the bed goes: to the RIGHT of the real text column, measured from the DOM,
     *  so the two never overlap at any width. Below ~420px of free space there is no
     *  room for a bed worth looking at and the backdrop sits out (the CSS drops to one
     *  centred column at the matching width). */
    const layout = (): boolean => {
      const col = document.querySelector(".launch-col") as HTMLElement | null;
      const rect = cv.getBoundingClientRect();
      const colRight = col ? col.getBoundingClientRect().right - rect.left : w * 0.46;
      const GAP = 28;
      const left = colRight + GAP;
      const avail = w - left - 16;
      if (avail < 420) { view = null; return false; }
      // Isometric spreads the bed to 2*COS30 = 1.73x its own width and 1*SIN30 = 0.5x
      // deep, and a tall part adds its height on top. Sizing by `avail` directly (as if
      // the projection were 1:1) overflowed the viewport by ~100px on a laptop.
      const bedW = Math.min(avail / 1.72, (h * 0.66) / 1.15, 470);
      view = { cx: left + avail / 2, cy: h * 0.52 + bedW * 0.18, w: bedW };
      fade = { from: Math.max(0, colRight - 40), to: colRight + GAP + bedW * 0.12 };
      // Everything a frame can touch: the bed's diamond plus headroom for the tallest part.
      const halfW = bedW * Math.cos(Math.PI / 6) + 30;
      const halfD = bedW * 0.5 + 40;
      box = { x: view.cx - halfW, y: view.cy - halfD - bedW * 0.75, w: halfW * 2, h: halfD * 2 + bedW * 0.75 };
      box.x = Math.max(0, box.x); box.y = Math.max(0, box.y);
      box.w = Math.min(w - box.x, box.w); box.h = Math.min(h - box.y, box.h);
      return true;
    };

    const newLayer = (): [HTMLCanvasElement, CanvasRenderingContext2D] | null => {
      const bmp = document.createElement("canvas");
      bmp.width = Math.max(1, Math.round(w * dpr));
      bmp.height = Math.max(1, Math.round(h * dpr));
      const g = bmp.getContext("2d");
      if (!g) return null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [bmp, g];
    };

    /** The bed: an isometric grid with a raised bezel. Static — cached and blitted. */
    const drawBed = () => {
      if (!view) return;
      const t = tokens();
      const made = newLayer();
      if (!made) return;
      const [bmp, g] = made;
      bedBmp = bmp;
      const V = view;
      const line = (a: [number, number], b: [number, number]) => {
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      };
      g.strokeStyle = t.accent;
      g.lineWidth = 1;
      const DIV = 16;
      for (let i = 0; i <= DIV; i++) {
        const u = i / DIV;
        g.globalAlpha = i % 4 === 0 ? t.gridMajor : t.grid;
        line(iso(V, u, 0, 0), iso(V, u, 1, 0));
        line(iso(V, 0, u, 0), iso(V, 1, u, 0));
      }
      // Bezel: the bed's outline plus a short skirt, so it reads as a plate with
      // thickness rather than a drawn grid floating in space.
      g.globalAlpha = t.bezel;
      g.lineWidth = 1.4;
      const c = [iso(V, 0, 0, 0), iso(V, 1, 0, 0), iso(V, 1, 1, 0), iso(V, 0, 1, 0)];
      g.beginPath();
      c.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath(); g.stroke();
      const skirt = V.w * 0.022;
      g.globalAlpha = t.bezel * 0.6;
      for (const p of [c[1], c[2], c[3]]) line(p as [number, number], [p[0], p[1] + skirt]);
      g.beginPath();
      g.moveTo(c[1][0], c[1][1] + skirt); g.lineTo(c[2][0], c[2][1] + skirt); g.lineTo(c[3][0], c[3][1] + skirt);
      g.stroke();
      g.globalAlpha = 1;
    };

    const applyMask = () => {
      if (fade.to <= fade.from) return;
      const g = ctx.createLinearGradient(fade.from, 0, fade.to, 0);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = g;
      ctx.fillRect(fade.from, 0, fade.to - fade.from, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    };

    let part = new Date().getDate() % SOLIDS.length;
    let drawnLayers = 0;   // layers already committed to partBmp

    /* Screen y of the current part's highest point. The HUD used to clear a constant
       fraction of the bed width, which is a guess about the tallest solid — and every time a
       part changed the guess went stale and the label ended up inside the model. Measuring
       the part costs one pass over its sections when the part changes, and is right for
       whatever gets added later. */
    let partTopY = 0;
    const measurePart = () => {
      if (!view) return;
      const { solid } = SOLIDS[part];
      let top = Infinity;
      for (const sec of solid.sections) {
        const z = sec.z * solid.height;
        for (const loop of sec.loops) {
          for (const [x, y] of loop) {
            const q = iso(view, x, y, z);
            if (q[1] < top) top = q[1];
          }
        }
      }
      partTopY = Number.isFinite(top) ? top : view.cy;
    };

    /* Clear the part bitmap, allocating one only if there isn't a usable one already.
       Allocating a fresh full-size canvas costs 65 ms at dpr 2 on a 1440 x 900 window
       (2880 x 1800 pixels), and this runs at EVERY part change — a guaranteed hitch every
       11.5 seconds, landing exactly on the transition. Clearing is a fraction of that. */
    const resetPart = () => {
      const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      if (!partBmp || !partCtx || partBmp.width !== pw || partBmp.height !== ph) {
        const made = newLayer();
        if (!made) return;
        [partBmp, partCtx] = made;
      } else {
        partCtx.clearRect(0, 0, w, h);
      }
      drawnLayers = 0;
      trace = null;
      letterTrace = null;
      measurePart();
    };

    /** Paint the whole of layer `L` onto `g`. Used for layers that are already finished;
     *  the one still being laid goes through paintLive, which traces it. */
    const paintLayer = (
      g: CanvasRenderingContext2D,
      solid: (typeof SOLIDS)[number]["solid"],
      L: number,
      t: ReturnType<typeof tokens>,
    ) => {
      if (!view) return;
      const f = solid.layers ? L / solid.layers : 1;
      const z = f * solid.height;
      const { loops, fill } = sliceAt(solid, f);
      if (!loops.length) return;
      const whole = loops.length;

      const path = (from: number, to: number) => {
        g.beginPath();
        for (let i = from; i < to; i++) {
          loops[i].forEach(([x, y], k) => {
            const q = iso(view!, x, y, z);
            k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
          });
          g.closePath();
        }
      };
      g.lineJoin = "round";
      g.lineCap = "round";
      const wallW = Math.max(1, view.w * 0.0052);
      const innerW = Math.max(0.75, view.w * 0.0024);
      /* Body: the tint, translucent at the base and firming up as the part rises, so the
         layer lines below still read through the lower half and the top half is a surface.
         Layers land in ascending z, so a higher one paints over the one below and the stack
         resolves into a solid form. */
      const solidTo = Math.min(whole, fill);
      if (solidTo > 0) {
        g.fillStyle = t.body;
        g.globalAlpha = 0.42 + 0.48 * f;
        // Every loop, even-odd: the hole loops PUNCH the fill instead of being drawn on
        // top of it, so a bore shows the plate through — a cutout, not an engraving.
        // (fromLayers computes nesting parity, so even-odd is exactly right for meshes.)
        path(0, whole);
        g.fill("evenodd");
      }
      /* Outer wall solid, inner loops as the blueprint. A single stroke weight for both gave
         every line equal say, and on a busy part the interior detail then competed with the
         silhouette and the shape went with it. */
      g.strokeStyle = t.accent;
      if (solidTo > 0) {
        g.globalAlpha = 0.75 + 0.25 * f;
        g.lineWidth = wallW;
        path(0, solidTo);
        g.stroke();
      }
      if (whole > fill) {
        g.globalAlpha = 0.3 + 0.25 * f;
        g.lineWidth = innerW;
        path(fill, whole);
        g.stroke();
      }

      g.globalAlpha = 1;
    };

    /* The layer being laid, projected and measured ONCE and reused every frame after.
       The bead used to advance by whole VERTICES: a name tag's layer is a four-point
       rectangle, so the head moved in quarter-perimeter jumps and the line visibly lagged
       the dot. Measuring in SCREEN space (so the head travels at a constant apparent speed
       whatever the projection is doing) and interpolating inside a segment fixes both. */
    let trace: {
      part: number; layer: number; fill: number;
      pts: [number, number][][]; cum: number[][]; ends: number[]; total: number;
    } | null = null;

    const traceFor = (solid: (typeof SOLIDS)[number]["solid"], L: number) => {
      if (trace && trace.part === part && trace.layer === L) return trace;
      const f = solid.layers ? L / solid.layers : 1;
      const z = f * solid.height;
      const { loops, fill } = sliceAt(solid, f);
      const pts: [number, number][][] = [], cum: number[][] = [], ends: number[] = [];
      let total = 0;
      for (const loop of loops) {
        const q = loop.map(([x, y]) => iso(view!, x, y, z));
        const c = [0];
        for (let i = 1; i <= q.length; i++) {
          const a = q[i - 1], b = q[i % q.length];
          c.push(c[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        total += c[q.length];
        pts.push(q); cum.push(c); ends.push(total);
      }
      trace = { part: part, layer: L, fill, pts, cum, ends, total };
      return trace;
    };

    /** Lay down `frac` of layer `L` onto `g`, returning the exact position of the head. */
    const paintLive = (
      g: CanvasRenderingContext2D,
      solid: (typeof SOLIDS)[number]["solid"],
      L: number,
      frac: number,
      t: ReturnType<typeof tokens>,
    ): [number, number] | null => {
      if (!view) return null;
      const tr = traceFor(solid, L);
      if (!tr.pts.length || !(tr.total > 0)) return null;
      const f = solid.layers ? L / solid.layers : 1;
      const dist = Math.max(0, Math.min(1, frac)) * tr.total;

      let whole = 0;
      while (whole < tr.ends.length && tr.ends[whole] <= dist) whole++;

      const path = (from: number, to: number) => {
        g.beginPath();
        for (let i = from; i < to; i++) {
          const q = tr.pts[i];
          for (let k = 0; k < q.length; k++) (k ? g.lineTo(q[k][0], q[k][1]) : g.moveTo(q[k][0], q[k][1]));
          g.closePath();
        }
      };
      g.lineJoin = "round";
      g.lineCap = "round";
      const wallW = Math.max(1, view.w * 0.0052), innerW = Math.max(0.75, view.w * 0.0024);
      const solidTo = Math.min(whole, tr.fill);
      if (solidTo > 0) {
        g.fillStyle = t.body;
        g.globalAlpha = 0.42 + 0.48 * f;
        // Completed loops only, even-odd — a hole the bead has finished tracing starts
        // punching immediately; one still being traced stays a line until it closes.
        path(0, whole);
        g.fill("evenodd");
      }
      g.strokeStyle = t.accent;
      if (solidTo > 0) {
        g.globalAlpha = 0.75 + 0.25 * f;
        g.lineWidth = wallW;
        path(0, solidTo);
        g.stroke();
      }
      if (whole > tr.fill) {
        g.globalAlpha = 0.3 + 0.25 * f;
        g.lineWidth = innerW;
        path(tr.fill, whole);
        g.stroke();
      }

      let head: [number, number] | null = whole > 0 ? tr.pts[whole - 1][0] : null;
      if (whole < tr.pts.length) {
        const q = tr.pts[whole], c = tr.cum[whole];
        const along = dist - (whole ? tr.ends[whole - 1] : 0);
        let seg = 0;
        while (seg + 1 < c.length && c[seg + 1] < along) seg++;
        const span = c[seg + 1] - c[seg];
        const u = span > 1e-6 ? (along - c[seg]) / span : 0;
        const a = q[seg], b = q[(seg + 1) % q.length];
        head = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        g.globalAlpha = whole < tr.fill ? 0.75 + 0.25 * f : 0.3 + 0.25 * f;
        g.lineWidth = whole < tr.fill ? wallW : innerW;
        g.beginPath();
        g.moveTo(q[0][0], q[0][1]);
        for (let k = 1; k <= seg; k++) g.lineTo(q[k][0], q[k][1]);
        g.lineTo(head[0], head[1]);       // ends exactly under the nozzle, never behind it
        g.stroke();                       // open on purpose: this bead is still being laid
      }
      g.globalAlpha = 1;
      return head;
    };

    /* The raised lettering ("JERRY" on the name tag), traced by the SAME nozzle that
       laid the part — it used to just appear once the part topped out, which broke the
       fiction that everything on the bed was printed. Projected once per part. */
    let letterTrace: { part: number; pts: [number, number][][]; cum: number[][]; ends: number[]; total: number } | null = null;
    const letterTraceFor = () => {
      const { solid } = SOLIDS[part];
      if (!solid.topLoops || !view) return null;
      if (letterTrace && letterTrace.part === part) return letterTrace;
      const pts: [number, number][][] = [], cum: number[][] = [], ends: number[] = [];
      let total = 0;
      for (const loop of solid.topLoops) {
        const q = loop.map(([x, y]) => iso(view!, x, y, solid.height));
        const c = [0];
        for (let i = 1; i <= q.length; i++) {
          const a = q[i - 1], b = q[i % q.length];
          c.push(c[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        total += c[q.length];
        pts.push(q); cum.push(c); ends.push(total);
      }
      letterTrace = { part, pts, cum, ends, total };
      return letterTrace;
    };

    /** Lay down `frac` of the lettering; returns the nozzle-head position. */
    const paintLetters = (g: CanvasRenderingContext2D, frac: number, t: ReturnType<typeof tokens>): [number, number] | null => {
      const tr = letterTraceFor();
      if (!tr || !(tr.total > 0) || !view) return null;
      const dist = Math.max(0, Math.min(1, frac)) * tr.total;
      let whole = 0;
      while (whole < tr.ends.length && tr.ends[whole] <= dist) whole++;
      g.strokeStyle = t.accent;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.lineWidth = Math.max(0.9, view.w * 0.004);
      g.globalAlpha = 1;
      if (whole > 0) {
        g.beginPath();
        for (let i = 0; i < whole; i++) {
          tr.pts[i].forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.closePath();
        }
        g.stroke();
      }
      let head: [number, number] | null = whole > 0 ? tr.pts[whole - 1][0] : null;
      if (whole < tr.pts.length) {
        const q = tr.pts[whole], c = tr.cum[whole];
        const along = dist - (whole ? tr.ends[whole - 1] : 0);
        let seg = 0;
        while (seg + 1 < c.length && c[seg + 1] < along) seg++;
        const span = c[seg + 1] - c[seg];
        const u = span > 1e-6 ? (along - c[seg]) / span : 0;
        const a = q[seg], b = q[(seg + 1) % q.length];
        head = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        g.beginPath();
        g.moveTo(q[0][0], q[0][1]);
        for (let k = 1; k <= seg; k++) g.lineTo(q[k][0], q[k][1]);
        g.lineTo(head[0], head[1]);
        g.stroke();
      }
      g.globalAlpha = 1;
      return head;
    };

    /** Commit every COMPLETED layer up to `upto` onto the cached bitmap. Only new layers are
     *  painted, so a frame is O(layers added this frame) — normally one, often zero —
     *  rather than O(all layers so far). The layer in progress is not committed: it is
     *  repainted live each frame until it finishes. */
    const commitTo = (upto: number, t: ReturnType<typeof tokens>) => {
      const g = partCtx;
      if (!g || !view) return;
      const { solid } = SOLIDS[part];
      for (let L = drawnLayers; L <= upto && L <= solid.layers; L++) paintLayer(g, solid, L, t);
      drawnLayers = Math.max(drawnLayers, Math.min(upto + 1, solid.layers + 1));
    };

    /** Raised lettering, drawn once the part is topped out. */
    const drawTopLoops = (g: CanvasRenderingContext2D) => {
      const { solid } = SOLIDS[part];
      if (!solid.topLoops || !view) return;
      const t = tokens();
      g.lineWidth = Math.max(0.9, view.w * 0.004);
      g.beginPath();
      for (const loop of solid.topLoops) {
        loop.forEach(([x, y], i) => {
          const q = iso(view!, x, y, solid.height);
          i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
        });
        g.closePath();
      }
      /* The tag's top face is now a solid slab, so accent letters on it are invisible —
         drawing them in the same ink as the thing they sit on. Clear the bars out of the
         slab first, put back a lighter tint, then outline: the letters read as raised and
         catching light, which is what they are. */
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 1;
      g.fill();
      g.globalCompositeOperation = "source-over";
      g.fillStyle = t.accent;
      g.globalAlpha = 0.1;
      g.fill();
      g.strokeStyle = t.accent;
      g.globalAlpha = 1;
      g.stroke();
    };

    const PRINT = 8200;   // laying the part up
    const ENGRAVE = 1600; // the nozzle traces any raised lettering (skipped when none)
    const HOLD = 2400;    // finished part on the bed
    const CLEAR = 900;    // bed clears
    const CYCLE = PRINT + ENGRAVE + HOLD + CLEAR;
    let t0 = 0, lastPaint = 0, cycleIx = 0, toppedOut = false;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!t0) t0 = now;
      if (now - lastPaint < 33) return;    // 30 fps: ample, and halves the cost
      lastPaint = now;
      if (!view || !bedBmp) return;

      const elapsed = now - t0;
      const ix = Math.floor(elapsed / CYCLE);
      if (ix !== cycleIx) {
        cycleIx = ix;
        part = (part + 1) % SOLIDS.length;
        toppedOut = false;
        resetPart();
      }
      if (!partBmp) resetPart();

      const p = elapsed % CYCLE;
      const { solid, name } = SOLIDS[part];
      const printing = p < PRINT;
      const engraving = !printing && !!solid.topLoops && p < PRINT + ENGRAVE;
      // Ease-out so the first layers land briskly and the top settles — a linear stack
      // reads as a progress bar.
      const prog = printing ? 1 - Math.pow(1 - p / PRINT, 1.6) : 1;
      const exact = prog * solid.layers;
      const upto = Math.floor(exact);
      // Completed layers only. The one in progress is repainted live below, partially, so
      // it looks laid down rather than switched on.
      const t = tokens();
      commitTo(printing ? upto - 1 : solid.layers, t);
      // Lettering commits only after the nozzle has finished tracing it.
      if (!printing && !engraving && !toppedOut && partCtx) { drawTopLoops(partCtx); toppedOut = true; }
      const fadeA = p < PRINT + ENGRAVE + HOLD ? 1 : 1 - (p - PRINT - ENGRAVE - HOLD) / CLEAR;

      const blit = (src: HTMLCanvasElement) =>
        ctx.drawImage(src, box.x * dpr, box.y * dpr, box.w * dpr, box.h * dpr, box.x, box.y, box.w, box.h);
      ctx.clearRect(box.x, box.y, box.w, box.h);
      blit(bedBmp);
      if (partBmp) { ctx.globalAlpha = fadeA * t.bead; blit(partBmp); ctx.globalAlpha = 1; }

      if (printing) {
        // The layer in progress, laid down loop by loop, with the nozzle at the head of the
        // bead. This is the only thing moving once a layer is down, and it is what makes the
        // stack read as PRINTING rather than fading in.
        const head = paintLive(ctx, solid, upto, exact - upto, t);
        if (head) {
          const r = Math.max(1.8, view.w * 0.009);
          ctx.fillStyle = t.accent;
          ctx.globalAlpha = 0.95;
          ctx.beginPath(); ctx.arc(head[0], head[1], r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.16;
          ctx.beginPath(); ctx.arc(head[0], head[1], r * 2.6, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (engraving) {
        // The nozzle stays on the job: it traces the name/lettering bead by bead.
        const et = Math.min(1, (p - PRINT) / ENGRAVE);
        const head = paintLetters(ctx, 1 - Math.pow(1 - et, 1.5), t);
        if (head) {
          const r = Math.max(1.8, view.w * 0.009);
          ctx.fillStyle = t.accent;
          ctx.globalAlpha = 0.95;
          ctx.beginPath(); ctx.arc(head[0], head[1], r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.16;
          ctx.beginPath(); ctx.arc(head[0], head[1], r * 2.6, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Printer HUD, in the bed's own top-left corner.
      {
        const pct = Math.round((printing ? p / PRINT : 1) * 100);
        const anchor = iso(view, 0, 0, 0);
        const y = Math.min(anchor[1] - view.w * 0.12, partTopY - 16);
        // The name is the point of the whole animation — it says what is being drawn.
        // At 11px in the palette's faintest grey it was unreadable at arm's length, so
        // the name carries the ink weight and the telemetry trails it, quieter.
        const detail = printing
          ? ` · layer ${Math.min(upto + 1, solid.layers)}/${solid.layers} · ${pct}%`
          : engraving ? " · lettering" : " · done";
        ctx.textBaseline = "bottom";
        ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
        const nameW = ctx.measureText(name).width;
        ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
        const detailW = ctx.measureText(detail).width;
        const startX = view.cx - (nameW + detailW) / 2;
        ctx.textAlign = "left";
        ctx.globalAlpha = (t.dark ? 0.92 : 0.86) * fadeA;
        ctx.fillStyle = t.ink;
        ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(name, startX, y);
        ctx.globalAlpha = (t.dark ? 0.66 : 0.7) * fadeA;
        ctx.fillStyle = t.subtle;
        ctx.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(detail, startX + nameW, y);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = 1;
      }
      applyMask();
    };

    /** Reduced motion: the finished part, no nozzle, no loop. */
    const drawStill = () => {
      if (!view || !bedBmp) return;
      resetPart();
      commitTo(SOLIDS[part].solid.layers, tokens());
      if (partCtx) drawTopLoops(partCtx);
      const blit = (src: HTMLCanvasElement) =>
        ctx.drawImage(src, box.x * dpr, box.y * dpr, box.w * dpr, box.h * dpr, box.x, box.y, box.w, box.h);
      ctx.clearRect(box.x, box.y, box.w, box.h);
      blit(bedBmp);
      if (partBmp) { ctx.globalAlpha = tokens().bead; blit(partBmp); ctx.globalAlpha = 1; }
      applyMask();
    };

    const render = () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
      if (!layout()) { bedBmp = null; partBmp = null; return; }
      drawBed();
      resetPart();
      toppedOut = false;
      if (still) { drawStill(); return; }
      t0 = 0; lastPaint = 0; cycleIx = 0;
      raf = requestAnimationFrame(frame);
    };

    let rt: ReturnType<typeof setTimeout>;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    };
    const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 150); };
    resize();
    window.addEventListener("resize", onResize);
    const obs = new MutationObserver(() => render());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { cancelAnimationFrame(raf); clearTimeout(rt); window.removeEventListener("resize", onResize); obs.disconnect(); };
  }, []);
  return <canvas className="launch-bg" ref={ref} aria-hidden="true" />;
}

/* The Launchpad. Replaces the KeyCard gate, which was a full-screen stop with eight
   competing actions and no way to make anything. The primary element is a composer
   that submits straight into the existing send(); sign-in is a link, not a wall. */
function Launchpad({ model, theme, onToggleTheme, onContinue, onExample, onAllTemplates, onTemplate, onGuided, onSkip, onFree, onSubmit, resume, onResume, recent, onOpenRecent, onAllProjects, accountEmail, cloudOffline = false, onSignIn, onFirstInput, imageUrl, refsCount, onPickFiles, onClearImage, webMode, onCycleWeb, photoAdvice, animateIn = true }: {
  model: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onContinue: (k: string, m: string) => void;
  onExample: () => void;
  onAllTemplates: () => void;
  onTemplate: (t: Template) => void;
  onGuided: () => void;
  onSkip: () => void;
  onFree: () => void;
  onSubmit: (text: string, engine: ModePref) => void;
  imageUrl: string | null;
  refsCount: number;
  onPickFiles: (fs: File[]) => void;
  onClearImage: () => void;
  webMode: "auto" | "on" | "off";
  onCycleWeb: () => void;
  photoAdvice: string;
  resume?: { id: string; name: string } | null;
  onResume?: () => void;
  recent?: { id: string; name: string; engine: string; thumb?: string }[];
  onOpenRecent?: (id: string) => void;
  onAllProjects?: () => void;
  accountEmail?: string | null;
  cloudOffline?: boolean;
  onSignIn: () => void;
  onFirstInput?: () => void;
  animateIn?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [k, setK] = useState("");
  const [m, setM] = useState(model);
  /** Past the first-run tour: signed in, or enough projects behind them that the
      teaching scaffolding is just furniture between them and the composer. */
  const veteran = !!accountEmail || (recent?.length ?? 0) >= 2;

  const [dragOver, setDragOver] = useState(false);
  // What kind of thing is being built — asked UP FRONT, because the two engines have
  // very different bills: CAD parts build free with the user's AI key, mesh engines
  // charge per generation. Auto still routes for people who don't care.
  const [engine, setEngine] = useState<ModePref>("auto");
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const text = draft.trim();
    if (!text && !imageUrl) return; // a photo alone is a valid ask ("recreate this")
    onSubmit(text, engine); // straight into send() — never re-typed into the workspace composer
  };

  return (
    <div className="launchpad">
      <LaunchBackdrop />
      <header className="launch-top">
        <div className="brand">
          <CubeMark />
          <span className="wordmark">Moldable</span>
          {/* Same build number the workspace shows. It lives up here rather than in the
              footer because the footer's two halves fit its 620px by one pixel — adding a
              tag there wrapped the actions onto a second line and pushed the page 41px
              past a 768-tall laptop. Beside the wordmark it costs no layout at all. */}
          <span
            className="build-tag"
            title="Deployed build number — it goes up with every update, so a bigger number after a refresh means the update landed."
          >
            v{__BUILD_STAMP__}
          </span>
        </div>
        <div className="launch-top-right">
          <button className="ghost sm" aria-label="Toggle dark mode" title="Toggle dark mode" onClick={onToggleTheme}>{theme === "dark" ? <IconSun /> : <IconMoon />}</button>
          {accountEmail
            ? <span className="launch-account" title={cloudOffline ? `Signed in as ${accountEmail} — the sync service isn't reachable from this network right now; changes stay on this device until it is` : `Signed in as ${accountEmail}`}>Signed in · {accountEmail}{cloudOffline ? " · offline" : ""}</span>
            : <button className="ghost sm" onClick={onSignIn}>Sign in</button>}
        </div>
      </header>

      <main className="launch-main">
       {/* 420 ms staggered fade-up on every load — it used to be gated to once per tab,
           which meant a reload dropped you onto a dead screen with no sense of entry.
           Coming BACK from the workspace is not an entrance, so it skips the stagger and
           the screen is simply there. */}
       <div className={`launch-col${animateIn ? " play" : ""}`}>
        <h1 className="launch-h1">What do you want to make?</h1>
        <p className="launch-sub">Describe a part in plain language. Real millimetres, checked against your printer, exported as the files your slicer wants.</p>

        <form
          className={`launch-composer${dragOver ? " drop" : ""}`}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const fs = Array.from(e.dataTransfer.files).filter((x) => x.type.startsWith("image/") || /\.(svg|glb|gltf|stl|step|stp|shapr)$/i.test(x.name));
            if (fs.length) onPickFiles(fs);
          }}
        >
          {imageUrl && (
            <div className="launch-imgchip">
              <img src={imageUrl} alt="reference" />
              <span>
                {refsCount > 0 ? `${refsCount + 1} reference pictures` : "reference picture"}
                {/* The advice is most actionable right here — while re-shooting is
                    still one tap away. */}
                <em className="imgchip-advice">{photoAdvice}</em>
              </span>
              <button type="button" aria-label="Remove reference pictures" onClick={onClearImage}><IconX /></button>
            </div>
          )}
          <textarea
            autoFocus
            rows={1}
            value={draft}
            onChange={(e) => {
              // The very first character someone types is the "they're really using
              // this" moment — the one-time sign-in nudge hangs off it (App decides
              // whether it fires; autoFocus makes a focus trigger fire at page load).
              if (!draft && e.target.value) onFirstInput?.();
              setDraft(e.target.value);
              // Grow with the text up to the CSS max-height; the scrollbar exists only
              // beyond that. Without this the box was fixed-height with overflow:auto,
              // so a gutter appeared while the box still looked mostly empty.
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
              el.style.overflowY = el.scrollHeight > 260 ? "auto" : "hidden";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="A wall bracket for a 32 mm pipe, 4 mm wall, two M4 holes 40 mm apart…"
          />
          <div className="launch-composer-foot">
            {/* Attaches, like every chat app's clip — drop and paste land in the same
                place. The GUIDED photo flow keeps its own door ("Fix a broken part"). */}
            <button type="button" className="launch-attach" title={photoAdvice} onClick={() => fileRef.current?.click()}>
              <IconPaperclip /> Photos &amp; sketches
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.svg,.glb,.gltf,.stl,.step,.stp,.shapr"
              multiple
              hidden
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                if (fs.length) onPickFiles(fs);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className={`web-toggle web-${webMode}`}
              onClick={onCycleWeb}
              aria-label={`Look things up online: ${webMode}`}
              title="Web search for real dimensions (and product photos) before building — Auto: looks up named real-world products · On: always research · Off: never. Click to cycle."
            >
              <IconGlobe size={13} />
              <span className="web-state">{webMode === "auto" ? "Research · auto" : webMode === "on" ? "Research · on" : "Research · off"}</span>
            </button>
          </div>
          <button type="submit" className="send" aria-label="Build it" disabled={!draft.trim() && !imageUrl}><IconArrowUp /></button>
        </form>
        {/* Below the card, not inside it: the composer's foot row is absolutely
            positioned, and anything in flow down there lands on top of it. */}
        <div className="launch-engines" role="radiogroup" aria-label="How to build it">
          {([
            ["auto", "Auto", "The app reads your request and picks the right engine — it tells you before anything paid runs."],
            ["precise", "Functional part", "Exact millimetres, editable dimensions, STEP export — built free with your AI key."],
            ["generative", "Sculpted model", "Organic, high-detail mesh from a paid 3D engine — typically $0.10–$0.40 per generation."],
          ] as const).map(([v, label, hint]) => (
            <button key={v} type="button" role="radio" aria-checked={engine === v} className={`lp-eng${engine === v ? " on" : ""}`} title={hint} onClick={() => setEngine(v)}>{label}</button>
          ))}
          <span className="lp-eng-hint">
            {engine === "auto" ? "picks per request · asks before anything paid runs"
              : engine === "precise" ? "exact mm · free with your AI key"
              : "organic detail · paid engine, ~$0.10–0.40 per run"}
          </span>
        </div>

        {/* Your own work outranks the samples, so it sits above them. Shown whenever
            projects EXIST rather than only when signed in — they are stored locally
            either way, and hiding a signed-out user's own parts would be a lie.
            The old standalone "Continue where you left off" pill duplicated the first
            recent card — the card itself now carries the continue treatment instead. */}
        {!!recent?.length && (
          <section className="launch-sect">
            <p className="launch-label">Recent projects</p>
            <div className="launch-recents">
              {recent.map((r, i) => {
                const cont = !!resume && (resume.id === r.id || (i === 0 && !recent.some((x) => x.id === resume.id)));
                return (
                  <button key={r.id} className={`launch-recent${cont ? " continue" : ""}`} onClick={() => (cont ? onResume?.() : onOpenRecent?.(r.id))} title={cont ? `Continue ${r.name}` : `Open ${r.name}`}>
                    <span className="lr-thumb">
                      {r.thumb ? <img src={r.thumb} alt="" aria-hidden="true" /> : <IconCube />}
                    </span>
                    <span className="lr-meta">
                      <b>{r.name}</b>
                      <em>{cont ? "Continue where you left off" : r.engine === "replicad" ? "Precise CAD" : r.engine === "generative" ? "AI mesh" : "Part"}</em>
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Both doors out of "my work" in one row under the grid. "All projects"
                used to float in the section label and the empty-workspace link was
                stranded on its own down the page — two related actions, two unrelated
                places. Tab-styled because that is what they are: sideways moves. */}
            <div className="launch-tabs">
              <button className="launch-tab" onClick={onAllProjects}>All projects</button>
              <button className="launch-tab" onClick={onSkip}>Open an empty workspace</button>
            </div>
          </section>
        )}

        {/* Templates and the guided-repair door are ONBOARDING: they teach a first-time
            visitor what the app can do. Someone signed in — or with a few projects
            behind them — already knows, and for them this is the crowding Jerry marked
            up. Both live one click inside the workspace (Templates in the topbar, the
            guided card in the empty chat), so hiding them here costs nothing. */}
        {!veteran && (
        <section className="launch-sect">
          <div className="launch-label-row">
            <p className="launch-label">Start from a template</p>
            <button className="launch-more" onClick={onAllTemplates}>All {TEMPLATES.length}</button>
          </div>
          <div className="launch-chips">
            {TEMPLATES.filter((t) => t.kind === "cad").slice(0, 4).map((t) => (
              <button key={t.id} className="launch-chip" onClick={() => onTemplate(t)}>
                {templateThumb(t.id) && <img src={templateThumb(t.id)} alt="" aria-hidden="true" />}
                {t.name}
              </button>
            ))}
          </div>
          <button className="launch-guided" onClick={onGuided}>
            Fix a broken part: photo in, replacement out <span className="gc-go">→</span>
          </button>
        </section>
        )}

        {/* Sign-in itself lives in the SignInModal popup now (one dialog serves every
            entry point). What stays inline are the non-account extras that used to
            hide behind the Sign in toggle — collapsed, so the page stays calm. */}
        {!accountEmail && (
        <div className="launch-signin">
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
        <button className="link" onClick={onExample}>Or view the built-in example model</button>
        </div>
        )}

        {/* The footer is first-run framing: the AI-sizes caveat, the local-storage
            pitch and the free-mode offer all answer "should I trust this?", which a
            returning user settled long ago — and their navigation now lives in the
            tab row under their projects, so for them the footer goes entirely. */}
        {!veteran && (
        <footer className="launch-foot">
          {!veteran && (
            <span>
              Sizes are AI-generated — check the fit before a long print.
              {/* Signed in, the rest restated the account chip in the header — nothing
                  actionable. Signed out it is a real offer, so that half stays. */}
              {!accountEmail && (
                <>{" "}Runs in your browser; designs and keys stay on this device.{" "}
                  <button className="link" onClick={onSignIn}>Sign in to sync</button></>
              )}
            </span>
          )}
          <span className="launch-actions">
            <button className="launch-free" onClick={onFree}>Start free in generative mode</button>
            {/* A visible link only — deliberately not bound to Escape, so there is one Escape contract. */}
            <button className="link" onClick={onSkip}>Skip</button>
          </span>
        </footer>
        )}
        {/* A veteran with no projects yet still needs the door. */}
        {veteran && !recent?.length && (
          <div className="launch-tabs">
            <button className="launch-tab" onClick={onAllProjects}>All projects</button>
            <button className="launch-tab" onClick={onSkip}>Open an empty workspace</button>
          </div>
        )}
       </div>
      </main>
    </div>
  );
}

/** The sign-in POPUP. Sign-in used to be an inline section at the bottom of the
    launchpad — easy to scroll past, and on a blocked network its explanation only
    appeared AFTER a failed provider click. One dialog now serves every entry point
    (the Sign in button, the footer link, the first character typed by a signed-out
    user, the workspace avatar), and it probes whether the sync service is even
    reachable the moment it opens — so "your network blocks supabase.co" is the
    first thing on screen, not the aftermath of a dead OAuth hop. */
function SignInModal({ cloudOffline, onClose }: { cloudOffline: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);
  const [reach, setReach] = useState<boolean | null>(null); // null = still probing
  const probe = () => {
    setReach(null);
    void cloudReachable().then(setReach).catch(() => setReach(false));
  };
  useEffect(probe, []);
  const blocked = reach === false || cloudOffline;

  async function auth(op: "github" | "google" | "magic" | "signup" | "signin" | "reset") {
    setBusy(true);
    setErr(false);
    setMsg(
      op === "magic" ? "Sending your login link…"
      : op === "reset" ? "Sending your reset link…"
      : op === "signup" ? "Creating your account…"
      : op === "signin" ? "Signing in…"
      : `Taking you to ${op === "github" ? "GitHub" : "Google"}…`,
    );
    try {
      if (op === "magic") setMsg(await cloudMagicLink(email.trim()));
      else if (op === "reset") setMsg(await cloudResetPassword(email.trim()));
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
    <div className="overlay" onClick={onClose}>
      <div className="card signin-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Save &amp; sync your work</h2>
          <button className="x" aria-label="Close" onClick={onClose}><IconX size={16} /></button>
        </div>
        <p className="fine">One free account keeps your projects, chats and keys on every device — encrypted in your browser before anything uploads. Skip it and everything still saves on this device.</p>
        {blocked && (
          <div className="sync-status err" role="status">
            Before you pick a provider: this network can't reach the sync service (supabase.co looks blocked — a DNS filter, VPN, or browser shields are the usual culprits), so sign-in can't complete from here. Try another network, or set this device's DNS to 1.1.1.1, then{" "}
            <button className="link" onClick={probe}>check again</button>.
          </div>
        )}
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
            <button className="link" disabled={busy || !email.includes("@")} onClick={() => auth("reset")}>Forgot password?</button>
          </div>
        </details>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Not now — keep it on this device</button>
        </div>
      </div>
    </div>
  );
}

/** One visually-bounded settings group: a title, an optional one-line hint, then its
    controls — the "categorize, don't overwhelm" building block of the Settings modal. */
/** The beta cost meter's face: device-local totals, the formula that produced them,
 *  and (with an OpenRouter key) the key's account-level usage straight from OpenRouter. */
function SpendMeter({ orKey }: { orKey?: string }) {
  const [l, setL] = useState(loadLedger);
  const [orLine, setOrLine] = useState("");
  useEffect(() => {
    if (!orKey) return;
    fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${orKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: any) => {
        const d = j?.data;
        if (d?.usage != null) setOrLine(`OpenRouter account: $${Number(d.usage).toFixed(2)} used${d.limit != null ? ` of a $${Number(d.limit).toFixed(2)} limit` : ""} on this key (every app, not just Moldable).`);
      })
      .catch(() => { /* offline or key without introspection — the local meter stands alone */ });
  }, [orKey]);
  const avg = l.builds ? l.usd / l.builds : 0;
  return (
    <>
      <div className="dock-row"><span className="dock-k">Since {l.since}</span><span className="dock-v">{fmtUSD(l.usd, false)}</span></div>
      <div className="dock-row"><span className="dock-k">Builds</span><span className="dock-v">{l.builds} · avg {fmtUSD(avg, false)}</span></div>
      <div className="dock-row"><span className="dock-k">All calls</span><span className="dock-v">{l.calls} · {fmtTok(l.inTok)} in / {fmtTok(l.outTok)} out</span></div>
      {orLine && <p className="fine choice-hint">{orLine}</p>}
      <p className="fine choice-hint">
        cost = tokens ÷ 1M × the model's $/Mtok (in and out priced separately). Figures come from the
        provider's own usage report when it sends one — OpenRouter even reports the exact dollar cost —
        otherwise ≈ estimates: tokens ≈ characters ÷ 4, plus ~1,600 input tokens per attached photo.
        A build = routing + optional research + the generation and its retries; all of it lands here.
        Device-local, your keys, not billing.
      </p>
      <button className="ghost sm" onClick={() => { resetLedger(); setL(loadLedger()); }}>Reset meter</button>
    </>
  );
}

/** Detected local Ollama models as one-tap picks for the model field. */
function OllamaModelChips({ onPick }: { onPick: (m: string) => void }) {
  const [info, setInfo] = useState<OllamaInfo | null | undefined>(undefined);
  useEffect(() => { void detectOllama().then((r) => setInfo(r)); }, []);
  if (info === undefined) return null;
  if (!info || !info.models.length) {
    return <p className="fine choice-hint">No local Ollama found at localhost:11434. Install from ollama.com, `ollama pull` a model, and it appears here. On the hosted site, also set OLLAMA_ORIGINS to allow this page.</p>;
  }
  return (
    <div className="launch-chips" style={{ marginTop: 6 }}>
      {info.models.map((m) => (
        <button key={m.name} type="button" className="launch-chip" title={m.sizeGB ? `${m.sizeGB.toFixed(1)} GB on disk` : undefined} onClick={() => onPick(m.name)}>
          {m.name}{m.sizeGB ? ` · ${m.sizeGB.toFixed(1)} GB` : ""}
        </button>
      ))}
    </div>
  );
}

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
  genTexture,
  onToggleGenTexture,
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
  plateColor,
  onPlateColor,
  gridOpacity,
  onGridOpacity,
  lastSyncAt,
  onSynced,
  accountEmail,
  cloudOffline,
  onAccountChange,
  clarifyOn,
  onSetClarify,
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
  genTexture: "on" | "off";
  onToggleGenTexture: () => void;
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
  plateColor: string | null;
  onPlateColor: (v: string | null) => void;
  gridOpacity: number;
  onGridOpacity: (v: number) => void;
  lastSyncAt: number | null;
  onSynced: () => void;
  accountEmail: string | null;
  cloudOffline: boolean;
  onAccountChange: (email: string | null, offline: boolean) => void;
  clarifyOn: boolean;
  onSetClarify: (v: boolean) => void;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<SettingsPane>(initialPane ?? "ai");
  const [passphrase, setPassphrase] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  // Cloud account (email + password; sync payloads are client-side encrypted).
  // Signed-in state lives in App (accountEmail/cloudOffline props) — one source of
  // truth for the modal, the launchpad chip and the sync loops alike.
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const cloudEmail = accountEmail;
  const [cloudBusy, setCloudBusy] = useState(false);
  const [syncErr, setSyncErr] = useState(false);
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
  async function doCloud(op: "signup" | "signin" | "signout" | "sync" | "github" | "google" | "magic" | "setpw" | "reset") {
    setCloudBusy(true);
    setSyncErr(false);
    setSyncMsg(
      op === "signup" ? "Creating your account…"
      : op === "signin" ? "Signing in…"
      : op === "github" || op === "google" ? `Taking you to ${op === "github" ? "GitHub" : "Google"}…`
      : op === "magic" ? "Sending your login link…"
      : op === "reset" ? "Sending your reset link…"
      : op === "setpw" ? "Setting your password…"
      : op === "sync" ? "Syncing…"
      : "",
    );
    try {
      if (op === "github" || op === "google") await cloudOAuth(op); // navigates away on success
      if (op === "magic") setSyncMsg(await cloudMagicLink(email.trim()));
      if (op === "reset") setSyncMsg(await cloudResetPassword(email.trim()));
      if (op === "setpw") { setSyncMsg(await cloudSetPassword(pw)); setPw(""); }
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
        const pushed = await cloudSyncPush();
        if (!pushed) throw new Error("Still can't reach the sync service — your changes are safe on this device and upload the moment the connection returns.");
        const r = await cloudSyncPull();
        onSynced();
        setSyncMsg("Synced.");
        if (r && (r.settings > 0 || r.projects > 0)) setTimeout(() => window.location.reload(), 600);
      }
      const s = await cloudSessionState();
      onAccountChange(s.email, s.offline);
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
  // Cost & balance: month-to-date estimates from the local ledger, plus a live
  // credit check for the engines that expose one (Meshy, Tripo).
  const spend = useMemo(() => spendSummary(), []);
  const [balMsg, setBalMsg] = useState("");
  const [balBusy, setBalBusy] = useState(false);
  const checkBalance = async () => {
    setBalBusy(true);
    setBalMsg("Checking…");
    const bal = await providerBalance(gp, keys[gp] ?? "", proxy || (import.meta.env.DEV ? "" : DEFAULT_RELAY));
    setBalMsg(bal ? `${prov.label.split(" (")[0]} balance: ${bal}` : `Couldn't read the balance — check the key, or see ${BALANCE_DASHBOARDS[gp] ?? "the provider's dashboard"}.`);
    setBalBusy(false);
  };

  // Printer
  const [bed, setBed] = useState(printer.bed);
  const [oh, setOh] = useState(printer.overhangThresholdDeg);
  const [nozzle, setNozzle] = useState(printer.nozzleMM);
  const [fitCal, setFitCalState] = useState<number | null>(() => fitCalibration());
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
    onSavePrinter({ bed, overhangThresholdDeg: oh, nozzleMM: nozzle, name: preset === "custom" ? undefined : preset });
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
                {/* Any colour at all — the presets are a starting point, not the menu.
                    The swatch IS the picker (a colour input styled as the dot), so it
                    reads as one more choice in the row rather than a settings sub-page. */}
                <label
                  className={`tint-swatch tint-custom${BUBBLE_TINTS.some((t) => t.color.toLowerCase() === userTint.toLowerCase()) ? "" : " on"}`}
                  style={{ ["--sw" as string]: userTint }}
                  title="Pick any colour for your own chat bubbles"
                >
                  <span className="tint-dot" />
                  Custom
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(userTint) ? userTint : "#498a6f"}
                    aria-label="Custom chat bubble colour"
                    onChange={(e) => onSaveTint(e.target.value)}
                  />
                </label>
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
              <label>Build plate colour</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={plateColor ?? "#363c42"} onChange={(e) => onPlateColor(e.target.value)} style={{ width: 44, height: 28, padding: 2 }} aria-label="Build plate colour" />
                {plateColor && <button className="ghost sm" onClick={() => onPlateColor(null)}>Reset to default</button>}
              </div>
              <label>Grid line opacity — {Math.round(gridOpacity * 100)}%</label>
              <input type="range" min={0.15} max={1} step={0.05} value={gridOpacity} onChange={(e) => onGridOpacity(parseFloat(e.target.value))} aria-label="Grid line opacity" />
            </SGroup>
          </>
        )}

        {pane === "ai" && (
          <>
            <p className="pane-desc">The brain that writes your CAD code in <b>Precise</b> mode.</p>
            <SGroup title="Before building" hint="What happens between your description and the model">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={clarifyOn} onChange={(e) => onSetClarify(e.target.checked)} style={{ width: "auto" }} />
                Ask me for missing details when a new request is vague
              </label>
              <p className="fine choice-hint">
                On (default): a request the app would otherwise have to guess at raises a short set of questions in the chat — each one already carrying a
                suggested answer, so <b>Build it</b> is always one tap away and you are only correcting what you care about. Off: every request builds
                immediately from the app's own assumptions. Either way, the ✨ button beside the composer rewrites a description on demand.
              </p>
            </SGroup>
            <SGroup title="Spend" hint="Beta cost meter — this device, your keys">
              <SpendMeter orKey={llmKeys["openrouter"] || undefined} />
            </SGroup>
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
            {lp === "ollama" && <OllamaModelChips onPick={(m) => setLmodel(m)} />}
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
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={genTexture === "on"} onChange={onToggleGenTexture} style={{ width: "auto" }} />
              Bake color textures onto generated meshes
            </label>
            <p className="fine choice-hint">
              Off (default) = a clean gray, geometry-only mesh — what your single-filament print will actually look like, and the cheaper call on every paid
              engine (Hunyuan's texture pass costs about 3× the plain mesh; Tripo and Meshy bill texturing as an add-on). Turn on for full-color previews or
              multi-color printing. The free Hugging Face engines and Rodin always texture.
            </p>
            </SGroup>
            <SGroup title="Cost & balance" hint="know the price before you press send">
              <p className="fine">
                Selected: <b>{prov.label.split(" (")[0]}</b> — <b>{costLabel(gp, gm) || "price not published"}</b>
                {(costUsd(gp, gm) ?? 0) > 0 ? " per generated model" : ""}. The same price tag appears in chat before every run.
              </p>
              <p className="fine">
                This device, this month: <b>${spend.monthUsd.toFixed(2)}</b> across {spend.monthCount} paid run{spend.monthCount === 1 ? "" : "s"}
                {Object.keys(spend.byProvider).length
                  ? ` — ${Object.entries(spend.byProvider).map(([id, b]) => `${getProvider(id)?.label.split(" (")[0] ?? id} $${b.usd.toFixed(2)} (${b.count})`).join(" · ")}`
                  : ""}. Free runs cost $0 and aren't counted. Estimates use list prices — the provider's own dashboard is the bill of record.
              </p>
              {BALANCE_CAPABLE.has(gp) ? (
                <>
                  <button className="ghost sm" disabled={balBusy || !(keys[gp] ?? "").trim()} onClick={() => void checkBalance()}>
                    {(keys[gp] ?? "").trim() ? `Check my ${prov.label.split(" (")[0]} balance` : "Add your key below to check your balance"}
                  </button>
                  {balMsg && <p className="fine">{balMsg}</p>}
                </>
              ) : (
                <p className="fine">Balance lives on the provider's site: {BALANCE_DASHBOARDS[gp] ?? "see their dashboard"}.</p>
              )}
              <details className="adv guide">
                <summary>Price guide — every engine at a glance</summary>
                <ul className="guide-list">
                  {PROVIDERS.flatMap((pv) =>
                    pv.models.map((mm) => (
                      <li key={`${pv.id}|${mm.id}`}>
                        <b>{pv.label.split(" (")[0]} · {mm.label.split(" — ")[0]}</b> — {costLabel(pv.id, mm.id) || "price varies"}
                      </li>
                    )),
                  )}
                </ul>
              </details>
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
              <label>Nozzle diameter (mm)</label>
              <input type="number" min={0.1} max={2} step={0.05} value={nozzle} onChange={(e) => setNozzle(+e.target.value)} />
              <p className="fine">
                Sets the wall-thickness limit: two perimeters, so a {nozzle || 0.4} mm nozzle flags walls under{" "}
                <b>{Math.round((nozzle || 0.4) * 2 * 100) / 100} mm</b>. Most printers ship 0.4 mm.
              </p>
              <label>Overhang warning threshold (°)</label>
              <input type="number" value={oh} onChange={(e) => setOh(+e.target.value)} />
              <p className="fine">45° is the standard FDM rule of thumb; raise it for PLA, lower for ABS.</p>
            </SGroup>
            <SGroup title="Fit calibration">
              <label>Measured snug clearance (mm, per side)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                placeholder="0.20 (default)"
                value={fitCal ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Math.max(0, Math.min(1, +e.target.value));
                  setFitCalState(v);
                  saveFitCalibration(v);
                }}
              />
              <p className="fine">
                Every printer squishes differently — measure yours once: build the <b>Tolerance test coupon</b> from Templates, print it, and find the tightest hole the peg still fits into with a firm push. Count the notches above it: 0.05 mm for one notch, then +0.1 mm per extra notch. That is the gap per side.
              </p>
              <p className="fine">
                It sets more than the Loose/Snug/Press chip. The difference between your number and the 0.2 mm average is how far your machine drifts from the charts, so it also shifts <b>every hole the app drills</b> — screw clearance and pilot holes, heat-set insert pockets, magnet pockets, and the sockets on cut pieces — off the book figure and onto your printer. Receipts say when a size includes it.
              </p>
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
                {cloudOffline && (
                  <div className="sync-status err" role="status">
                    You're still signed in as <b>{cloudEmail}</b>, but this network can't reach the sync service right now (supabase.co looks blocked — a DNS filter, VPN or browser shields are the usual culprits). Everything keeps saving on this device and syncs itself the moment the connection returns.
                  </div>
                )}
                <p className="fine">Signed in as <b>{cloudEmail}</b> — {cloudOffline ? "changes wait on this device until the sync service is reachable." : "everything syncs automatically."}</p>
                <p className="fine sync-when">
                  {lastSyncAt
                    ? <>Last synced: <b>{new Date(lastSyncAt).toLocaleString()}</b></>
                    : "Not synced yet — it'll sync automatically after your next change."}
                </p>
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy} onClick={() => doCloud("sync")}>{cloudOffline ? "Retry connection" : "Sync now"}</button>
                  <button className="ghost sm" disabled={cloudBusy} onClick={() => doCloud("signout")}>Sign out</button>
                </div>
                <details className="adv">
                  <summary>Set a password (for the Mac / Windows app)</summary>
                  <p className="fine">Google, GitHub and login links all sign you in by returning to a web address. The desktop app isn't one, so it can't use them — give the account a password here and sign in with it there. You'll stay signed in.</p>
                  <label>New password</label>
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="at least 6 characters" />
                  <div className="param-actions">
                    <button className="primary sm" disabled={cloudBusy || pw.length < 6} onClick={() => doCloud("setpw")}>Set password</button>
                  </div>
                </details>
                <details className="adv">
                  <summary>What syncs, exactly?</summary>
                  <p className="fine">Projects (their code, versions, chats, thumbnails), plus your settings and keys — encrypted in your browser before upload, private to your account. 3D meshes and imported STEP files stay on each device (they're big; CAD models rebuild from their code). On another device, just sign in the same way.</p>
                </details>
              </>
            ) : (
              IS_DESKTOP ? (
              <>
                {/* Google/GitHub and login links all finish by redirecting to a web
                    address. This app isn't one, so they can never complete here —
                    offering them would just fail. Password sign-in needs no redirect. */}
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <label>Password</label>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="your password" />
                <div className="param-actions">
                  <button className="primary sm" disabled={cloudBusy || !email.includes("@") || pw.length < 6} onClick={() => doCloud("signin")}>Sign in</button>
                  <button className="ghost sm" disabled={cloudBusy || !email.includes("@") || pw.length < 6} onClick={() => doCloud("signup")}>Create account</button>
                  <button className="link" disabled={cloudBusy || !email.includes("@")} onClick={() => doCloud("reset")}>Forgot password?</button>
                </div>
                <p className="fine">Signed in on the web with Google or a login link? Those finish in a browser, so they can't complete in this app. Open Moldable on the web → Settings → Sync → <b>Set a password</b>, then use it here. You'll stay signed in after that.</p>
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
                    <button className="link" disabled={cloudBusy || !email.includes("@")} onClick={() => doCloud("reset")}>Forgot password?</button>
                  </div>
                </details>
              </>
              )
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
