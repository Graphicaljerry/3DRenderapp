import type { GenFn } from "../types";
import { blobToDataURL, fetchAsBlob, jsonOrThrow, poll } from "../util";

export const meshyGenerate: GenFn = async (input, onProgress, signal) => {
  const base = `${input.proxyBase || ""}/prox/meshy`;
  const h = { authorization: `Bearer ${input.apiKey || ""}`, "content-type": "application/json" };
  let taskId: string;
  let pollPath: string;

  if (input.image) {
    onProgress({ status: "uploading image…" });
    const image_url = await blobToDataURL(input.image);
    const r = await fetch(`${base}/openapi/v1/image-to-3d`, {
      method: "POST",
      headers: h,
      signal,
      body: JSON.stringify({ image_url, should_texture: false, target_formats: ["glb"] }),
    });
    taskId = (await jsonOrThrow(r, "Meshy")).result;
    pollPath = `${base}/openapi/v1/image-to-3d/${taskId}`;
  } else {
    const r = await fetch(`${base}/openapi/v2/text-to-3d`, {
      method: "POST",
      headers: h,
      signal,
      body: JSON.stringify({ mode: "preview", prompt: input.prompt, should_texture: false, target_formats: ["glb"] }),
    });
    taskId = (await jsonOrThrow(r, "Meshy")).result;
    pollPath = `${base}/openapi/v2/text-to-3d/${taskId}`;
  }

  const task = await poll(
    async () => {
      const r = await fetch(pollPath, { headers: h, signal });
      const j = await jsonOrThrow(r, "Meshy");
      if (j.status === "SUCCEEDED") return j;
      if (j.status === "FAILED" || j.status === "CANCELED")
        throw new Error("Meshy task " + j.status + (j.task_error?.message ? ": " + j.task_error.message : ""));
      onProgress({ status: `generating ${j.progress ?? 0}%`, pct: j.progress });
      return null;
    },
    { signal },
  );

  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) throw new Error("Meshy returned no GLB URL.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
