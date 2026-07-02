// Hugging Face Spaces via the RAW Gradio HTTP API — no @gradio/client.
// Why: the client library speaks only the newer Gradio protocol, but our best
// free Spaces run older Gradio versions (API at /call/... instead of
// /gradio_api/call/...). We auto-detect the API base per Space and use the
// documented upload -> call -> SSE-result flow, which is version-stable.
// Schemas below were verified against each Space's live /info (2026-07).

import type { GenFn, GenProgress } from "../types";
import { fetchAsBlob, withTimeout } from "../util";

const fd = (path: string) => ({ path, meta: { _type: "gradio.FileData" } });

interface SpaceDef {
  space: string;
  endpoint: string; // api_name without leading slash
  needsSession?: boolean;
  supportsText?: boolean;
  data: (imagePath: string | null, prompt?: string) => unknown[];
}

const SPACES: Record<string, SpaceDef> = {
  "stabilityai/stable-fast-3d": {
    space: "stabilityai/stable-fast-3d",
    endpoint: "run_button",
    // [input_image, foreground_ratio, remesh_option, vertex_count, texture_size]
    data: (img) => [fd(img!), 0.85, "None", -1, 1024],
  },
  "tencent/Hunyuan3D-2": {
    space: "tencent/Hunyuan3D-2",
    endpoint: "generation_all",
    supportsText: true,
    // [caption, image, mv_front, mv_back, mv_left, mv_right, steps, guidance,
    //  seed, octree_resolution, check_box_rembg, num_chunks, randomize_seed]
    data: (img, prompt) => [prompt ?? "", img ? fd(img) : null, null, null, null, null, 30, 5.0, 1234, 256, true, 8000, true],
  },
  "trellis-community/TRELLIS": {
    space: "trellis-community/TRELLIS",
    endpoint: "generate_and_extract_glb",
    needsSession: true,
    // [image, multiimages, seed, ss_guidance, ss_steps, slat_guidance, slat_steps,
    //  multiimage_algo, mesh_simplify, texture_size]
    data: (img) => [fd(img!), [], 0, 7.5, 12, 3.0, 12, "stochastic", 0.95, 1024],
  },
};

function resolveSpace(modelId: string): SpaceDef {
  const bare = modelId.split("::")[0];
  if (SPACES[bare]) return SPACES[bare];
  if (/trellis/i.test(bare)) return SPACES["trellis-community/TRELLIS"];
  if (/hunyuan/i.test(bare)) return SPACES["tencent/Hunyuan3D-2"];
  return SPACES["stabilityai/stable-fast-3d"];
}

/** "owner/Name" -> "https://owner-name.hf.space" (skips huggingface.co entirely). */
function spaceUrl(space: string): string {
  return `https://${space.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.hf.space`;
}

interface ApiLoc {
  apiBase: string; // <base> or <base>/gradio_api
  filePrefix: string; // /file= or /gradio_api/file=
}

/** Detect Gradio version by probing both info routes; doubles as the health check. */
async function detectApi(base: string, headers: Record<string, string>): Promise<ApiLoc> {
  let r5: Response | null = null;
  try {
    r5 = await withTimeout(fetch(`${base}/gradio_api/info`, { headers }), 15_000, "Reaching the Space");
  } catch {
    throw new Error(
      `Your browser couldn't reach ${base} ("failed to fetch"). Usual causes: an ad-blocker / privacy shield blocking hf.space, a VPN/firewall, or the Space being down. Allow hf.space for this site or try another free model in Settings.`,
    );
  }
  if (r5.ok) return { apiBase: `${base}/gradio_api`, filePrefix: "/gradio_api/file=" };
  const r4 = await fetch(`${base}/info`, { headers }).catch(() => null);
  if (r4?.ok) return { apiBase: base, filePrefix: "/file=" };
  throw new Error(
    `The Space at ${base} responded but its API isn't answering (HTTP ${r5.status}${r4 ? `/${r4.status}` : ""}) — it's likely paused, rebuilding, or out of free GPU time. Try again in a minute or switch models in Settings.`,
  );
}

async function upload(loc: ApiLoc, blob: Blob, headers: Record<string, string>): Promise<string> {
  const form = new FormData();
  form.append("files", blob, "image.png");
  const r = await fetch(`${loc.apiBase}/upload`, { method: "POST", body: form, headers });
  if (!r.ok) throw new Error(`Image upload to the Space failed (HTTP ${r.status}).`);
  const arr = (await r.json()) as string[];
  if (!arr?.[0]) throw new Error("The Space's upload endpoint returned no file path.");
  return arr[0];
}

