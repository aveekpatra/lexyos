/**
 * Proves the Agent model config really lands on the pinned OpenRouter endpoint.
 *
 *   OPENROUTER_API_KEY=... pnpm exec tsx scripts/verify-agent-endpoint.ts
 *
 * Makes one tiny request with the exact settings the chat route uses, then
 * reads the generation record back from OpenRouter and checks (a) the provider
 * and (b) the effective per-token price against the endpoint listing, which is
 * what separates the flex endpoint from the standard one (same provider name,
 * half the price). Exits non-zero on any mismatch. Never prints the key.
 */
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { AGENT_MODEL, AGENT_MODEL_SETTINGS, AGENT_ENDPOINT_TAG } from "../lib/ai/agent-model";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(2);
}

async function main() {
  // 1. Endpoint listing: confirm the tag exists and record its price.
  const list = await fetch(`https://openrouter.ai/api/v1/models/${AGENT_MODEL}/endpoints`).then((r) => r.json());
  const endpoints: Array<{ tag: string; provider_name: string; pricing: { prompt: string; completion: string }; supported_parameters: string[] }> =
    list?.data?.endpoints ?? [];
  const flex = endpoints.find((e) => e.tag === AGENT_ENDPOINT_TAG);
  if (!flex) {
    console.error(`endpoint tag ${AGENT_ENDPOINT_TAG} not listed for ${AGENT_MODEL}; tags: ${endpoints.map((e) => e.tag).join(", ")}`);
    process.exit(1);
  }
  const standard = endpoints.find((e) => e.tag === "openai");
  console.log(`listing: ${AGENT_ENDPOINT_TAG} in=$${Number(flex.pricing.prompt) * 1e6}/M out=$${Number(flex.pricing.completion) * 1e6}/M` +
    (standard ? ` | standard in=$${Number(standard.pricing.prompt) * 1e6}/M out=$${Number(standard.pricing.completion) * 1e6}/M` : ""));
  for (const p of ["reasoning_effort", "tools"]) {
    if (!flex.supported_parameters.includes(p)) { console.error(`flex endpoint does not support ${p}`); process.exit(1); }
  }

  // 2. Live request with the route's exact settings.
  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter(AGENT_MODEL, AGENT_MODEL_SETTINGS);
  const t0 = Date.now();
  const result = await generateText({ model, prompt: "Reply with the single word: ok" });
  const ms = Date.now() - t0;
  const meta = result.providerMetadata?.openrouter as Record<string, unknown> | undefined;
  const raw = result.response as unknown as { body?: { provider?: string; id?: string } };
  const genId = result.response.id;
  const providerFromBody = raw?.body?.provider ?? (meta?.provider as string | undefined);
  console.log(`request: model=${result.response.modelId} provider=${providerFromBody ?? "?"} gen=${genId} ${ms}ms text=${JSON.stringify(result.text.slice(0, 40))}`);
  console.log(`usage: in=${result.usage.inputTokens} out=${result.usage.outputTokens} reasoning=${result.usage.outputTokenDetails?.reasoningTokens ?? "?"}`);

  // 3. Generation record: authoritative provider + cost.
  await new Promise((r) => setTimeout(r, 1500));
  const gen = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(genId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }).then((r) => r.json());
  const g = gen?.data ?? {};
  const promptTokens = Number(g.native_tokens_prompt ?? g.tokens_prompt ?? 0);
  const completionTokens = Number(g.native_tokens_completion ?? g.tokens_completion ?? 0);
  const reasoningTokens = Number(g.native_tokens_reasoning ?? 0);
  const cost = Number(g.total_cost ?? g.usage ?? NaN);
  const expectedFlex = promptTokens * Number(flex.pricing.prompt) + (completionTokens + (g.native_tokens_reasoning ? 0 : reasoningTokens)) * Number(flex.pricing.completion);
  const expectedStd = standard ? promptTokens * Number(standard.pricing.prompt) + completionTokens * Number(standard.pricing.completion) : NaN;
  console.log(`generation: provider=${g.provider_name} model=${g.model} tokens in=${promptTokens} out=${completionTokens} reasoning=${reasoningTokens} cost=$${cost}`);
  console.log(`expected cost: flex=$${expectedFlex.toFixed(8)} standard=$${Number.isNaN(expectedStd) ? "n/a" : expectedStd.toFixed(8)}`);

  const providerOk = String(g.provider_name ?? providerFromBody ?? "").toLowerCase().startsWith("openai");
  const costOk = Number.isFinite(cost) && Math.abs(cost - expectedFlex) <= Math.max(1e-7, expectedFlex * 0.05);
  const notStandard = Number.isNaN(expectedStd) || Math.abs(cost - expectedStd) > Math.max(1e-7, expectedStd * 0.05) || expectedStd === expectedFlex;
  if (!providerOk) { console.error("FAIL: provider is not OpenAI"); process.exit(1); }
  if (!costOk || !notStandard) { console.error("FAIL: billed cost does not match the flex endpoint price"); process.exit(1); }
  console.log(`PASS: ${AGENT_MODEL} served by ${g.provider_name} at flex-tier pricing (reasoning effort ${JSON.stringify(AGENT_MODEL_SETTINGS.reasoning)})`);
}

main().catch((err) => { console.error("FAIL:", err instanceof Error ? err.message : err); process.exit(1); });
