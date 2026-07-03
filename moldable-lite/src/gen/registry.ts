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
    keyHint: "free hf_… token from huggingface.co/settings/tokens — use a plain “Read” token (fine-grained tokens often lack free-GPU access). ~5× the anonymous quota + queue priority.",
    viaProxy: false,
    generate: hfGenerate,
    models: [
      { id: "stabilityai/stable-fast-3d", label: "Stable Fast 3D — image (fast & reliable)", image: true, text: false, recommended: true },
      { id: "tencent/Hunyuan3D-2", label: "Hunyuan3D-2 — image or text (higher quality, slower)", image: true, text: true },
      { id: "trellis-community/TRELLIS", label: "TRELLIS — image (best geometry, ~1 free call/day)", image: true, text: false },
    ],
  },
  {
    id: "tripo",
    label: "Tripo",
    free: false,
    needsKey: true,
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
    keyHint: "r8_… token (prepaid credit)",
    viaProxy: true,
    generate: replicateGenerate,
    models: [
      { id: "firtoz/trellis", label: "TRELLIS — image", image: true, text: false, recommended: true },
      { id: "tencent/hunyuan3d-2", label: "Hunyuan3D-2 — image", image: true, text: false },
    ],
  },
  {
    id: "fal",
    label: "fal",
    free: false,
    needsKey: true,
    keyHint: "fal key from fal.ai",
    viaProxy: true,
    generate: falGenerate,
    models: [
      { id: "fal-ai/hyper3d/rodin", label: "Rodin Gen-2 — image or text", image: true, text: true, recommended: true },
      { id: "fal-ai/hunyuan3d-v21", label: "Hunyuan3D 2.1 — image", image: true, text: false },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerOfModel(): ProviderDef {
  return PROVIDERS[0];
}
