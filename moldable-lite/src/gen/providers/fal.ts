import type { GenFn } from "../types";
import { blobToDataURL, fetchAsBlob, findUrlDeep, jsonOrThrow } from "../util";

// model id = fal model path, e.g. "fal-ai/hyper3d/rodin"
export const falGenerate: GenFn = async (input, onProgress, signal) => {
  const base = `${input.proxyBase || ""}/prox/fal`;
  const h = { authorization: `Key ${input.apiKey || ""}`, "content-type": "application/json" };

  const body: any = {};
  if (input.image) {
    const isRodin = input.model.includes("hyper3d") || input.model.includes("rodin");
    if (isRodin) {
      // Rodin takes an ARRAY — add any extra reference angles for a better mesh.
      const angles = [input.image, input.views?.left, input.views?.back, input.views?.right].filter(Boolean) as Blob[];
      body.input_image_urls = await Promise.all(angles.map(blobToDataURL));
    } else {
      body.input_image_url = await blobToDataURL(input.image); // Hunyuan: single front image
    }
  }
  if (input.prompt) body.prompt = input.prompt;

  onProgress({ status: "generating (fal)…" });
  const r = await fetch(`${base}/${input.model}`, { method: "POST", headers: h, signal, body: JSON.stringify(body) });
  const j = await jsonOrThrow(r, "fal");
  // Hunyuan v3.1 + v21 return model_glb.url (model_mesh is a zip there); older v2 returns model_mesh.url (a GLB).
  const glbUrl = findUrlDeep(j, ".glb") || j.model_glb?.url || j.model_mesh?.url;
  if (!glbUrl) throw new Error("fal returned no GLB.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
