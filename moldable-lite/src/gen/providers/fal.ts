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

  // Print-first default: geometry-only. On Hunyuan the texture stage is the
  // expensive part (v2: textured = 3× the white-mesh price), and baked color
  // gradients don't survive single-filament printing anyway.
  //  - v3.x family: generate_type "Geometry" (white model) vs "Normal" (textured).
  //  - v2 family: textured_mesh flag (defaults false server-side; set only when on).
  //  - Rodin has no geometry-only switch — left untouched either way.
  if (/hunyuan-3d\/|hunyuan3d-v3/.test(input.model)) {
    body.generate_type = input.texture === true ? "Normal" : "Geometry";
  } else if (/hunyuan3d\/v2|hunyuan3d-v21/.test(input.model) && input.texture === true) {
    body.textured_mesh = true;
  }

  onProgress({ status: "generating (fal)…" });
  const r = await fetch(`${base}/${input.model}`, { method: "POST", headers: h, signal, body: JSON.stringify(body) });
  const j = await jsonOrThrow(r, "fal");
  // Hunyuan v3.1 + v21 return model_glb.url (model_mesh is a zip there); older v2 returns model_mesh.url (a GLB).
  const glbUrl = findUrlDeep(j, ".glb") || j.model_glb?.url || j.model_mesh?.url;
  if (!glbUrl) throw new Error("fal returned no GLB.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
