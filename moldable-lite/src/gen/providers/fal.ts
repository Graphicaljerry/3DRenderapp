import type { GenFn } from "../types";
import { blobToDataURL, fetchAsBlob, findUrlDeep, jsonOrThrow } from "../util";

// model id = fal model path, e.g. "fal-ai/hyper3d/rodin"
export const falGenerate: GenFn = async (input, onProgress, signal) => {
  const base = `${input.proxyBase || ""}/prox/fal`;
  const h = { authorization: `Key ${input.apiKey || ""}`, "content-type": "application/json" };

  const body: any = {};
  if (input.image) {
    const dataUrl = await blobToDataURL(input.image);
    // Rodin takes an ARRAY (input_image_urls); Hunyuan takes a single input_image_url.
    if (input.model.includes("hyper3d") || input.model.includes("rodin")) body.input_image_urls = [dataUrl];
    else body.input_image_url = dataUrl;
  }
  if (input.prompt) body.prompt = input.prompt;

  onProgress({ status: "generating (fal)…" });
  const r = await fetch(`${base}/${input.model}`, { method: "POST", headers: h, signal, body: JSON.stringify(body) });
  const j = await jsonOrThrow(r, "fal");
  // v21 returns model_glb.url (model_mesh is a zip there); older v2 returns model_mesh.url (a GLB).
  const glbUrl = findUrlDeep(j, ".glb") || j.model_glb?.url || j.model_mesh?.url;
  if (!glbUrl) throw new Error("fal returned no GLB.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
