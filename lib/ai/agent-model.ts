import type { OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";

/** Model behind the Agent panel (app/api/ai/chat). */
export const AGENT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-5.6-luna";

/** OpenRouter endpoint tag the request is pinned to (see the model's Providers tab). */
export const AGENT_ENDPOINT_TAG = "openai/flex";

/**
 * Pinned to OpenAI's flex-tier endpoint with fallbacks disabled, so a request
 * can never silently land on the standard (2x price) endpoint or on Azure /
 * Bedrock. Reasoning effort "high" per product decision (2026-09-19).
 * Reasoning models reject explicit temperature/top_p, so none is set.
 */
export const AGENT_MODEL_SETTINGS: OpenRouterChatSettings = {
  provider: {
    order: [AGENT_ENDPOINT_TAG],
    only: [AGENT_ENDPOINT_TAG],
    allow_fallbacks: false,
    require_parameters: true,
  },
  reasoning: { effort: "high" },
  usage: { include: true },
};
