import { streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createTools } from "@/lib/ai/tools";
import { auth } from "@clerk/nextjs/server";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are UniFocus AI — a personal task and calendar management assistant. You help the user manage their tasks, schedule, and projects through natural conversation.

## Your Capabilities
- Create, update, complete, delete, and search tasks
- List and manage projects
- Check today's schedule, find free time, plan days
- Answer questions about what's coming up, what's overdue, priorities

## How You Work
- When the user asks to do something, use the appropriate tool. Don't just say you'll do it — actually do it.
- When the user mentions a task by name, use search_tasks first to find the ID, then act on it.
- When the user mentions a project by name, use list_projects to find the ID.
- Default to today's date when no date is specified.
- Use 24h time format internally (HH:MM), but communicate in 12h format to the user.
- Be concise. Don't over-explain. Confirm actions briefly.
- Priority levels: p1 = urgent/critical, p2 = high, p3 = medium (default), p4 = low.

## Response Style
- Keep responses short and direct (1-3 sentences).
- After creating/updating something, confirm what was done.
- When listing tasks, format them clearly but briefly.
- Don't use markdown headers in responses — keep it conversational.
- Use bullet points for lists of tasks.

## Today
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

export async function POST(req: Request) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const token = await getToken({ template: "convex" });
    if (!token) {
      return new Response("No Convex token", { status: 401 });
    }

    const body = await req.json();

    // v6 useChat sends UIMessages with `parts` array — convert to simple role/content format
    const uiMessages = body.messages || [];
    const modelMessages = uiMessages
      .filter((m: Record<string, unknown>) => m.role === "user" || m.role === "assistant")
      .map((m: Record<string, unknown>) => {
        const text = Array.isArray(m.parts)
          ? (m.parts as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text)
              .join("")
          : typeof m.content === "string" ? m.content : "";
        return { role: m.role as "user" | "assistant", content: text };
      })
      .filter((m: { content: string }) => m.content.length > 0);

    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const model = openrouter(process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-preview");
    const tools = createTools(token);

    console.log("[AI Chat] Model:", process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-preview");
    console.log("[AI Chat] Messages count:", modelMessages.length);
    console.log("[AI Chat] First message:", JSON.stringify(modelMessages[0]).slice(0, 200));

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      tools,
      toolChoice: "auto",
      onError: (err) => {
        console.error("[AI Chat] Stream error:", err);
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error("AI chat error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
