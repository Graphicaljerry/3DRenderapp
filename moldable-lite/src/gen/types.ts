// Generative 3D provider layer: one interface, many engines (HF / Meshy / Tripo / Replicate / fal).

export interface GenProgress {
  status: string; // human label, e.g. "queued", "generating 60%"
  pct?: number;
}

export interface GenInput {
  image?: Blob;
  /** Extra reference angles (front is `image`) for multi-view engines. */
  views?: { left?: Blob; back?: Blob; right?: Blob };
  prompt?: string;
  model: string; // provider-specific model / space id
  apiKey?: string; // user's own key for this provider (from settings)
  proxyBase?: string; // "" = local Vite relay; a URL when hosted behind a Worker
}

export interface GenResult {
  glb: Blob;
}

export type GenFn = (
  input: GenInput,
  onProgress: (p: GenProgress) => void,
  signal?: AbortSignal,
) => Promise<GenResult>;

export interface ProviderModel {
  id: string; // value passed as GenInput.model
  label: string;
  image: boolean; // supports image -> 3D
  text: boolean; // supports text -> 3D
  recommended?: boolean; // the best default model for this provider
  hint?: string; // one-line "pick this when…" guidance shown in Settings
  usd?: number; // estimated list price per generated model in USD (0 = free tier)
  credits?: string; // how the provider itself bills it, e.g. "~25 credits"
}

export interface ProviderDef {
  id: string; // "hf" | "meshy" | "tripo" | "replicate" | "fal"
  label: string;
  free: boolean;
  needsKey: boolean;
  keyHint?: string; // where to get the key / prefix
  viaProxy: boolean; // true = routed through /prox/<id> (needs the relay)
  models: ProviderModel[];
  generate: GenFn;
  recommended?: boolean; // the best default engine to start with
  hint?: string; // one-line "pick this when…" guidance shown in Settings
}
