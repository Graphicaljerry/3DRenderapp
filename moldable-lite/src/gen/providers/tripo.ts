import type { GenFn } from "../types";
import { fetchAsBlob, jsonOrThrow, poll } from "../util";

export const tripoGenerate: GenFn = async (input, onProgress, signal) => {
  try {
    return await run(input, onProgress, signal);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/2010|enough credit/i.test(msg)) {
      throw new Error(
        "Your Tripo API wallet is empty. Heads-up: Tripo's free monthly credits apply to their web Studio only — the API uses a separate PREPAID wallet (platform.tripo3d.ai → Billing; a generation costs ~10–25 credits, so a small top-up goes far). Free alternative: generate in Tripo Studio (free credits), download the .glb, and drag it straight into Moldable — the whole measure/repair/export pipeline works on imported files.",
      );
    }
    throw e;
  }
};

const run: GenFn = async (input, onProgress, signal) => {
  const base = `${input.proxyBase || ""}/prox/tripo/v2/openapi`;
  const bearer = { authorization: `Bearer ${input.apiKey || ""}` };

  let fileToken: string | undefined;
  if (input.image) {
    onProgress({ status: "uploading image…" });
    const fd = new FormData();
    fd.append("file", input.image, "image.png");
    const r = await fetch(`${base}/upload`, { method: "POST", headers: bearer, body: fd, signal });
    const j = await jsonOrThrow(r, "Tripo");
    fileToken = j.data?.image_token ?? j.data?.file_token;
    if (!fileToken) throw new Error("Tripo upload returned no image token.");
  }

  const ext = input.image?.type.includes("jpeg") ? "jpg" : "png";
  const taskBody = input.image
    ? { type: "image_to_model", file: { type: ext, file_token: fileToken } }
    : { type: "text_to_model", prompt: input.prompt };

  const cr = await fetch(`${base}/task`, {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify(taskBody),
    signal,
  });
  const taskId = (await jsonOrThrow(cr, "Tripo")).data?.task_id;
  if (!taskId) throw new Error("Tripo task creation failed.");

  const done = await poll(
    async () => {
      const r = await fetch(`${base}/task/${taskId}`, { headers: bearer, signal });
      const d = (await jsonOrThrow(r, "Tripo")).data;
      if (d.status === "success") return d;
      if (["failed", "cancelled", "banned", "expired"].includes(d.status)) throw new Error("Tripo task " + d.status);
      onProgress({ status: `generating ${d.progress ?? 0}%`, pct: d.progress });
      return null;
    },
    { signal },
  );

  const out = done.output || {};
  const glbUrl = out.pbr_model || out.model || out.base_model;
  if (!glbUrl) throw new Error("Tripo returned no model URL.");
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
