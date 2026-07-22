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

  const upload = async (blob: Blob): Promise<{ type: string; file_token: string }> => {
    const fd = new FormData();
    fd.append("file", blob, "image.png");
    const r = await fetch(`${base}/upload`, { method: "POST", headers: bearer, body: fd, signal });
    const j = await jsonOrThrow(r, "Tripo");
    const token = j.data?.image_token ?? j.data?.file_token;
    if (!token) throw new Error("Tripo upload returned no image token.");
    return { type: blob.type.includes("jpeg") ? "jpg" : "png", file_token: token };
  };

  // Multi-view: Tripo's multiview_to_model wants files ordered [front, left, back, right],
  // with an empty object for any angle the user didn't supply.
  const extraViews = [input.views?.left, input.views?.back, input.views?.right];
  const hasExtra = input.image && extraViews.some(Boolean);

  let taskBody: Record<string, unknown>;
  if (hasExtra) {
    onProgress({ status: "uploading views…" });
    const front = await upload(input.image!);
    const rest = await Promise.all(extraViews.map((v) => (v ? upload(v) : Promise.resolve({}))));
    taskBody = { type: "multiview_to_model", files: [front, ...rest] };
  } else if (input.image) {
    onProgress({ status: "uploading image…" });
    taskBody = { type: "image_to_model", file: await upload(input.image) };
  } else {
    taskBody = { type: "text_to_model", prompt: input.prompt };
  }
  // Print-first default: geometry only. Texturing is Tripo's paid add-on — leaving
  // it off returns the untextured base model and costs fewer credits.
  taskBody.texture = input.texture === true;
  taskBody.pbr = input.texture === true;

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
