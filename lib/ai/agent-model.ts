import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter, type OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";
import type { LanguageModel, generateText } from "ai";

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

/**
 * Model behind the Agent panel (app/api/ai/chat). Mirrors Aturno's standard
 * tier exactly: GPT-5.6 Luna straight on OpenAI through the Responses API,
 * reasoning effort "medium", responses not stored server-side. Aturno keeps
 * the interactive chat on OpenAI's standard service tier and uses flex only
 * for background jobs; AGENT_SERVICE_TIER=flex opts this chat into flex.
 *
 * Direct OpenAI needs OPENAI_API_KEY. Without it the same model and effort
 * go through OpenRouter (OPENROUTER_API_KEY), pinned to OpenAI's endpoint.
 */
export const AGENT_MODEL = process.env.OPENROUTER_MODEL?.replace(/^openai\//, "") || "gpt-5.6-luna";
export const AGENT_REASONING_EFFORT = (process.env.AGENT_REASONING_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh";
const SERVICE_TIER = process.env.AGENT_SERVICE_TIER === "flex" ? "flex" : undefined;

export type AgentModel = { model: LanguageModel; providerOptions?: ProviderOptions; provider: "openai" | "openrouter" };

export function agentModel(): AgentModel {
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") });
    return {
      provider: "openai",
      model: openai.responses(AGENT_MODEL),
      providerOptions: { openai: { reasoningEffort: AGENT_REASONING_EFFORT, store: false, ...(SERVICE_TIER ? { serviceTier: SERVICE_TIER } : {}) } },
    };
  }
  const tag = SERVICE_TIER ? "openai/flex" : "openai";
  const settings: OpenRouterChatSettings = {
    provider: { order: [tag], only: [tag], allow_fallbacks: false, require_parameters: true },
    reasoning: { effort: AGENT_REASONING_EFFORT },
    usage: { include: true },
  };
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  return { provider: "openrouter", model: openrouter(`openai/${AGENT_MODEL}`, settings), providerOptions: undefined };
}
