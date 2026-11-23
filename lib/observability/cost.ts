import { activeProvider } from "../llm/provider";
import type { Usage } from "../types";

const CHAT_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  "gpt-4.1-mini": { input: 0.4 / 1_000_000, output: 1.6 / 1_000_000 },
  "gpt-4.1": { input: 2 / 1_000_000, output: 8 / 1_000_000 },
  "grok-4.7": { input: 2 / 1_000_000, output: 6 / 1_000_000 },
  "grok-4.6": { input: 2 / 1_000_000, output: 6 / 1_000_000 },
  "grok-4.5": { input: 2 / 1_000_000, output: 6 / 1_000_000 },
  "grok-4.3": { input: 1.25 / 1_000_000, output: 2.5 / 1_000_000 },
  "grok-4.20-0309-non-reasoning": { input: 1.25 / 1_000_000, output: 2.5 / 1_000_000 },
  "grok-4.20-0309-reasoning": { input: 1.25 / 1_000_000, output: 2.5 / 1_000_000 },
};

const EMBED_PRICE = 0.02 / 1_000_000;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateCost(model: string, usage: Usage): number {
  if (model === "deterministic-planner") return 0;
  const price = CHAT_PRICES[model] ?? CHAT_PRICES["gpt-4o-mini"];
  const chat = usage.promptTokens * price.input + usage.completionTokens * price.output;
  const embed = usage.embeddingTokens * EMBED_PRICE;
  return Math.round((chat + embed) * 1_000_000) / 1_000_000;
}

export function modelName(): string {
  return activeProvider()?.model ?? "deterministic-planner";
}
