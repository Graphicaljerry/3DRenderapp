import type { GenFn, GenProgress } from "../types";
import { fetchAsBlob, findUrlDeep, withTimeout } from "../util";

// Space call definitions verified against each Space's LIVE /info schema (2026-07-01).
// - @gradio/client v2 auth option is `token` (v1's `hf_token` is silently ignored!).
// - stable-fast-3d: single call, 4 replicas, seconds of GPU → best free-quota mileage.
// - Hunyuan3D-2: single call, 13 params, also does text→3D via `caption`.
// - trellis-community/TRELLIS: requires /start_session on the SAME client first.

interface SpaceDef {
  space: string;
  endpoint: string;
  needsSession?: boolean;
  supportsText?: boolean;
  payload: (h: (b: Blob) => unknown, image?: Blob, prompt?: string) => Record<string, unknown>;
}

const SPACES: Record<string, SpaceDef> = {
  "stabilityai/stable-fast-3d": {
    space: "stabilityai/stable-fast-3d",
    endpoint: "/run_button",
    payload: (h, image) => ({
      input_image: h(image!),
      foreground_ratio: 0.85,
      remesh_option: "None",
      vertex_count: -1,
      texture_size: 1024,
    }),
  },
  "tencent/Hunyuan3D-2": {
    space: "tencent/Hunyuan3D-2",
    endpoint: "/generation_all",
    supportsText: true,
    payload: (h, image, prompt) => ({
      caption: prompt ?? "",
      image: image ? h(image) : null,
      mv_image_front: null,
      mv_image_back: null,
      mv_image_left: null,
      mv_image_right: null,
      steps: 30,
      guidance_scale: 5.0,
      seed: 1234,
      octree_resolution: 256,
      check_box_rembg: true,
      num_chunks: 8000,
      randomize_seed: true,
    }),
  },
  "trellis-community/TRELLIS": {
    space: "trellis-community/TRELLIS",
    endpoint: "/generate_and_extract_glb",
    needsSession: true,
    payload: (h, image) => ({
      image: h(image!),
      multiimages: [],
      seed: 0,
      ss_guidance_strength: 7.5,
      ss_sampling_steps: 12,
      slat_guidance_strength: 3.0,
      slat_sampling_steps: 12,
      multiimage_algo: "stochastic",
      mesh_simplify: 0.95,
      texture_size: 1024,
    }),
  },
};

/** Normalize legacy stored model ids ("space::/endpoint", dead Spaces) to a live SpaceDef. */
function resolveSpace(modelId: string): SpaceDef {
  const bare = modelId.split("::")[0];
  if (SPACES[bare]) return SPACES[bare];
  if (/trellis/i.test(bare)) return SPACES["trellis-community/TRELLIS"];
  if (/hunyuan/i.test(bare)) return SPACES["tencent/Hunyuan3D-2"];
  return SPACES["stabilityai/stable-fast-3d"];
}

/**
 * Direct *.hf.space URL for a Space ("owner/Name" -> "owner-name.hf.space").
 * Connecting here skips the huggingface.co metadata API — the hop that most
 * often fails in browsers ("Failed to fetch": ad-blockers, shields, CORS moods).
 */
function spaceUrl(space: string): string {
  return `https://${space.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.hf.space`;
}

/** After a failure, probe the Space host to say precisely WHAT is wrong. */
async function diagnose(url: string, original: unknown): Promise<Error> {
  const orig = String((original as Error)?.message ?? original);
  try {
    // Gradio 5 serves /gradio_api/info; Gradio 4 serves /info.
    const r = await withTimeout(fetch(`${url}/gradio_api/info`).catch(() => fetch(`${url}/info`)), 12_000, "Probing the Space");
    if (r.ok) return new Error(`The Space is reachable but the call failed: ${orig}. Its API may have changed, or the free GPU queue rejected the request — try again or switch models in Settings.`);
    if (r.status === 404) return new Error(`The Space is up but didn't expose its API where expected (HTTP 404) — it may have been rebuilt with a different interface. Try another free model in Settings.`);
    return new Error(`The Space responded HTTP ${r.status} — it may be paused, rebuilding, or out of free GPU quota. Try again in a minute or switch models in Settings.`);
  } catch {
    return new Error(
      `Your browser couldn't reach ${url} at all ("failed to fetch"). Usual causes: an ad-blocker / privacy shield blocking hf.space, a VPN/firewall, or the Space being down. Try disabling shields for this site, a different network, or another free model in Settings.`,
    );
  }
}

