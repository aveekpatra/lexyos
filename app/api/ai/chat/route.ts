import { generateText, stepCountIs } from "ai";
import { createTools } from "@/lib/ai/tools";
import { auth } from "@clerk/nextjs/server";
import { agentModel } from "@/lib/ai/agent-model";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { mergeSettings } from "@/lib/settings";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the Lexyos agent, a personal task, project, and calendar assistant. You help the user manage their tasks, schedule, and projects through natural conversation.

## Your Capabilities
- Create, update, complete, delete, and search tasks
- List and manage projects (create, rename, recolor, archive)
- Check today's schedule, find free time, plan days
- Answer questions about what's coming up, what's overdue, priorities
- Find tasks by name and act on them (reschedule, reprioritize, move to project, etc.)

## How You Work
- Act immediately — do NOT ask for confirmation. Just execute the tool and briefly confirm what you did.
- The only exception where you MUST ask before acting: delete_task. This is irreversible.
- Everything else (create, update, complete, etc.) — just do it. The user can ask you to undo if needed.
- When the user mentions a task by name, use search_tasks first to find the ID, then act on it.
- When the user mentions a project by name, use list_projects to find the ID.

## Where Context Lives, and How to Plan
- A PROJECT is long-horizon: its Context document (goals, links, decisions, constraints), its board columns, and every task with subtasks. For anything inside a project call get_project ONCE and plan from that; never page through list_tasks for project work.
- A TASK carries its own context in its description and its subtasks. get_task returns both.
- The INBOX is everything without a project: quick items. search_tasks or list_tasks is enough there.
- Before creating anything, search_tasks (scoped with projectId when it belongs to a project) so you update or reuse an existing task instead of creating a duplicate.
- You can create projects with a description, a Context document, and custom columns (create_project), reshape boards (set_project_columns), and set every task property including columnId, parentTaskId (subtasks), labels, schedule, and recurrence.
- You can chain multiple tool calls in a single turn.
- Default to today's date when no date is specified.
- Use 24h time format internally (HH:MM), but communicate in 12h format to the user.
- Be concise. Don't over-explain. Confirm actions briefly.
- Priority levels: p1 = urgent/critical, p2 = high, p3 = medium (default), p4 = low.
- Task statuses: todo, planned, in_progress, review, done.

## CRITICAL: Verify Every Write Operation
This is your most important rule. You MUST verify after every write operation:

1. **After create_task**: Call get_task with the returned ID to read back the task. Confirm to the user using the VERIFIED data (title, date, time, priority) from get_task — NOT from your memory of what you sent.
2. **After update_task**: Call get_task with the task ID to read the updated state. Report the verified values.
3. **After complete_task**: Call get_task to confirm the status is now "done" (or toggled back).
4. **After delete_task**: You may skip verification since the task no longer exists.
5. **After create_project / update_project**: Call list_projects to verify.

NEVER tell the user "I created your task" based only on the create_task result. You MUST read it back with get_task first. Your confirmation must be based on what you READ, not what you WROTE.

If get_task returns an error or unexpected data, tell the user something went wrong.

## Tool Results — Zero Tolerance for Hallucination
- ALWAYS inspect the actual tool result object before responding.
- If a tool returned { error: "..." }, tell the user it FAILED and quote the error.
- NEVER claim an action succeeded unless the tool result explicitly confirms it (e.g. { created: true }, { updated: true }).
- NEVER fabricate task IDs, titles, dates, or any data. Only use data returned by tools.
- If you are unsure whether something worked, call get_task or search_tasks to check. Do not guess.

## Response Style
- Keep responses short and direct (1-3 sentences).
- After verifying a write operation, briefly confirm what the verified state is.
- When listing tasks, format them clearly but briefly.
- Don't use markdown headers in responses — keep it conversational.
- Use bullet points for lists of tasks.

