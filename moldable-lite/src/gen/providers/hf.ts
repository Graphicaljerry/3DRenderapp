import { Client, handle_file } from "@gradio/client";
import type { GenFn } from "../types";
import { fetchAsBlob, findUrlDeep } from "../util";

// model id = "<space>::<endpoint>", e.g. "tencent/Hunyuan3D-2::/generation_all"
export const hfGenerate: GenFn = async (input, onProgress) => {
  if (!input.image && !input.prompt) throw new Error("Provide an image or a prompt.");
  const [space, endpoint] = input.model.split("::");
  onProgress({ status: "connecting to Hugging Face…" });
  const app = await Client.connect(space, input.apiKey ? ({ hf_token: input.apiKey } as any) : {});
  onProgress({ status: "generating (Hugging Face, ~30–120s)…" });

  const payload: any[] = [];
  if (input.image) payload.push(handle_file(input.image));
  if (input.prompt) payload.push(input.prompt);

  let result: any;
  try {
    result = await app.predict(endpoint || "/generation_all", payload);
  } catch (e) {
    throw new Error(
      "Hugging Face Space call failed — its API shape may differ from the default. " +
        "Check the Space's 'Use via API' tab, or switch to a proxied provider (Tripo/Meshy/Replicate/fal). (" +
        String((e as Error)?.message ?? e) +
        ")",
    );
  }
  const glbUrl = findUrlDeep(result?.data, ".glb");
  if (!glbUrl) throw new Error("The Space didn't return a .glb (unexpected API shape).");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