function friendly(e: unknown, space: string): Error {
  const msg = String((e as Error)?.message ?? e);
  if (/abort/i.test(msg)) return e as Error;
  if (/timed out|couldn't reach|responded HTTP|didn't expose/i.test(msg)) return new Error(msg);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return new Error(
      `Your browser couldn't reach Hugging Face ("failed to fetch") — often an ad-blocker/privacy shield, a VPN, or a flaky network. Allow hf.space + huggingface.co for this site and retry, or pick another free model in Settings.`,
    );
  }
  if (/metadata could not be loaded|not.?found|404|unavailable|paused/i.test(msg)) {
    return new Error(
      `Couldn't reach the Hugging Face Space "${space}" — it may be paused, moved, or blocked by your network. Try another free model in Settings → Generative engine.`,
    );
  }
  if (/quota|exceeded|429|rate.?limit/i.test(msg)) {
    return new Error(
      "The free Hugging Face GPU quota is used up for now. Paste a free hf_… token in Settings (huggingface.co/settings/tokens) for a bigger daily quota, or try again later.",
    );
  }
  if (/sign.?in|login|unauthorized|401|403/i.test(msg)) {
    return new Error("This Space requires a Hugging Face login for API calls — paste a free hf_… token in Settings.");
  }
  return new Error(`Hugging Face generation failed: ${msg}`);
}

export const hfGenerate: GenFn = async (input, onProgress) => {
  if (!input.image && !input.prompt) throw new Error("Provide an image or a prompt.");
  const def = resolveSpace(input.model);
  if (!input.image && !def.supportsText) {
    throw new Error("This model needs a photo — upload one with 📎, or switch to Hunyuan3D-2 (Settings → Generative engine) for text → 3D.");
  }

  const { Client, handle_file } = await import("@gradio/client");

  onProgress({ status: "connecting to Hugging Face…" });
  const url = spaceUrl(def.space);
  let app: any;
  try {
    // Connect straight to the Space's own server — skips the fragile
    // huggingface.co metadata hop that causes most "failed to fetch" errors.
    app = await withTimeout(
      Client.connect(url, {
        ...(input.apiKey ? { token: input.apiKey as `hf_${string}` } : {}),
        events: ["data", "status"],
      } as any),
      45_000,
      `Connecting to ${def.space} (the Space may be asleep)`,
    );
    if (def.needsSession) await app.predict("/start_session", []);
  } catch (e) {
    throw friendly(await diagnose(url, e), def.space);
  }

  onProgress({ status: "submitted — waiting for a free GPU…" });
  let data: any[];
  try {
    data = await runJob(app, def.endpoint, def.payload(handle_file, input.image, input.prompt), onProgress, 300_000);
  } catch (e) {
    throw friendly(e, def.space);
  }

  const glbUrl = findUrlDeep(data, ".glb");
  if (!glbUrl) throw new Error(`${def.space} finished but returned no .glb (its API may have changed — try another model in Settings).`);
  return { glb: await fetchAsBlob(glbUrl, input.proxyBase) };
};

/** Run a Space job with live queue/progress updates and a hard deadline. */
async function runJob(
  app: any,
  endpoint: string,
  payload: Record<string, unknown>,
  onProgress: (p: GenProgress) => void,
  ms: number,
): Promise<any[]> {
  const job = app.submit(endpoint, payload);
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      try {
        job.cancel?.();
      } catch {
        /* ignore */
      }
      rej(new Error(`Generation timed out after ${Math.round(ms / 1000)}s — the free queue may be busy. Try again, or add a free hf_… token in Settings for priority.`));
    }, ms);
  });
  const run = (async () => {
    let out: any[] | null = null;
    for await (const msg of job as AsyncIterable<any>) {
      if (msg.type === "status") {
        if (msg.stage === "error") throw new Error(msg.message || "The Space reported an error.");
        const bits: string[] = [];
        if (typeof msg.position === "number") bits.push(`queue position ${msg.position + 1}`);
        else bits.push(msg.stage === "pending" ? "queued" : "generating");
        if (typeof msg.eta === "number" && msg.eta > 0) bits.push(`~${Math.round(msg.eta)}s`);
        onProgress({ status: `Hugging Face: ${bits.join(" · ")}` });
      } else if (msg.type === "data") {
        out = msg.data;
      }
    }
    if (!out) throw new Error("The Space returned no data.");
    return out;
  })();
  try {
    return await Promise.race([run, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