## Today
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.
The current time is ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}.`;

/** Fire-and-forget: process pending sync queue after AI tool calls */
async function triggerSyncQueue(req: Request, cookieHeader: string | null) {
  try {
    const url = new URL("/api/sync/process-queue", req.url);
    fetch(url.toString(), {
      method: "POST",
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    }).catch(() => { /* fire-and-forget */ });
  } catch { /* ignore */ }
}

export async function POST(req: Request) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const token = await getToken({ template: "convex" });
    if (!token) return new Response("No Convex token", { status: 401 });

    const { messages } = await req.json();

    // Convert UI messages to AI SDK format, preserving tool call context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history: any[] = [];
    for (const m of (messages || [])) {
      if (m.role === "user") {
        const text = Array.isArray(m.parts)
          ? (m.parts as Array<{ type: string; text?: string }>)
              .filter((p: { type: string; text?: string }) => p.type === "text" && p.text)
              .map((p: { type: string; text?: string }) => p.text)
              .join("")
          : typeof m.content === "string" ? m.content : "";
        if (text) history.push({ role: "user", content: text });
      } else if (m.role === "assistant") {
        const text = Array.isArray(m.parts)
          ? (m.parts as Array<{ type: string; text?: string }>)
              .filter((p: { type: string; text?: string }) => p.type === "text" && p.text)
              .map((p: { type: string; text?: string }) => p.text)
              .join("")
          : typeof m.content === "string" ? m.content : "";

        // If this assistant message had tool calls, include them as a summary in the text
        // so the model has context about what it previously did
        const toolCalls = m.toolCalls as Array<{ toolName: string; input: unknown; output: unknown; error?: boolean }> | undefined;
        let fullText = text;
        if (toolCalls && toolCalls.length > 0) {
          const toolSummary = toolCalls.map((tc) => {
            const status = tc.error ? "FAILED" : "SUCCESS";
            const outputStr = tc.output ? JSON.stringify(tc.output) : "no output";
            return `[Tool: ${tc.toolName} → ${status}: ${outputStr}]`;
          }).join("\n");
          fullText = fullText
            ? `${toolSummary}\n\n${fullText}`
            : toolSummary;
        }

        if (fullText) history.push({ role: "assistant", content: fullText });
      }
    }

    const { model, providerOptions } = agentModel();
    const tools = createTools(token);

    // User preferences the agent should honour (scheduling notes, clock format).
    let prefsBlock = "";
    let showReasoning = false;
    try {
      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      convex.setAuth(token);
      const prefs = await convex.query(api.userPreferences.get, {});
      const s = mergeSettings(prefs?.prefs);
      const lines = [`- Communicate times in ${s.calendar.timeFormat === "24h" ? "24 hour" : "12 hour"} format.`, `- The user's week starts on ${["Sunday", "Monday", "", "", "", "", "Saturday"][s.calendar.weekStartsOn]}.`];
      if (s.ai.schedulingPreferences.trim()) lines.push(`- Scheduling preferences, in the user's words: ${s.ai.schedulingPreferences.trim()}`);
      if (s.ai.approval === "auto") lines.push("- Auto-approval is on: apply valid changes immediately without asking, except delete_task.");
      else lines.push("- Approval mode is ASK: before any create_task, update_task, complete_task or delete_task call, first reply with the exact change you intend and wait for the user to confirm. Only call write tools after an explicit yes in the conversation. Read-only tools need no confirmation.");
      showReasoning = s.ai.showReasoning;
      prefsBlock = "\n\nUSER PREFERENCES\n" + lines.join("\n");
    } catch { /* preferences are optional */ }

    // Let the AI SDK handle the full tool execution loop natively.
    // stepCountIs(10) allows up to 10 rounds of tool calls before forcing a text response.
    const result = await generateText({
      model,
      providerOptions,
      system: SYSTEM_PROMPT + prefsBlock,
      messages: history,
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(10),
    });

    // Collect all tool calls across all steps for the UI
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCallLog: Array<{ toolName: string; input: any; output: any; error?: boolean }> = [];
    let hadTaskToolCalls = false;

    for (const step of result.steps) {
      if (step.toolCalls) {
        for (let i = 0; i < step.toolCalls.length; i++) {
          const tc = step.toolCalls[i];
          const tr = step.toolResults?.[i];
          const output = tr?.output ?? null;
          const isError = output && typeof output === "object" && "error" in output;
          toolCallLog.push({
            toolName: tc.toolName,
            input: tc.input,
            output,
            error: isError || false,
          });
          if (["create_task", "update_task", "complete_task", "delete_task"].includes(tc.toolName)) {
            hadTaskToolCalls = true;
          }
        }
      }
    }

    // Fire-and-forget: process pending sync queue if task tools were used
    if (hadTaskToolCalls) {
      triggerSyncQueue(req, req.headers.get("cookie"));
    }

    return Response.json({
      text: result.text || "Done.",
      toolCalls: toolCallLog,
      reasoning: showReasoning ? result.reasoningText || undefined : undefined,
    });
  } catch (err) {
    console.error("AI chat error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error", text: "", toolCalls: [] },
      { status: 500 },
    );
  }
}
