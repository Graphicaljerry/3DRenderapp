import type { ProviderDef } from "./types";
import { hfGenerate } from "./providers/hf";
import { meshyGenerate } from "./providers/meshy";
import { tripoGenerate } from "./providers/tripo";
import { replicateGenerate } from "./providers/replicate";
import { falGenerate } from "./providers/fal";

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
        image: true, text: false, recommended: true,
        hint: "Fastest free result (~10 s). Great for checking the overall shape.",
      },
      {
        id: "tencent/Hunyuan3D-2",
        label: "Hunyuan3D-2 — image or text (higher quality, slower)",
        image: true, text: true,
        hint: "Best free quality, and the only free model that works from text alone. Slower — uses more of the day's free GPU minutes.",
      },
      {
        id: "trellis-community/TRELLIS",
        label: "TRELLIS — image (best geometry, ~1 free call/day)",
        image: true, text: false,
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
        image: true, text: false, recommended: true,
        hint: "The most accurate photo-to-3D in the app: finest detail, cleanest surfaces. $0.375 per model.",
      },
      {
        id: "fal-ai/hyper3d/rodin",
        label: "Rodin Gen-2 — image or text ($0.40)",
        image: true, text: true,
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
      { id: "image_to_model", label: "Tripo — image", image: true, text: false, recommended: true },
      { id: "text_to_model", label: "Tripo — text", image: false, text: true },
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
    models: [{ id: "meshy", label: "Meshy 6 — image or text", image: true, text: true, recommended: true }],
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
        image: true, text: false, recommended: true,
        hint: "Sharpest geometry per dollar — about 4¢ a run, no daily limit.",
      },
      { id: "tencent/hunyuan3d-2", label: "Hunyuan3D-2 — image", image: true, text: false },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Engines that actually consume extra reference angles (front/left/back/right). */
export function usesMultiView(providerId: string, modelId: string): boolean {
  if (providerId === "fal") return /hyper3d|rodin/.test(modelId); // Rodin takes an image array
  if (providerId === "tripo") return modelId === "image_to_model"; // -> multiview_to_model
  return false;
}
/** The engines to recommend when the user wants multi-view accuracy. */
export const MULTIVIEW_HINT = "fal · Rodin or Tripo";

export function providerOfModel(): ProviderDef {
  return PROVIDERS[0];
}
