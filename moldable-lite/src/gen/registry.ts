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
    hint: "Free. Start here — quick previews of an object's shape and structure.",
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
    hint: "The most accurate engines available here — Hunyuan 3D v3.1 Pro and Rodin. Prepaid credit, roughly $0.10 per model.",
    keyHint: "key from fal.ai/dashboard/keys (prepaid credit — Hunyuan 3D v3.1 Pro costs about $0.10 per model). Works right here through the built-in relay.",
    viaProxy: true,
    generate: falGenerate,
    models: [
      {
        id: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
        label: "Hunyuan 3D v3.1 Pro — image (best accuracy)",
        image: true, text: false, recommended: true,
        hint: "The most accurate photo-to-3D in the app: finest detail, cleanest surfaces. ~$0.10 per model.",
      },
      {
        id: "fal-ai/hunyuan-3d/v3.1/non-pro/image-to-3d",
        label: "Hunyuan 3D v3.1 — image (accurate, cheaper)",
        image: true, text: false,
        hint: "Same engine, standard quality tier — cheaper per run.",
      },
      {
        id: "fal-ai/hyper3d/rodin",
        label: "Rodin Gen-2 — image or text",
        image: true, text: true,
        hint: "Production-grade meshes and the best paid text-to-3D.",
      },
      {
        id: "fal-ai/hunyuan3d-v21",
        label: "Hunyuan3D 2.1 — image (older)",
        image: true, text: false,
        hint: "Previous generation — pick v3.1 instead unless you're comparing.",
      },
    ],
  },
  {
    id: "tripo",
    label: "Tripo",
    free: false,
    needsKey: true,
    hint: "Sharp, printable meshes with fast turnaround. API credits are prepaid.",
    keyHint: "tsk_… key from platform.tripo3d.ai. Works here out of the box (built-in relay) — but note the API wallet is prepaid; Tripo's free monthly credits are Studio-only. Free route: generate in their Studio, download the .glb, drag it into Moldable.",
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
    hint: "Strong textures and stylised models. The API needs a paid Meshy plan.",
    keyHint: "msy_… (API needs a paid Meshy plan)",
    viaProxy: true,
    generate: meshyGenerate,
    models: [{ id: "meshy", label: "Meshy 6 — image or text", image: true, text: true, recommended: true }],
  },
  {
    id: "replicate",
    label: "Replicate",
    free: false,
    needsKey: true,
    hint: "Pay-per-run marketplace — TRELLIS quality without the free daily limit.",
    keyHint: "r8_… token (prepaid credit)",
    viaProxy: true,
    generate: replicateGenerate,
    models: [
      { id: "firtoz/trellis", label: "TRELLIS — image", image: true, text: false, recommended: true },
      { id: "tencent/hunyuan3d-2", label: "Hunyuan3D-2 — image", image: true, text: false },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerOfModel(): ProviderDef {
  return PROVIDERS[0];
}
