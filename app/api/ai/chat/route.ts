import { generateText, createUIMessageStream } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createTools } from "@/lib/ai/tools";
import { auth } from "@clerk/nextjs/server";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are UniFocus AI — a personal task and calendar management assistant. You help the user manage their tasks, schedule, and projects through natural conversation.

## Your Capabilities
- Create, update, complete, delete, and search tasks
- List and manage projects (create, rename, recolor, archive)
- Check today's schedule, find free time, plan days
- Answer questions about what's coming up, what's overdue, priorities
- Find tasks by name and act on them (reschedule, reprioritize, move to project, etc.)

## How You Work
- For READ operations (listing tasks, checking schedule, searching): just do it immediately using tools.
- For WRITE operations (creating, updating, deleting, completing tasks): FIRST tell the user what you're about to do, then do it. Example: "I'll create a task 'Meeting with Bob' for tomorrow at 2pm" then call the tool.
- When the user mentions a task by name, use search_tasks first to find the ID, then act on it.
- When the user mentions a project by name, use list_projects to find the ID.
- You can chain multiple tool calls. For example: search for a task → then update it.
- Default to today's date when no date is specified.
- Use 24h time format internally (HH:MM), but communicate in 12h format to the user.
- Be concise. Don't over-explain. Confirm actions briefly.
- Priority levels: p1 = urgent/critical, p2 = high, p3 = medium (default), p4 = low.
- Task statuses: todo, planned, in_progress, review, done.
- NEVER delete tasks or projects without explicit user confirmation.

## Response Style
- Keep responses short and direct (1-3 sentences).
- After creating/updating something, confirm what was done.
- When listing tasks, format them clearly but briefly.
- Don't use markdown headers in responses — keep it conversational.
- Use bullet points for lists of tasks.
- When you use tools, briefly mention what you did (e.g., "I found 3 tasks matching 'meeting'...").

## Today
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.
The current time is ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}.`;

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

    // v6 useChat sends UIMessages with `parts` array — convert to CoreMessage format
    const uiMessages = body.messages || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelMessages: any[] = uiMessages
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

    // Manual multi-step tool loop with streaming via createUIMessageStream
    const response = createUIMessageStream({
      execute: async ({ writer }) => {
        let messages = [...modelMessages];
        const MAX_STEPS = 10;

        for (let step = 0; step < MAX_STEPS; step++) {
          const result = await generateText({
            model,
            system: SYSTEM_PROMPT,
            messages,
            tools,
            toolChoice: "auto",
          });

          // If there are tool calls, execute them and add results to messages
          if (result.toolCalls && result.toolCalls.length > 0) {
            // Stream tool calls to client
            for (const tc of result.toolCalls) {
              writer.write({
                type: "tool-input-start",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
              });
              writer.write({
                type: "tool-input-available",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
              });
            }

            // Stream tool results to client
            for (const tr of result.toolResults) {
              writer.write({
                type: "tool-output-available",
                toolCallId: tr.toolCallId,
                output: tr.output as Record<string, unknown>,
              });
            }

            // Add assistant message with tool calls + tool results to conversation
            messages = [
              ...messages,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...(result.response.messages as any[]),
            ];

            // If there's also text in this step, stream it
            if (result.text) {
              writer.write({ type: "text-delta", delta: result.text, id: crypto.randomUUID() });
              break; // Got text + tool calls, done
            }

            // Continue loop — model needs to generate text based on tool results
            continue;
          }

          // No tool calls — just text response
          if (result.text) {
            writer.write({ type: "text-delta", delta: result.text, id: crypto.randomUUID() });
          }
          break; // Done
        }
      },
      onError: (err) => {
        console.error("[AI Chat] Error:", err);
        return err instanceof Error ? err.message : "An error occurred";
      },
    });

    return new Response(response, {
      headers: { "Content-Type": "text/event-stream" },
    });
  } catch (err) {
    console.error("AI chat error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
