import OpenAI from "openai";

export interface AITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AIToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: AITool[];
}

export interface AIProviderResult {
  message: string;
  toolCalls: AIToolCall[];
}

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5:nitro";

export async function callOpenRouter(config: OpenRouterConfig): Promise<AIProviderResult> {
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config.apiKey,
  });

  const model = config.model || DEFAULT_MODEL;

  const tools: OpenAI.ChatCompletionTool[] = config.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: config.userMessage },
    ],
    tools,
  });

  const choice = response.choices[0];
  const message = choice.message.content || "";
  const toolCalls: AIToolCall[] = (choice.message.tool_calls || [])
    .filter(
      (tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } =>
        tc.type === "function"
    )
    .map((tc) => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

  return { message, toolCalls };
}
