import type { GenFn } from "../types";
import { blobToDataURL, fetchAsBlob, findUrlDeep, jsonOrThrow, poll } from "../util";

// model id = "owner/name", e.g. "firtoz/trellis"
export const replicateGenerate: GenFn = async (input, onProgress, signal) => {
  const proxy = `${input.proxyBase || ""}/prox/replicate`;
  const h = { authorization: `Bearer ${input.apiKey || ""}`, "content-type": "application/json", prefer: "wait" };

  const inputObj: any = {};
  if (input.image) inputObj.images = [await blobToDataURL(input.image)];
  if (input.prompt) inputObj.prompt = input.prompt;

  onProgress({ status: "starting (Replicate)…" });
  const cr = await fetch(`${proxy}/v1/models/${input.model}/predictions`, {
    method: "POST",
    headers: h,
    signal,
    body: JSON.stringify({ input: inputObj }),
  });
  const pred = await jsonOrThrow(cr, "Replicate");

  const getPath = pred.urls?.get ? new URL(pred.urls.get).pathname : `/v1/predictions/${pred.id}`;
  const done = await poll(
    async () => {
      const r = await fetch(`${proxy}${getPath}`, { headers: h, signal });
      const j = await jsonOrThrow(r, "Replicate");
      if (j.status === "succeeded") return j;
      if (j.status === "failed" || j.status === "canceled") throw new Error("Replicate " + j.status + (j.error ? ": " + j.error : ""));
      onProgress({ status: `generating (${j.status})…` });
      return null;
    },
    { signal },
  );

  const out = done.output;
  const glbUrl = typeof out === "string" ? out : out?.model_file || out?.glb || findUrlDeep(out, ".glb");
  if (!glbUrl) throw new Error("Replicate returned no GLB.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
