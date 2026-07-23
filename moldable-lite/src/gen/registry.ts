import type { ProviderDef, GenFn } from "./types";

// The registry (labels, prices, model lists) renders in Settings and pickers, so
// it stays eager — but each provider's client code only loads when a generation
// actually runs on it. Same GenFn signature, one dynamic hop inside.
const hfGenerate: GenFn = (input, onProgress, signal) => import("./providers/hf").then((m) => m.hfGenerate(input, onProgress, signal));
const meshyGenerate: GenFn = (input, onProgress, signal) => import("./providers/meshy").then((m) => m.meshyGenerate(input, onProgress, signal));
const tripoGenerate: GenFn = (input, onProgress, signal) => import("./providers/tripo").then((m) => m.tripoGenerate(input, onProgress, signal));
const replicateGenerate: GenFn = (input, onProgress, signal) => import("./providers/replicate").then((m) => m.replicateGenerate(input, onProgress, signal));
const falGenerate: GenFn = (input, onProgress, signal) => import("./providers/fal").then((m) => m.falGenerate(input, onProgress, signal));

export const PROVIDERS: ProviderDef[] = [
  {
    id: "hf",
    label: "Hugging Face (free)",
    free: true,
    needsKey: false,
    recommended: true,
    hint: "Free (a daily allowance of shared GPU minutes). Start here — quick previews of an object's shape and structure.",
    keyHint: "free hf_… token from huggingface.co/settings/tokens — use a plain “Read” token (fine-grained tokens often lack free-GPU access). ~5× the anonymous quota + queue priority.",
    viaProxy: false,
    generate: hfGenerate,
    models: [
      {
        id: "stabilityai/stable-fast-3d",
        label: "Stable Fast 3D — image (fast & reliable)",
        image: true, text: false, recommended: true, usd: 0,
        hint: "Fastest free result (~10 s). Great for checking the overall shape.",
      },
      {
        id: "tencent/Hunyuan3D-2",
        label: "Hunyuan3D-2 — image or text (higher quality, slower)",
        image: true, text: true, usd: 0,
        hint: "Best free quality, and the only free model that works from text alone. Slower — uses more of the day's free GPU minutes.",
      },
      {
        id: "trellis-community/TRELLIS",
        label: "TRELLIS — image (best geometry, ~1 free call/day)",
        image: true, text: false, usd: 0,
        hint: "Sharpest free geometry, but so heavy you get roughly one free run per day.",
      },
    ],
  },
  {
    id: "fal",
    label: "fal (best accuracy, pay per use)",
    free: false,
    needsKey: true,
    hint: "The most accurate engines here — Hunyuan 3D v3.1 Pro ($0.375 per model) and Rodin ($0.40). Prepaid credit, no subscription.",
    keyHint: "key from fal.ai/dashboard/keys (prepaid credit — Hunyuan 3D v3.1 Pro costs $0.375 per model, Rodin $0.40). Works right here through the built-in relay.",
    viaProxy: true,
    generate: falGenerate,
    models: [
      {
        id: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
        label: "Hunyuan 3D v3.1 Pro — image ($0.375, best accuracy)",
        image: true, text: false, recommended: true, usd: 0.375,
        hint: "The most accurate photo-to-3D in the app: finest detail, cleanest surfaces. $0.375 per model.",
      },
      {
        id: "fal-ai/hyper3d/rodin",
        label: "Rodin Gen-2 — image or text ($0.40)",
        image: true, text: true, usd: 0.4,
        hint: "Production-grade meshes and the best paid text-to-3D. $0.40 per model.",
      },
    ],
  },
  {
    id: "tripo",
    label: "Tripo",
    free: false,
    needsKey: true,
    hint: "Sharp, printable meshes with fast turnaround. An image model costs about 20-30 prepaid credits; text about 10-20.",
    keyHint: "tsk_… key from platform.tripo3d.ai. Works here out of the box (built-in relay) — but note the API wallet is prepaid (an image→3D run is ~20-30 credits); Tripo's free monthly credits are Studio-only. Free route: generate in their Studio, download the .glb, drag it into Moldable.",
    viaProxy: true,
    generate: tripoGenerate,
    models: [
      { id: "image_to_model", label: "Tripo — image", image: true, text: false, recommended: true, usd: 0.25, credits: "~20-30 credits" },
      { id: "text_to_model", label: "Tripo — text", image: false, text: true, usd: 0.15, credits: "~10-20 credits" },
    ],
  },
  {
    id: "meshy",
    label: "Meshy",
    free: false,
    needsKey: true,
    hint: "Strong textures and stylised models. API needs a paid plan — $20/month includes 1,000 credits; a full model uses roughly 20-30.",
    keyHint: "msy_… (API needs a paid Meshy plan, from $20/month ≈ 1,000 credits)",
    viaProxy: true,
    generate: meshyGenerate,
    models: [{ id: "meshy", label: "Meshy 6 — image or text", image: true, text: true, recommended: true, usd: 0.5, credits: "~25 credits" }],
  },
  {
    id: "replicate",
    label: "Replicate",
    free: false,
    needsKey: true,
    hint: "Pay-per-run marketplace — TRELLIS for about 4¢ a model, the cheapest paid option.",
    keyHint: "r8_… token (prepaid credit; TRELLIS ≈ $0.04 per run)",
    viaProxy: true,
    generate: replicateGenerate,
    models: [
      {
        id: "firtoz/trellis",
        label: "TRELLIS — image (~$0.04)",
        image: true, text: false, recommended: true, usd: 0.04,
        hint: "Sharpest geometry per dollar — about 4¢ a run, no daily limit.",
      },
      { id: "tencent/hunyuan3d-2", label: "Hunyuan3D-2 — image", image: true, text: false, usd: 0.15 },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Estimated USD list price of one run (0 = free tier), or null when unknown. */
export function costUsd(providerId: string, modelId: string): number | null {
  const m = getProvider(providerId)?.models.find((mm) => mm.id === modelId);
  return m?.usd ?? null;
}

/** Short human price tag shown BEFORE a generation runs: "free (daily GPU minutes)",
 *  "≈ $0.04", "~25 credits · ≈ $0.50". Empty string when the price isn't known. */
export function costLabel(providerId: string, modelId: string): string {
  const prov = getProvider(providerId);
  const m = prov?.models.find((mm) => mm.id === modelId);
  if (!prov || !m) return "";
  if (m.usd === 0 || prov.free) return "free (daily GPU minutes)";
  if (m.usd == null) return "";
  const dollars = `≈ $${m.usd.toFixed((m.usd * 100) % 1 ? 3 : 2)}`;
  return m.credits ? `${m.credits} · ${dollars}` : dollars;
}

/** Engines that actually consume extra reference angles (front/left/back/right). */
export function usesMultiView(providerId: string, modelId: string): boolean {
  if (providerId === "fal") return /hyper3d|rodin/.test(modelId); // Rodin takes an image array
  if (providerId === "tripo") return modelId === "image_to_model"; // -> multiview_to_model
  return false;
}

/** "Auto" engine: pick the best mesh provider+model the user can actually run.
 *  Premium keyed providers beat the free tier (accuracy); within a provider the
 *  model must match the input (photo vs text). Quality/speed words in the prompt
 *  steer the free tier between its fast and its high-quality model. */
export function pickAutoGenEngine(opts: { hasImage: boolean; prompt: string; hasKey: (id: string) => boolean }): { provider: string; model: string; label: string; reason: string } {
  const wantsDetail = /\b(detailed|high.?quality|accurate|realistic|intricate|best)\b/i.test(opts.prompt);
  const wantsFast = /\b(quick|fast|draft|rough|simple)\b/i.test(opts.prompt);
  const order = ["fal", "tripo", "meshy", "replicate", "hf"];
  for (const id of order) {
    const prov = PROVIDERS.find((pp) => pp.id === id);
    if (!prov) continue;
    if (prov.needsKey && !opts.hasKey(prov.id)) continue;
    const fits = prov.models.filter((m) => (opts.hasImage ? m.image : m.text));
    if (!fits.length) continue;
    let model = fits.find((m) => m.recommended) ?? fits[0];
    if (prov.id === "hf" && opts.hasImage) {
      // Free tier: fast+reliable by default; step up for "detailed", stay light for "quick".
      if (wantsDetail && !wantsFast) model = fits.find((m) => /Hunyuan/i.test(m.id)) ?? model;
      if (wantsFast) model = fits.find((m) => /stable-fast/i.test(m.id)) ?? model;
    }
    const reason = prov.needsKey ? "your best keyed engine" : wantsDetail ? "free, high quality" : "free & reliable";
    return { provider: prov.id, model: model.id, label: model.label.split(" (")[0].split(" — ")[0], reason };
  }
  const hf = PROVIDERS[0];
  return { provider: hf.id, model: hf.models[0].id, label: hf.models[0].label, reason: "fallback" };
}
