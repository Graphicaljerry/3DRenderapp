import type { GenFn, GenProgress } from "../types";
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
      body: JSON.stringify({ image_url, should_texture: input.texture === true, target_formats: ["glb"] }),
    });
    taskId = (await jsonOrThrow(r, "Meshy")).result;
    pollPath = `${base}/openapi/v1/image-to-3d/${taskId}`;
  } else {
    const r = await fetch(`${base}/openapi/v2/text-to-3d`, {
      method: "POST",
      headers: h,
      signal,
      body: JSON.stringify({ mode: "preview", prompt: input.prompt, should_texture: input.texture === true, target_formats: ["glb"] }),
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
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase), taskId };
};

/** Meshy's print-repair pass: watertight topology, non-manifold edges, degenerate faces
 *  and — the part that matters — SELF-INTERSECTIONS.
 *
 *  This exists because the local repair in print/repair.ts says in its own header that it
 *  fixes cracks and holes but not self-intersections, and self-intersections are exactly
 *  what a sculpted AI mesh produces and exactly what makes a slicer refuse the file. So
 *  the gap is documented in our own code; this closes it for meshes Meshy made.
 *
 *  Addressed by task id, never by upload, so it only applies to a mesh Meshy generated —
 *  which is the honest limit of the feature and why the caller checks before offering it.
 *  Meshy bills 10 credits and refunds automatically when a task fails. */
export async function meshyRepair(
  inputTaskId: string,
  apiKey: string,
  proxyBase: string,
  onProgress: (p: GenProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const base = `${proxyBase || ""}/prox/meshy`;
  const h = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  onProgress({ status: "sending for print repair…" });
  const r = await fetch(`${base}/openapi/v1/repair-printability`, {
    method: "POST",
    headers: h,
    signal,
    body: JSON.stringify({ input_task_id: inputTaskId }),
  });
  const taskId = (await jsonOrThrow(r, "Meshy repair")).result;
  const task = await poll(
    async () => {
      const rr = await fetch(`${base}/openapi/v1/repair-printability/${taskId}`, { headers: h, signal });
      const j = await jsonOrThrow(rr, "Meshy repair");
      if (j.status === "SUCCEEDED") return j;
      if (j.status === "FAILED" || j.status === "CANCELED")
        throw new Error("Meshy repair " + j.status + (j.task_error?.message ? ": " + j.task_error.message : ""));
      onProgress({ status: `repairing ${j.progress ?? 0}%`, pct: j.progress });
      return null;
    },
    { signal },
  );
  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) throw new Error("Meshy repair returned no GLB URL.");
  return fetchAsBlob(glbUrl, proxyBase);
}
