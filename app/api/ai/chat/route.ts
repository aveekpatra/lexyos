import { generateText } from "ai";
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
- For WRITE operations (creating, updating, deleting, completing tasks): FIRST tell the user what you're about to do, then do it.
- When the user mentions a task by name, use search_tasks first to find the ID, then act on it.
- When the user mentions a project by name, use list_projects to find the ID.
- You can chain multiple tool calls.
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

## Today
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.
The current time is ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}.`;

export async function POST(req: Request) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const token = await getToken({ template: "convex" });
    if (!token) return new Response("No Convex token", { status: 401 });

    const { messages } = await req.json();

    // Convert UI messages to simple format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history: any[] = (messages || [])
      .filter((m: Record<string, unknown>) => m.role === "user" || m.role === "assistant")
      .map((m: Record<string, unknown>) => {
        const text = Array.isArray(m.parts)
          ? (m.parts as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text)
              .join("")
          : typeof m.content === "string" ? m.content : "";
        return { role: m.role as string, content: text };
      })
      .filter((m: { content: string }) => m.content.length > 0);

    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const model = openrouter(process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-preview");
    const tools = createTools(token);

    // Manual tool loop — up to 10 rounds
    let currentMessages = [...history];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCallLog: Array<{ toolName: string; input: any; output: any }> = [];

    for (let step = 0; step < 10; step++) {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages: currentMessages,
        tools,
        toolChoice: "auto",
      });

      // If model returned text (final answer), return it
      if (result.text && result.text.trim()) {
        return Response.json({
          text: result.text,
          toolCalls: toolCallLog,
        });
      }

      // If model made tool calls, log them and continue
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (let i = 0; i < result.toolCalls.length; i++) {
          const tc = result.toolCalls[i];
          const tr = result.toolResults?.[i];
          toolCallLog.push({
            toolName: tc.toolName,
            input: tc.input,
            output: tr?.output ?? null,
          });
        }

        // Append the assistant + tool messages to continue the conversation
        currentMessages = [
          ...currentMessages,
          ...(result.response.messages as typeof currentMessages),
        ];
        continue;
      }

      // No text and no tool calls — shouldn't happen but break to avoid infinite loop
      break;
    }

    // Fallback if loop exhausted
    return Response.json({
      text: "I processed your request but couldn't generate a response. The tool calls completed successfully.",
      toolCalls: toolCallLog,
    });
  } catch (err) {
    console.error("AI chat error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error", text: "", toolCalls: [] },
      { status: 500 }
    );
  }
}
