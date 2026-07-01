import type { GenFn } from "../types";
import { blobToDataURL, fetchAsBlob, findUrlDeep, jsonOrThrow } from "../util";

// model id = fal model path, e.g. "fal-ai/hyper3d/rodin"
export const falGenerate: GenFn = async (input, onProgress, signal) => {
  const base = `${input.proxyBase || ""}/prox/fal`;
  const h = { authorization: `Key ${input.apiKey || ""}`, "content-type": "application/json" };

  const body: any = {};
  if (input.image) body.input_image_url = await blobToDataURL(input.image);
  if (input.prompt) body.prompt = input.prompt;

  onProgress({ status: "generating (fal)…" });
  const r = await fetch(`${base}/${input.model}`, { method: "POST", headers: h, signal, body: JSON.stringify(body) });
  const j = await jsonOrThrow(r, "fal");
  const glbUrl = j.model_mesh?.url || findUrlDeep(j, ".glb");
  if (!glbUrl) throw new Error("fal returned no GLB.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