/** POST /call/<api> then stream GET /call/<api>/<event_id> until complete. */
async function call(
  loc: ApiLoc,
  api: string,
  data: unknown[],
  headers: Record<string, string>,
  onProgress: (p: GenProgress) => void,
  ms: number,
): Promise<any[]> {
  const post = await fetch(`${loc.apiBase}/call/${api}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!post.ok) {
    const detail = (await post.text().catch(() => "")).slice(0, 200);
    throw new Error(`The Space rejected the ${api} request (HTTP ${post.status}). ${detail}`);
  }
  const { event_id } = (await post.json()) as { event_id?: string };
  if (!event_id) throw new Error("The Space didn't return a job id — its API may have changed.");

  const stream = await fetch(`${loc.apiBase}/call/${api}/${event_id}`, { headers });
  if (!stream.ok || !stream.body) throw new Error(`Couldn't read the job stream (HTTP ${stream.status}).`);
  const reader = stream.body.getReader();

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      try {
        reader.cancel();
      } catch {}
      rej(new Error(`Generation timed out after ${Math.round(ms / 1000)}s — the free GPU queue may be busy. Try again, or add a free hf_… token in Settings for priority.`));
    }, ms);
  });

  const read = (async () => {
    const dec = new TextDecoder();
    let buf = "";
    let event = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
          if (event === "generating" || event === "heartbeat") onProgress({ status: "generating on a free GPU…" });
        } else if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (event === "complete") {
            try {
              return JSON.parse(payload) as any[];
            } catch {
              throw new Error("The Space returned an unreadable result.");
            }
          }
          if (event === "error") {
            let msg = payload;
            try {
              const j = JSON.parse(payload);
              msg = typeof j === "string" ? j : (j?.message ?? payload);
            } catch {}
            throw new Error(
              /quota|exceeded/i.test(String(msg))
                ? "Free GPU quota is used up for now — add a free hf_… token in Settings (huggingface.co/settings/tokens) for a bigger daily allowance, or try later."
                : `The Space reported an error: ${String(msg).slice(0, 200)}`,
            );
          }
        }
      }
    }
    throw new Error("The job stream ended without a result — the Space may have restarted. Try again.");
  })();

  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Find a GLB in the result: prefer .url fields; construct from .path when needed. */
function findGlb(data: any, base: string, filePrefix: string): string | undefined {
  const hits: string[] = [];
  const walk = (v: any) => {
    if (!v) return;
    if (typeof v === "string") {
      if (v.includes(".glb")) hits.push(v.startsWith("http") ? v : `${base}${filePrefix}${v}`);
      return;
    }
    if (typeof v === "object") {
      if (typeof v.url === "string" && v.url.includes(".glb")) hits.push(v.url);
      else if (typeof v.path === "string" && v.path.includes(".glb")) hits.push(`${base}${filePrefix}${v.path}`);
      for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(data);
  return hits[0];
}

export const hfGenerate: GenFn = async (input, onProgress) => {
  if (!input.image && !input.prompt) throw new Error("Provide an image or a prompt.");
  const def = resolveSpace(input.model);
  if (!input.image && !def.supportsText) {
    throw new Error("This model needs a photo — upload one with 📎, or switch to Hunyuan3D-2 (Settings → Mesh model) for text → 3D.");
  }

  const base = spaceUrl(def.space);
  const headers: Record<string, string> = input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {};

  onProgress({ status: "connecting to the Space…" });
  const loc = await detectApi(base, headers);

  let imagePath: string | null = null;
  if (input.image) {
    onProgress({ status: "uploading your photo…" });
    imagePath = await upload(loc, input.image, headers);
  }

  if (def.needsSession) {
    // TRELLIS initializes per-session state; best-effort — its REST session
    // semantics are less battle-tested than the other two Spaces.
    await call(loc, "start_session", [], headers, onProgress, 60_000).catch(() => undefined);
  }

  onProgress({ status: "queued on a free GPU (can take 30–120s)…" });
  const result = await call(loc, def.endpoint, def.data(imagePath, input.prompt), headers, onProgress, 300_000);

  const glbUrl = findGlb(result, base, loc.filePrefix);
  if (!glbUrl) throw new Error(`${def.space} finished but returned no .glb — its interface may have changed. Try another free model in Settings.`);
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};
