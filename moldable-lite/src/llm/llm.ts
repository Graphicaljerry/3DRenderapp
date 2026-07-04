// LLM provider layer for the Precise (CAD) engine: Anthropic native, plus any
// OpenAI-compatible provider (Gemini free tier, OpenAI, Groq, OpenRouter,
// local Ollama, custom endpoints) through one adapter.

import { generate as generateAnthropic, MODELS, type ApiMsg, type StreamHandlers } from "./anthropic";
import { generateCompat } from "./openaiCompat";

export type LlmProviderId = "anthropic" | "gemini" | "openai" | "groq" | "openrouter" | "ollama" | "custom";

export interface LlmSettings {
  provider: LlmProviderId;
  model: string;
  baseUrl?: string; // custom provider only
}

export interface LlmPreset {
  id: LlmProviderId;
  label: string;
  free?: boolean;
  needsKey: boolean;
  recommended?: boolean; // best free default to start with
  baseUrl?: string;
  relayPrefix?: string; // relay route used if the browser can't call it directly
  defaultModel: string;
  keyHint: string;
  hint?: string; // one-line "pick this when…" guidance shown in Settings
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic Claude — best CAD quality",
    needsKey: true,
    defaultModel: MODELS[0].id,
    keyHint: "sk-ant-… from console.anthropic.com",
    hint: "The most accurate CAD coder — dimensions, fits and tricky geometry come out right most often. Paid key.",
  },
  {
    id: "gemini",
    label: "Google Gemini — free tier",
    free: true,
    needsKey: true,
    recommended: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    relayPrefix: "gemini",
    defaultModel: "gemini-2.0-flash",
    keyHint: "free key from aistudio.google.com/apikey (~1,500 req/day). The app checks your account's live model list and auto-picks the best Flash model.",
    hint: "Best free pick — handles most everyday objects well, and reads photos.",
  },
  {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    baseUrl: "https://api.openai.com/v1",
    relayPrefix: "openai",
    defaultModel: "gpt-5.1",
    keyHint: "sk-… from platform.openai.com/api-keys",
    hint: "Close behind Claude on accuracy. Paid key.",
  },
  {
    id: "groq",
    label: "Groq — free tier, fast open models",
    free: true,
    needsKey: true,
    baseUrl: "https://api.groq.com/openai/v1",
    relayPrefix: "groq",
    defaultModel: "llama-3.3-70b-versatile",
    keyHint: "free key from console.groq.com/keys",
    hint: "Near-instant replies — fine for simple shapes, weaker on complex parts.",
  },
  {
    id: "openrouter",
    label: "OpenRouter — many models, some :free",
    needsKey: true,
    baseUrl: "https://openrouter.ai/api/v1",
    relayPrefix: "openrouter",
    defaultModel: "google/gemini-3-flash",
    keyHint: "sk-or-… from openrouter.ai/keys",
    hint: "One key that reaches many different models — handy for experimenting.",
  },
  {
    id: "ollama",
    label: "Ollama — runs on your machine, private",
    free: true,
    needsKey: false,
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:14b",
    keyHint: "install ollama.com, `ollama pull <model>`; if blocked set OLLAMA_ORIGINS=*",
    hint: "Fully private and offline — quality depends on the model you install.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible endpoint)",
    needsKey: false,
    defaultModel: "",
    keyHint: "any endpoint that serves …/v1/chat/completions",
    hint: "For self-hosted or niche providers with an OpenAI-style API.",
  },
];

export function llmPreset(id: LlmProviderId): LlmPreset {
  return LLM_PRESETS.find((p) => p.id === id) ?? LLM_PRESETS[0];
}

/** Is this settings+keys combination usable? */
export function llmReady(s: LlmSettings, keys: Record<string, string | undefined>): boolean {
  const p = llmPreset(s.provider);
  if (s.provider === "custom") return !!s.baseUrl;
  if (!p.needsKey) return true;
  return !!keys[s.provider];
}

/** Route a generation to the configured provider. Same signature spirit as the Anthropic client. */
export async function generateLlm(
  s: LlmSettings,
  keys: Record<string, string | undefined>,
  system: string,
  messages: ApiMsg[],
  h: StreamHandlers = {},
  proxyBase = "",
): Promise<string> {
  if (s.provider === "anthropic") {
    return generateAnthropic({ apiKey: keys.anthropic ?? "", model: s.model, system, messages }, h);
  }
  const p = llmPreset(s.provider);
  const baseUrl = s.provider === "custom" ? s.baseUrl ?? "" : p.baseUrl!;
  if (!baseUrl) throw new Error("Set the custom provider's Base URL in Settings.");
  return generateCompat(
    {
      baseUrl,
      apiKey: keys[s.provider],
      model: s.model || p.defaultModel,
      system,
      messages,
      relayPrefix: p.relayPrefix,
      proxyBase,
    },
    h,
  );
}
