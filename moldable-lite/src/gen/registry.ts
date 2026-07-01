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
    keyHint: "optional free hf_… token — lifts the daily quota + queue priority",
    viaProxy: false,
    generate: hfGenerate,
    models: [
      { id: "tencent/Hunyuan3D-2::/generation_all", label: "Hunyuan3D-2 — image or text", image: true, text: true },
      { id: "JeffreyXiang/TRELLIS::/image_to_3d", label: "TRELLIS — image (best geometry)", image: true, text: false },
    ],
  },
  {
    id: "tripo",
    label: "Tripo",
    free: false,
    needsKey: true,
    keyHint: "tsk_… from platform.tripo3d.ai (200 free credits/mo)",
    viaProxy: true,
    generate: tripoGenerate,
    models: [
      { id: "image_to_model", label: "Tripo — image", image: true, text: false },
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
    models: [{ id: "meshy", label: "Meshy 6 — image or text", image: true, text: true }],
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
      { id: "firtoz/trellis", label: "TRELLIS — image", image: true, text: false },
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
      { id: "fal-ai/hyper3d/rodin", label: "Rodin Gen-2 — image or text", image: true, text: true },
      { id: "fal-ai/hunyuan3d/v2", label: "Hunyuan3D v2 — image", image: true, text: false },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerOfModel(): ProviderDef {
  return PROVIDERS[0];
}
