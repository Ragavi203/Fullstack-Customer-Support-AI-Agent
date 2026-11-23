export type ProviderId = "openai" | "xai";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
}

const DEFAULT_MODEL: Record<ProviderId, string> = {
  openai: "gpt-4o-mini",
  xai: "grok-4.20-0309-non-reasoning",
};

function selected(): ProviderId | null {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "openai" || forced === "xai") return forced;
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

export function ttsVoice(): string | null {
  if (!process.env.XAI_API_KEY || process.env.XAI_TTS_VOICE === "off") return null;
  return process.env.XAI_TTS_VOICE || "ara";
}

export function activeProvider(): ProviderConfig | null {
  const id = selected();
  if (id === "xai") {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return null;
    return {
      id,
      label: "xAI",
      baseUrl: "https://api.x.ai/v1",
      apiKey,
      model: process.env.XAI_MODEL || DEFAULT_MODEL.xai,
      reasoningEffort: process.env.XAI_REASONING_EFFORT || undefined,
    };
  }
  if (id === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return {
      id,
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey,
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL.openai,
    };
  }
  return null;
}
