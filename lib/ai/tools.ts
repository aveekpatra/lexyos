/**
 * AI Agent tools — executed server-side in the API route.
 * Each tool maps to Convex mutations/queries via ConvexHttpClient.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
// AI SDK v5+ renamed the tool schema key from `parameters` to `inputSchema`.
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { alignDateToRecurrence, describeRecurrence, normalizeRecurrence, shortRecurrenceLabel, type Recurrence } from "@/convex/lib/recurrence";
import { projectColumns, columnForTask, newColumnId, DEFAULT_COLUMNS, type BoardColumn } from "@/convex/lib/columns";

/** Column definitions from the agent (names, optional colour/status) into stored columns with ids. */
function buildColumns(input?: Array<{ name: string; status?: BoardColumn["status"] }>): BoardColumn[] | undefined {
  if (!input || input.length === 0) return undefined;
  const out: BoardColumn[] = [];
  for (const c of input) out.push({ id: newColumnId(c.name, out), name: c.name, status: c.status });
  return out;
}

// ─── Recurrence schema (mirrors convex/lib/recurrence.ts) ───
const weekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const recurrenceSchema = z.discriminatedUnion("freq", [
  z.object({
    freq: z.literal("daily"),
    interval: z.number().int().min(1).max(52).optional().describe("Every N days. Default 1."),
    until: z.string().optional().describe("Last date YYYY-MM-DD. Omit for forever."),
  }),
  z.object({
    freq: z.literal("weekly"),
    interval: z.number().int().min(1).max(52).optional().describe("Every N weeks. Default 1. Use 2 for fortnightly."),
    slots: z.array(z.object({
      day: weekdaySchema,
      start: z.string().optional().describe("HH:MM 24h. Omit to keep the task's own time."),
      end: z.string().optional().describe("HH:MM 24h. Needs start. Omit to keep the task's duration."),
    })).min(1).describe("One entry per weekday. Each day may have its own time, e.g. Mon 08:00 and Tue 18:00."),
    until: z.string().optional(),
  }),
  z.object({
    freq: z.literal("monthly"),
    interval: z.number().int().min(1).max(52).optional(),
    day: z.union([z.number().int().min(1).max(31), z.literal("last")]).optional().describe("Day of month. Omit to use the task's date."),
    until: z.string().optional(),
  }),
  z.object({
    freq: z.literal("yearly"),
    interval: z.number().int().min(1).max(52).optional(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    until: z.string().optional(),
  }),
]).describe(`Repeat rule. Examples:
- every day: {"freq":"daily"}
- weekdays: {"freq":"weekly","slots":[{"day":"mon"},{"day":"tue"},{"day":"wed"},{"day":"thu"},{"day":"fri"}]}
- Monday morning and Tuesday evening: {"freq":"weekly","slots":[{"day":"mon","start":"08:00","end":"09:00"},{"day":"tue","start":"18:00","end":"19:00"}]}
- every 2 weeks on Friday: {"freq":"weekly","interval":2,"slots":[{"day":"fri"}]}
- monthly on the 1st: {"freq":"monthly","day":1}
- yearly on the task's date: {"freq":"yearly"}
Completing a repeating task rolls it to the next occurrence and keeps a done copy for history.`);

// ─── Convex client setup ───
// We use ConvexHttpClient (not the React client) since this runs server-side.
// Auth token is injected per-request from Clerk.
/**
 * Who the tools act as. In the app the signed-in user's Clerk token. From the
 * MCP server an agent acting for a user: every call carries the shared
 * AGENT_SECRET plus that user's id, checked by convex/lib/actor.ts.
 */
export type ToolAuth = string | { agentFor: string };

function getConvex(auth: ToolAuth): ConvexHttpClient {
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  if (typeof auth === "string") {
    client.setAuth(auth);
    return client;
  }
  const secret = process.env.AGENT_SECRET;
  if (!secret) throw new Error("AGENT_SECRET is not set");
  const agent = { secret, userId: auth.agentFor };
  return {
    query: (fn: any, args: any) => client.query(fn, { ...(args ?? {}), agent }),
    mutation: (fn: any, args: any) => client.mutation(fn, { ...(args ?? {}), agent }),
  } as unknown as ConvexHttpClient;
}

// ─── Helper: get today's date in user's timezone ───
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Tool factory: creates tools that receive auth token at runtime ───
export function createTools(auth: ToolAuth): Record<string, any> {
  const convex = getConvex(auth);

  /** Wrap a tool execute fn so errors are returned as { error: "..." } instead of thrown.
   *  This ensures the model always sees a structured result and can react to failures. */
  function safe<T>(fn: (args: any) => Promise<T>) {
    return async (args: any): Promise<T | { error: string }> => {
      try {
        return await fn(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[AI Tool Error]", message);
        return { error: message };
      }
    };
  }

  /** A task reference as the model sends it: a Convex id, or a number like "#142" or "142". */
  async function taskId(ref: unknown): Promise<Id<"tasks">> {
    const m = /^#?(\d+)$/.exec(String(ref ?? "").trim());
    if (!m) return ref as Id<"tasks">;
    const task = await convex.query(api.tasks.getByNumber, { number: Number(m[1]) });
    if (!task) throw new Error(`No task #${m[1]}`);
    return task._id;
  }
  const num = (n: number | undefined) => (n === undefined ? undefined : `#${n}`);
  /** Closed without happening: status stays "done", so say so explicitly. */
  const missedInfo = (t: { outcome?: "missed"; missedReason?: string }) =>
    t.outcome === "missed" ? { missed: true, missedReason: t.missedReason } : {};

  /** A note reference: a note id, or its exact title. */
  async function noteId(ref: unknown): Promise<Id<"notes">> {
    const text = String(ref ?? "").trim().replace(/^\[\[|\]\]$/g, "");
    const byTitle = await convex.query(api.notes.byTitle, { title: text });
    return (byTitle?._id ?? text) as Id<"notes">;
  }

  return {
    // ═══════════════════════════════════════════
    // KNOWLEDGE TOOLS (notebooks, notes, the graph)
    // ═══════════════════════════════════════════

    list_notebooks: ({
      description: "List the user's notebooks (id, name, note count). Notebooks hold notes: long-form knowledge, plans and decisions.",
      inputSchema: z.object({}),
      execute: safe(async () => (await convex.query(api.notebooks.list, {})).map((b: any) => ({ id: b._id, name: b.name, notes: b.noteCount }))),
    }),

    search_notes: ({
      description: "Search notes by words in their title or text. Use it before answering questions or planning, to find what the user already wrote down.",
      inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(50).optional() }),
      execute: safe(async (args: any) => (await convex.query(api.notes.search, { query: args.query, limit: args.limit }))
        .map((n: any) => ({ id: n._id, title: n.title, snippet: n.snippet, updatedAt: new Date(n.updatedAt).toISOString() }))),
    }),

    get_note: ({
      description: "Read one note in full (by id or exact title), with everything connected to it: tasks and notes it mentions and that mention it, and its recent history.",
      inputSchema: z.object({ note: z.string().describe("Note id, or its exact title") }),
      execute: safe(async (args: any) => {
        const id = await noteId(args.note);
        const n = await convex.query(api.notes.get, { id });
        if (!n) return { error: "Note not found" };
        const related = await convex.query(api.graph.related, { kind: "note", id: n._id });
        const history = (await convex.query(api.notes.history, { id: n._id })).slice(-15);
        return { id: n._id, title: n.title, body: n.body, updatedAt: new Date(n.updatedAt).toISOString(), related, history };
      }),
    }),

    get_related: ({
      description: "Everything connected to a task (#142) or a note (id or title): mentions both ways and task links. Call it to gather context before acting on something.",
      inputSchema: z.object({ task: z.string().optional().describe("Task number like #142, or id"), note: z.string().optional().describe("Note id or exact title") }),
      execute: safe(async (args: any) => {
        if (args.task) return await convex.query(api.graph.related, { kind: "task", id: await taskId(args.task) });
        if (args.note) return await convex.query(api.graph.related, { kind: "note", id: await noteId(args.note) });
        return { error: "Give a task or a note" };
      }),
    }),

    list_notes: ({
      description: "List the notes in one notebook (id, title, snippet, last edit), newest edit first.",
      inputSchema: z.object({ notebookId: z.string() }),
      execute: safe(async (args: any) => (await convex.query(api.notes.list, { notebookId: args.notebookId as Id<"notebooks"> }))
        .map((n: any) => ({ id: n._id, title: n.title, snippet: n.snippet, updatedAt: new Date(n.updatedAt).toISOString() }))),
    }),

    create_notebook: ({
      description: "Create a notebook (a top-level collection of notes, like a Notion page or an Obsidian folder).",
      inputSchema: z.object({ name: z.string(), icon: z.string().optional().describe("Icon name from the project icon set, e.g. IoBook"), color: z.string().optional().describe("Hex colour") }),
      execute: safe(async (args: any) => ({ id: await convex.mutation(api.notebooks.create, { name: args.name, icon: args.icon, color: args.color }) })),
    }),

    delete_note: ({
      description: "Delete a note, with its history and links. Irreversible: ask the user first.",
      inputSchema: z.object({ note: z.string().describe("Note id or exact title") }),
      execute: safe(async (args: any) => { await convex.mutation(api.notes.remove, { id: await noteId(args.note) }); return { deleted: true }; }),
    }),

    connect: ({
      description: "Connect a task and a note, two notes, or two tasks as related, without editing their text. Use this whenever the user asks to link, relate or connect things. Never use subtasks or moves to express a relation.",
      inputSchema: z.object({
        task: z.string().optional().describe("Task number like #142"), note: z.string().optional().describe("Note id or exact title"),
        toTask: z.string().optional().describe("Other task, like #143"), toNote: z.string().optional().describe("Other note, id or exact title"),
      }),
      execute: safe(async (args: any) => {
        const from = args.task ? { kind: "task" as const, id: await taskId(args.task) } : args.note ? { kind: "note" as const, id: await noteId(args.note) } : null;
        const to = args.toTask ? { kind: "task" as const, id: await taskId(args.toTask) } : args.toNote ? { kind: "note" as const, id: await noteId(args.toNote) } : null;
        if (!from || !to) return { error: "Give one of task/note and one of toTask/toNote" };
        await convex.mutation(api.graph.connect, { fromKind: from.kind, fromId: from.id, toKind: to.kind, toId: to.id });
        return { connected: true };
      }),
    }),

    link_tasks: ({
      description: "Link two tasks as related (shown on both). Use when work depends on or relates to other work.",
      inputSchema: z.object({ task: z.string().describe("Task number like #142, or id"), to: z.string().describe("The other task's number like #143") }),
      execute: safe(async (args: any) => {
        const m = /^#?(\d+)$/.exec(String(args.to).trim());
        if (!m) return { error: "Give the other task as a number like #143" };
        await convex.mutation(api.tasks.link, { id: await taskId(args.task), number: Number(m[1]) });
        return { linked: true };
      }),
    }),

    unlink_tasks: ({
      description: "Remove the link between two tasks.",
      inputSchema: z.object({ task: z.string(), other: z.string() }),
      execute: safe(async (args: any) => {
        await convex.mutation(api.tasks.unlink, { id: await taskId(args.task), otherId: await taskId(args.other) });
        return { unlinked: true };
      }),
    }),

    get_note_history: ({
      description: "A note's full story (created, renamed, moved, edited, linked) and its saved versions, to see how thinking changed over time.",
      inputSchema: z.object({ note: z.string().describe("Note id or exact title"), withVersions: z.boolean().optional() }),
      execute: safe(async (args: any) => {
        const id = await noteId(args.note);
        const story = (await convex.query(api.notes.history, { id }))
          .map((e: any) => ({ at: new Date(e.at).toISOString(), by: e.actor, change: e.field, from: e.from, to: e.to }));
        const versions = args.withVersions ? (await convex.query(api.notes.revisions, { id })).map((r: any) => ({ at: new Date(r.at).toISOString(), title: r.title, body: r.body })) : undefined;
        return { story, versions };
      }),
    }),

    create_note: ({
      description: "Write a new note in a notebook, in Markdown. Mention tasks as #142 and other notes as [[Note title]] to link them into the user's knowledge.",
      inputSchema: z.object({ notebookId: z.string(), title: z.string(), body: z.string() }),
      execute: safe(async (args: any) => ({ id: await convex.mutation(api.notes.create, { notebookId: args.notebookId as Id<"notebooks">, title: args.title, body: args.body }) })),
    }),

    update_note: ({
      description: "Change a note's title or replace its body (Markdown). To add to a note, read it with get_note and send the whole new body.",
      inputSchema: z.object({ note: z.string().describe("Note id or exact title"), title: z.string().optional(), body: z.string().optional() }),
      execute: safe(async (args: any) => {
        await convex.mutation(api.notes.update, { id: await noteId(args.note), title: args.title, body: args.body });
        return { updated: true };
      }),
    }),

    // ═══════════════════════════════════════════
    // TASK TOOLS
    // ═══════════════════════════════════════════

    list_tasks: ({
      description: `List tasks with optional filters. Returns task id, number (#142, stable, what the user sees), title, status, priority, dueDate, dueTime, scheduledStartTime, scheduledEndTime, projectId, source. Use this to answer questions about the user's tasks, what's planned, what's overdue, etc.`,
      inputSchema: z.object({
        status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional()
          .describe("Filter by status"),
        projectId: z.string().optional()
          .describe("Filter by project ID"),
        source: z.enum(["local", "google_calendar"]).optional()
          .describe("Filter by source: 'local' for user-created tasks, 'google_calendar' for synced events"),
      }),
      execute: safe(async (args: any) => {
        const tasks = await convex.query(api.tasks.list, {
          status: args.status as "todo" | "planned" | "in_progress" | "review" | "done" | undefined,
          projectId: args.projectId as Id<"projects"> | undefined,
          source: args.source as "local" | "google_calendar" | undefined,
        });
        return tasks.map((t) => ({
          id: t._id,
          number: num(t.number),
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          startTime: t.scheduledStartTime,
          endTime: t.scheduledEndTime,
          projectId: t.projectId,
          source: t.source,
          description: t.description,
          ...missedInfo(t),
          repeats: (() => {
            const r = normalizeRecurrence(t.recurrence, t.dueDate);
            return r ? shortRecurrenceLabel(r) : undefined;
          })(),
        }));
      }),
    }),

    get_task: ({
      description: `One task in full: every property, its description (the task's own context), its subtasks, everything connected to it (linked tasks, notes that mention it or that it mentions), and its recent story (moves, reschedules, completions). Use it to read state after a write, and before editing a task you did not just fetch.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to retrieve (a task id, or its number such as #142)"),
      }),
      execute: safe(async (args: any) => {
        const task = await convex.query(api.tasks.getById, { id: await taskId(args.id) });
        if (!task) return { error: "Task not found" };
        const subtasks = await convex.query(api.tasks.getSubtasks, { parentTaskId: task._id });
        const connections = await convex.query(api.graph.related, { kind: "task", id: task._id });
        const story = (await convex.query(api.tasks.history, { id: task._id })).slice(-20)
          .map((e: any) => ({ at: new Date(e.at).toISOString(), by: e.actor, change: e.field, from: e.from, to: e.to }));
        return {
          connections,
          story,
          id: task._id,
          number: num(task.number),
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          startTime: task.scheduledStartTime,
          endTime: task.scheduledEndTime,
          projectId: task.projectId,
          columnId: task.columnId,
          parentTaskId: task.parentTaskId,
          labels: task.labels,
          source: task.source,
          description: task.description,
          googleEventId: task.googleEventId,
          ...missedInfo(task),
          subtasks: subtasks.map((s) => ({ id: s._id, number: num(s.number), title: s.title, status: s.status, priority: s.priority, dueDate: s.dueDate, dueTime: s.dueTime, description: s.description })),
          repeats: (() => {
            const r = normalizeRecurrence(task.recurrence, task.dueDate);
            return r ? describeRecurrence(r, task.dueDate) : undefined;
          })(),
        };
      }),
    }),

    create_task: ({
      description: `Create a new task. Always set a dueDate (defaults to today if not specified). Set priority to p1 (urgent), p2 (high), p3 (medium/default), or p4 (low). If the user mentions a time, set dueTime in HH:MM format. If they mention a project, look up the project ID first with list_projects.`,
      inputSchema: z.object({
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description/notes"),
        dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format. Defaults to today."),
        dueTime: z.string().optional().describe("Due time in HH:MM 24h format (e.g. '14:30')"),
        priority: z.enum(["p1", "p2", "p3", "p4"]).optional().describe("Priority: p1=urgent, p2=high, p3=medium, p4=low"),
        status: z.enum(["todo", "planned", "in_progress", "review"]).optional().describe("Initial status"),
        projectId: z.string().optional().describe("Project ID to assign to"),
        columnId: z.string().optional().describe("Board column id inside the project (see get_project). Defaults to the column matching status."),
        parentTaskId: z.string().optional().describe("Make this a subtask of that task"),
        labels: z.array(z.string()).optional().describe("Free-form labels"),
        scheduledDate: z.string().optional().describe("Day it is scheduled on (YYYY-MM-DD) when different from dueDate"),
        scheduledStartTime: z.string().optional().describe("Start time in HH:MM format"),
        scheduledEndTime: z.string().optional().describe("End time in HH:MM format"),
        location: z.string().optional().describe("Where it happens; shown on the task and pushed to the calendar event"),
        isAllDay: z.boolean().optional().describe("true for an all-day item with no clock time"),
        recurrence: recurrenceSchema.optional(),
      }),
      execute: safe(async (args: any) => {
        const requestedDate = args.dueDate || today();
        // The repeat rule owns the day. Mirror the server's reconciliation so
        // the date reported back is the date actually stored.
        const dueDate = args.recurrence
          ? alignDateToRecurrence(args.recurrence as Recurrence, requestedDate)
          : requestedDate;
        const dueTime = args.dueTime || args.scheduledStartTime;
        const id = await convex.mutation(api.tasks.create, {
          title: args.title,
          description: args.description,
          dueDate,
          dueTime,
          priority: args.priority as "p1" | "p2" | "p3" | "p4" | undefined,
          status: args.status as "todo" | "planned" | "in_progress" | "review" | undefined,
          projectId: args.projectId as Id<"projects"> | undefined,
          columnId: args.columnId,
          parentTaskId: args.parentTaskId ? await taskId(args.parentTaskId) : undefined,
          labels: args.labels,
          scheduledDate: args.scheduledDate,
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
          location: args.location,
          isAllDay: args.isAllDay,
          recurrence: args.recurrence as Recurrence | undefined,
          userDate: today(),
        });

        // Enqueue Google Calendar sync (processed asynchronously)
        try {
          await convex.mutation(api.syncQueue.enqueue, {
            taskId: id as Id<"tasks">,
            action: "push",
          });
        } catch (err) {
          console.warn("[AI] Failed to enqueue sync:", err);
        }

        const created = await convex.query(api.tasks.getById, { id: id as Id<"tasks"> });
        return {
          id, number: num(created?.number), title: args.title, dueDate, created: true,
          repeats: args.recurrence ? describeRecurrence(args.recurrence, dueDate) : undefined,
          ...(dueDate !== requestedDate
            ? { movedFrom: requestedDate, note: `dueDate moved from ${requestedDate} to ${dueDate}, the first day the repeat rule lands on. Tell the user.` }
            : {}),
        };
      }),
    }),

    update_task: ({
      description: `Update an existing task. Only include the fields you want to change. Use this for rescheduling, changing priority, renaming, adding descriptions, moving to a project, etc.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to update (a task id, or its number such as #142)"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        dueDate: z.string().optional().describe("New due date (YYYY-MM-DD)"),
        dueTime: z.string().optional().describe("New due time (HH:MM)"),
        priority: z.enum(["p1", "p2", "p3", "p4"]).optional().describe("New priority"),
        status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional().describe("New status"),
        projectId: z.string().optional().describe("Move to this project (use 'none' to remove from project)"),
        scheduledStartTime: z.string().optional().describe("Start time (HH:MM)"),
        scheduledEndTime: z.string().optional().describe("End time (HH:MM)"),
        recurrence: recurrenceSchema.optional().describe("Set or replace the repeat rule"),
        clearRecurrence: z.boolean().optional().describe("true to stop the task repeating"),
        columnId: z.string().optional().describe("Move to this board column (use 'none' to fall back to the status column)"),
        parentTaskId: z.string().optional().describe("Make it a subtask of that task (use 'none' to detach). ONLY to split one piece of work into parts. To relate tasks use link_tasks; to relate a task and a note use connect."),
        labels: z.array(z.string()).optional().describe("Replace labels"),
        scheduledDate: z.string().optional().describe("YYYY-MM-DD"),
        location: z.string().optional().describe("Where it happens"),
        isAllDay: z.boolean().optional().describe("true for an all-day item with no clock time"),
        position: z.enum(["top", "bottom"]).optional().describe("Move it to the top or bottom of its list or board column"),
        clearDueDate: z.boolean().optional().describe("Remove the date. Only tasks in a project may be undated; an inbox task gets today instead"),
        clearDueTime: z.boolean().optional().describe("Make it all-day"),
        clearScheduledStartTime: z.boolean().optional().describe("Remove the start time"),
        clearScheduledEndTime: z.boolean().optional().describe("Remove the end time, leaving an open-ended block"),
        clearDescription: z.boolean().optional().describe("Empty the description"),
        clearLabels: z.boolean().optional().describe("Remove all labels"),
        clearLocation: z.boolean().optional().describe("Remove the location"),
      }),
      execute: safe(async (args: any) => {
        args = { ...args, id: await taskId(args.id) };
        if (args.parentTaskId && args.parentTaskId !== "none") args.parentTaskId = await taskId(args.parentTaskId);
        const updateArgs: Record<string, unknown> = { id: args.id };
        if (args.columnId === "none") updateArgs.clearColumnId = true; else if (args.columnId) updateArgs.columnId = args.columnId;
        if (args.parentTaskId === "none") updateArgs.clearParentTaskId = true; else if (args.parentTaskId) updateArgs.parentTaskId = args.parentTaskId;
        if (args.labels) updateArgs.labels = args.labels;
        if (args.scheduledDate) updateArgs.scheduledDate = args.scheduledDate;
        if (args.clearDueDate) { updateArgs.clearDueDate = true; updateArgs.userDate = today(); }
        if (args.clearDueTime) updateArgs.clearDueTime = true;
        for (const f of ["clearScheduledStartTime", "clearScheduledEndTime", "clearDescription", "clearLabels", "clearLocation"]) if (args[f]) updateArgs[f] = true;
        if (args.location !== undefined) updateArgs.location = args.location;
        if (args.isAllDay !== undefined) updateArgs.isAllDay = args.isAllDay;
        if (args.clearRecurrence) updateArgs.clearRecurrence = true;
        else if (args.recurrence) updateArgs.recurrence = args.recurrence;
        if (args.title) updateArgs.title = args.title;
        if (args.description !== undefined) updateArgs.description = args.description;
        if (args.dueDate) updateArgs.dueDate = args.dueDate;
        if (args.dueTime) updateArgs.dueTime = args.dueTime;
        if (args.priority) updateArgs.priority = args.priority;
        if (args.status) updateArgs.status = args.status;
        if (args.projectId === "none") {
          updateArgs.clearProjectId = true;
        } else if (args.projectId) {
          updateArgs.projectId = args.projectId;
        }
        if (args.scheduledStartTime) updateArgs.scheduledStartTime = args.scheduledStartTime;
        if (args.scheduledEndTime) updateArgs.scheduledEndTime = args.scheduledEndTime;
        // Ordering is a sortOrder against its neighbours, so resolve "top" and
        // "bottom" against the list the task is actually landing in.
        if (args.position) {
          const before = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });
          const targetProject = (args.projectId && args.projectId !== "none" ? args.projectId : before?.projectId) as Id<"projects"> | undefined;
          const siblings = await convex.query(api.tasks.list, targetProject ? { projectId: targetProject } : {});
          if (siblings.length > 0) {
            const orders = siblings.map((t) => t.sortOrder);
            updateArgs.sortOrder = args.position === "top" ? Math.min(...orders) - 1 : Math.max(...orders) + 1;
          }
        }

        await convex.mutation(api.tasks.update, updateArgs as Parameters<typeof convex.mutation<typeof api.tasks.update>>[1]);

        // Enqueue Google Calendar sync (processed asynchronously)
        try {
          await convex.mutation(api.syncQueue.enqueue, {
            taskId: args.id as Id<"tasks">,
            action: "update",
            payload: { title: args.title, dueDate: args.dueDate, dueTime: args.dueTime },
          });
        } catch (err) {
          console.warn("[AI] Failed to enqueue sync:", err);
        }

        // Read back: the server reconciles dueDate against the repeat rule, so
        // the stored row is the only honest thing to report.
        const after = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });
        const rec = after ? normalizeRecurrence(after.recurrence, after.dueDate) : undefined;
        return {
          id: args.id, number: num(after?.number), updated: true,
          dueDate: after?.dueDate,
          dueTime: after?.dueTime,
          repeats: rec ? describeRecurrence(rec, after?.dueDate) : undefined,
          ...(args.dueDate && after?.dueDate && after.dueDate !== args.dueDate
            ? { movedFrom: args.dueDate, note: `dueDate moved from ${args.dueDate} to ${after.dueDate}, the first day the repeat rule lands on. Tell the user.` }
            : {}),
        };
      }),
    }),

    complete_task: ({
      description: `Mark a task as done (or toggle it back to todo if already done). Use when the user says they finished something, completed a task, or want to mark it done. For a repeating task this does NOT mark it done: it records a done copy and moves the task to its next occurrence; the result tells you the new date.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to complete (a task id, or its number such as #142)"),
      }),
      execute: safe(async (args: any) => {
        args = { ...args, id: await taskId(args.id) };
        const result = await convex.mutation(api.tasks.toggleComplete, { id: args.id as Id<"tasks">, userDate: today() });

        // Enqueue Google Calendar sync to update [Done] prefix
        try {
          await convex.mutation(api.syncQueue.enqueue, {
            taskId: args.id as Id<"tasks">,
            action: "update",
            payload: { statusToggle: true },
          });
        } catch (err) {
          console.warn("[AI] Failed to enqueue sync:", err);
        }

        if (result.rolled && result.next) {
          return { id: args.id, completed: true, repeats: true, nextDate: result.next.date, nextStart: result.next.start, nextEnd: result.next.end };
        }
        return { id: args.id, toggled: true };
      }),
    }),

    mark_missed: ({
      description: `Close a task as missed: it did not happen and should not be carried to another day. It leaves Overdue and stays on its date as a record, with an optional short reason (what got in the way) that you and the user can read later. For a repeating task it records the missed occurrence and moves the task to its next one, like complete_task. Use it when the user says they did not or could not do something and does not want it rescheduled. Calling it on an already-missed task revises the reason. To undo, call complete_task on it (that reopens it).`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to mark missed (a task id, or its number such as #142)"),
        reason: z.string().optional().describe("Why it did not happen, in the user's words. Short."),
      }),
      execute: safe(async (args: any) => {
        const id = await taskId(args.id);
        const before = await convex.query(api.tasks.getById, { id });
        const result = await convex.mutation(api.tasks.markMissed, { id, reason: args.reason, userDate: today() });
        try {
          await convex.mutation(api.syncQueue.enqueue, { taskId: id, action: "update", payload: { statusToggle: true } });
        } catch (err) {
          console.warn("[AI] Failed to enqueue sync:", err);
        }
        if (result.rolled && result.next) {
          return { id, number: num(before?.number), missed: true, repeats: true, nextDate: result.next.date, nextStart: result.next.start, nextEnd: result.next.end };
        }
        return { id, number: num(before?.number), missed: true, reason: args.reason };
      }),
    }),

    delete_task: ({
      description: `Permanently delete a task. IMPORTANT: This is irreversible — confirm with the user BEFORE calling this tool. Don't use this for completing tasks — use complete_task instead.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to delete (a task id, or its number such as #142)"),
      }),
      execute: safe(async (args: any) => {
        args = { ...args, id: await taskId(args.id) };
        // Fetch task before deleting to get Google event ID for the sync queue
        const taskBefore = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });

        // Enqueue Google Calendar delete before removing the task
        if (taskBefore?.googleEventId) {
          try {
            await convex.mutation(api.syncQueue.enqueue, {
              taskId: args.id as Id<"tasks">,
              action: "delete",
              payload: {
                googleEventId: taskBefore.googleEventId,
                googleCalendarId: taskBefore.googleCalendarId || "primary",
              },
            });
          } catch (err) {
            console.warn("[AI] Failed to enqueue delete sync:", err);
          }
        }

        await convex.mutation(api.tasks.remove, { id: args.id as Id<"tasks"> });
        return { id: args.id, deleted: true };
      }),
    }),

    search_tasks: ({
      description: `Find tasks by text in title or description, or by number ("#142"). Fast and cheap: call it before creating anything, so you reuse or update an existing task instead of duplicating it. Scope with projectId when the work belongs to a project. Returns up to 15 matches with a description snippet and subtask count.`,
      inputSchema: z.object({
        query: z.string().describe("Text to match against title and description (case-insensitive)"),
        projectId: z.string().optional().describe("Only search inside this project"),
        includeDone: z.boolean().optional().describe("Include completed tasks. Default false."),
      }),
      execute: safe(async (args: any) => {
        const all = await convex.query(api.tasks.list, args.projectId ? { projectId: args.projectId as Id<"projects"> } : {});
        const q = String(args.query).toLowerCase();
        const byNumber = /^#?(\d+)$/.exec(q.trim());
        const pool = all.filter((t) => args.includeDone || t.status !== "done");
        const matches = byNumber
          ? all.filter((t) => t.number === Number(byNumber[1]))
          : pool.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
        const children = new Map<string, number>();
        for (const t of all) if (t.parentTaskId) children.set(t.parentTaskId, (children.get(t.parentTaskId) ?? 0) + 1);
        return matches.slice(0, 15).map((t) => ({
          id: t._id, number: num(t.number), title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime,
          projectId: t.projectId, columnId: t.columnId, parentTaskId: t.parentTaskId,
          descriptionSnippet: t.description ? t.description.slice(0, 160) : undefined,
          ...missedInfo(t),
          subtasks: children.get(t._id) ?? 0,
        }));
      }),
    }),

    // ═══════════════════════════════════════════
    // PROJECT TOOLS
    // ═══════════════════════════════════════════

    list_projects: ({
      description: `List projects with their id, name, colour, priority, dates, one-line description, board columns, and open/done counts. Use it to resolve a project name to an id. For planning inside a project, follow up with get_project.`,
      inputSchema: z.object({
        includeArchived: z.boolean().optional().describe("Also return archived projects. Default false."),
      }),
      execute: safe(async (args: any) => {
        const projects = await convex.query(api.projects.list, args.includeArchived ? {} : { status: "active" });
        const tasks = await convex.query(api.tasks.list, {});
        return projects.map((p) => {
          const mine = tasks.filter((t) => t.projectId === p._id && !t.parentTaskId);
          return {
            id: p._id, name: p.name, description: p.description, color: p.color, priority: p.priority, status: p.status,
            startDate: p.startDate, dueDate: p.dueDate,
            columns: projectColumns(p).map((c) => ({ id: c.id, name: c.name, status: c.status })),
            open: mine.filter((t) => t.status !== "done").length, done: mine.filter((t) => t.status === "done" && t.outcome !== "missed").length, missed: mine.filter((t) => t.outcome === "missed").length,
            hasContext: !!p.notes,
          };
        });
      }),
    }),

    get_project: ({
      description: `Everything about one project in a single call: its fields, the Context document (goals, links, decisions, constraints, in the user's words), the board columns, and every task grouped by column with description and subtasks. Call this ONCE before planning, adding, or reorganising work inside a project; it is the long-horizon context. Do not paginate through tasks separately.`,
      inputSchema: z.object({
        id: z.string().describe("Project id (from list_projects)"),
        includeDone: z.boolean().optional().describe("Include completed tasks in the board. Default false."),
      }),
      execute: safe(async (args: any) => {
        const p = await convex.query(api.projects.getById, { id: args.id as Id<"projects"> });
        if (!p) return { error: "Project not found" };
        const tasks = await convex.query(api.tasks.list, { projectId: p._id });
        const columns = projectColumns(p);
        const subs = new Map<string, typeof tasks>();
        for (const t of tasks) if (t.parentTaskId) { const arr = subs.get(t.parentTaskId) ?? []; arr.push(t); subs.set(t.parentTaskId, arr); }
        const shape = (t: (typeof tasks)[number]) => ({
          id: t._id, number: num(t.number), title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime,
          startTime: t.scheduledStartTime, endTime: t.scheduledEndTime, description: t.description,
          ...missedInfo(t),
          repeats: (() => { const r = normalizeRecurrence(t.recurrence, t.dueDate); return r ? shortRecurrenceLabel(r) : undefined; })(),
        });
        const board = columns.map((c) => ({
          column: { id: c.id, name: c.name, status: c.status },
          tasks: tasks
            .filter((t) => !t.parentTaskId && (args.includeDone || t.status !== "done") && columnForTask(t, columns).id === c.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((t) => ({ ...shape(t), subtasks: (subs.get(t._id) ?? []).map(shape) })),
        }));
        return {
          id: p._id, name: p.name, description: p.description, status: p.status, priority: p.priority, color: p.color,
          startDate: p.startDate, dueDate: p.dueDate, tags: p.tags,
          context: p.notes ?? "",
          columns: columns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
          board,
          counts: { open: tasks.filter((t) => !t.parentTaskId && t.status !== "done").length, done: tasks.filter((t) => !t.parentTaskId && t.status === "done" && t.outcome !== "missed").length, missed: tasks.filter((t) => !t.parentTaskId && t.outcome === "missed").length },
        };
      }),
    }),

    create_project: ({
      description: `Create a project. Give it a one-line description and, when the user has said anything about goals, constraints, links or decisions, put that in context (markdown). Columns default to Todo, Planned, In Progress, Review, Done; pass columns to define a custom board (names in order; a column may map to a status so completing works).`,
      inputSchema: z.object({
        name: z.string().describe("Project name"),
        description: z.string().optional().describe("One line on what the project is for"),
        context: z.string().optional().describe("Markdown: goals, links, decisions, constraints, people"),
        color: z.string().optional().describe("Hex colour, e.g. #3b82f6"),
        priority: z.enum(["p1", "p2", "p3", "p4"]).optional().describe("p1 urgent, p2 high, p3 medium, p4 low"),
        startDate: z.string().optional().describe("YYYY-MM-DD"),
        dueDate: z.string().optional().describe("YYYY-MM-DD"),
        icon: z.string().optional().describe("Icon name shown next to the project"),
        client: z.string().optional().describe("Who the work is for"),
        tags: z.array(z.string()).optional().describe("Free-form tags"),
        columns: z.array(z.object({
          name: z.string(),
          status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional().describe("Status a task takes in this column. Give exactly one column status 'done' if you want completion to land somewhere."),
        })).optional().describe("Custom board columns in order. Omit for the default template."),
      }),
      execute: safe(async (args: any) => {
        const columns = buildColumns(args.columns);
        const id = await convex.mutation(api.projects.create, {
          name: args.name, description: args.description, notes: args.context,
          color: args.color || "#3b82f6", priority: args.priority,
          startDate: args.startDate, dueDate: args.dueDate, columns,
          icon: args.icon, client: args.client, tags: args.tags,
        });
        return { id, name: args.name, created: true, columns: (columns ?? DEFAULT_COLUMNS).map((c) => ({ id: c.id, name: c.name })) };
      }),
    }),

    update_project: ({
      description: `Update a project's fields. Use context to rewrite the Context document (send the full new markdown, not a diff). Use set_project_columns to change the board.`,
      inputSchema: z.object({
        id: z.string().describe("Project id"),
        name: z.string().optional(),
        description: z.string().optional().describe("One-line description"),
        context: z.string().optional().describe("Full replacement markdown for the Context document"),
        color: z.string().optional(),
        priority: z.enum(["p1", "p2", "p3", "p4"]).optional(),
        status: z.enum(["active", "archived"]).optional().describe("'archived' shelves the project without deleting it"),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
        icon: z.string().optional(),
        client: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Replaces the whole tag list"),
      }),
      execute: safe(async (args: any) => {
        const patch: Record<string, unknown> = { id: args.id };
        for (const k of ["name", "description", "color", "priority", "status", "startDate", "dueDate", "icon", "client", "tags"]) if (args[k] !== undefined) patch[k] = args[k];
        if (args.context !== undefined) patch.notes = args.context;
        await convex.mutation(api.projects.update, patch as Parameters<typeof convex.mutation<typeof api.projects.update>>[1]);
        // Read back so the agent reports what was stored, not what it sent.
        const after = await convex.query(api.projects.getById, { id: args.id as Id<"projects"> });
        return {
          id: args.id, updated: true,
          name: after?.name, description: after?.description, status: after?.status,
          context: after?.notes ?? "",
        };
      }),
    }),

    set_project_columns: ({
      description: `Replace a project's board columns (rename, reorder, add, remove). Send the complete list in order. Keep an existing column's id to preserve which tasks sit in it; new columns get an id from their name. Tasks in a removed column fall back to the column matching their status.`,
      inputSchema: z.object({
        projectId: z.string(),
        columns: z.array(z.object({
          id: z.string().optional().describe("Existing column id to keep; omit for a new column"),
          name: z.string(),
          status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional(),
        })).min(1),
      }),
      execute: safe(async (args: any) => {
        const p = await convex.query(api.projects.getById, { id: args.projectId as Id<"projects"> });
        if (!p) return { error: "Project not found" };
        const existing = projectColumns(p);
        const out: BoardColumn[] = [];
        for (const c of args.columns as Array<{ id?: string; name: string; status?: BoardColumn["status"] }>) {
          const prev = c.id ? existing.find((e) => e.id === c.id) : undefined;
          out.push({ id: prev?.id ?? newColumnId(c.name, [...existing, ...out]), name: c.name, status: c.status ?? prev?.status });
        }
        await convex.mutation(api.projects.setColumns, { id: p._id, columns: out });
        return { projectId: p._id, columns: out.map((c) => ({ id: c.id, name: c.name, status: c.status })), updated: true };
      }),
    }),

    delete_project: ({
      description: `Permanently delete a project. IMPORTANT: This is irreversible — confirm with the user BEFORE calling this tool. Its tasks are NOT deleted: they are detached and fall back to the inbox. To keep a project but take it out of the way, prefer update_project with status 'archived' instead.`,
      inputSchema: z.object({
        id: z.string().describe("Project id (from list_projects)"),
      }),
      execute: safe(async (args: any) => {
        // Read first: after the delete there is nothing left to report from.
        const p = await convex.query(api.projects.getById, { id: args.id as Id<"projects"> });
        if (!p) return { error: "Project not found" };
        const tasks = await convex.query(api.tasks.list, { projectId: p._id });
        await convex.mutation(api.projects.remove, { id: p._id });
        return { id: p._id, name: p.name, deleted: true, tasksDetached: tasks.length };
      }),
    }),


    // ═══════════════════════════════════════════
    // INTELLIGENCE TOOLS
    // ═══════════════════════════════════════════

    get_today_summary: ({
      description: `Get a summary of today's schedule: overdue tasks, today's tasks, calendar events, and upcoming deadlines this week. Use this when the user asks "what's on my plate", "what do I have today", "give me a rundown", etc.`,
      inputSchema: z.object({}),
      execute: safe(async (_args: any) => {
        const allTasks = await convex.query(api.tasks.list, {});
        const todayStr = today();

        const overdue = allTasks.filter((t) =>
          t.source !== "google_calendar" &&
          t.status !== "done" &&
          t.dueDate && t.dueDate < todayStr
        );

        const todayTasks = allTasks.filter((t) =>
          t.status !== "done" &&
          t.dueDate === todayStr
        );

        // Upcoming week
        const weekEnd = new Date();
        weekEnd.setDate(weekEnd.getDate() + 7);
        const weekEndStr = weekEnd.toISOString().slice(0, 10);

        const upcoming = allTasks.filter((t) =>
          t.status !== "done" &&
          t.dueDate && t.dueDate > todayStr && t.dueDate <= weekEndStr
        );

        return {
          today: todayStr,
          overdueCount: overdue.length,
          overdueTasks: overdue.slice(0, 5).map((t) => ({ id: t._id, number: num(t.number), title: t.title, dueDate: t.dueDate, priority: t.priority })),
          todayCount: todayTasks.length,
          todayTasks: todayTasks.map((t) => ({
            id: t._id,
            number: num(t.number),
            title: t.title,
            dueTime: t.dueTime,
            startTime: t.scheduledStartTime,
            endTime: t.scheduledEndTime,
            priority: t.priority,
            source: t.source,
          })),
          upcomingThisWeek: upcoming.length,
          upcomingTasks: upcoming.slice(0, 10).map((t) => ({ id: t._id, number: num(t.number), title: t.title, dueDate: t.dueDate, priority: t.priority })),
          // What did not happen lately, and why, so plans can account for it.
          missedLastWeek: (() => {
            const from = new Date(); from.setDate(from.getDate() - 7);
            const fromStr = from.toISOString().slice(0, 10);
            return allTasks
              .filter((t) => t.outcome === "missed" && (t.dueDate || "") >= fromStr && (t.dueDate || "") <= todayStr)
              .map((t) => ({ id: t._id, number: num(t.number), title: t.title, date: t.dueDate, reason: t.missedReason, series: t.seriesId }));
          })(),
        };
      }),
    }),

    plan_day: ({
      description: `Get all tasks and events for a specific date, organized by time. Use when the user asks to plan a day, see their schedule, or wants a time-blocked view.`,
      inputSchema: z.object({
        date: z.string().optional().describe("Date to plan (YYYY-MM-DD). Defaults to today."),
      }),
      execute: safe(async (args: any) => {
        const dateStr = args.date || today();
        const allTasks = await convex.query(api.tasks.list, {});

        const dayTasks = allTasks
          .filter((t) => t.dueDate === dateStr || t.scheduledDate === dateStr)
          .sort((a, b) => {
            const aTime = a.scheduledStartTime || a.dueTime || "23:59";
            const bTime = b.scheduledStartTime || b.dueTime || "23:59";
            return aTime.localeCompare(bTime);
          });

        const scheduled = dayTasks.filter((t) => t.scheduledStartTime);
        const unscheduled = dayTasks.filter((t) => !t.scheduledStartTime);

        // Find free slots
        const slots: { start: string; end: string }[] = [];
        const busyBlocks = scheduled
          .filter((t) => t.scheduledStartTime && t.scheduledEndTime)
          .map((t) => ({ start: t.scheduledStartTime!, end: t.scheduledEndTime! }))
          .sort((a, b) => a.start.localeCompare(b.start));

        let cursor = "09:00";
        for (const block of busyBlocks) {
          if (block.start > cursor) {
            slots.push({ start: cursor, end: block.start });
          }
          if (block.end > cursor) cursor = block.end;
        }
        if (cursor < "18:00") {
          slots.push({ start: cursor, end: "18:00" });
        }

        return {
          date: dateStr,
          totalTasks: dayTasks.length,
          scheduled: scheduled.map((t) => ({
            id: t._id, number: num(t.number), title: t.title, start: t.scheduledStartTime, end: t.scheduledEndTime, source: t.source, status: t.status,
          })),
          unscheduled: unscheduled.map((t) => ({
            id: t._id, number: num(t.number), title: t.title, priority: t.priority, status: t.status,
          })),
          freeSlots: slots,
        };
      }),
    }),

    find_free_time: ({
      description: `Find free time slots on a given date. Use when the user asks "when am I free", "find me a slot", "when can I schedule X". Returns available time blocks between 9am-6pm.`,
      inputSchema: z.object({
        date: z.string().describe("Date to check (YYYY-MM-DD)"),
        durationMinutes: z.number().optional().describe("Minimum slot duration in minutes (default: 30)"),
      }),
      execute: safe(async (args: any) => {
        const allTasks = await convex.query(api.tasks.list, {});
        const minDuration = args.durationMinutes || 30;

        const dayTasks = allTasks.filter((t) =>
          (t.dueDate === args.date || t.scheduledDate === args.date) &&
          t.scheduledStartTime && t.scheduledEndTime
        );

        const busy = dayTasks
          .map((t) => ({ start: t.scheduledStartTime!, end: t.scheduledEndTime!, title: t.title }))
          .sort((a, b) => a.start.localeCompare(b.start));

        const slots: { start: string; end: string; durationMinutes: number }[] = [];
        let cursor = "09:00";

        for (const block of busy) {
          if (block.start > cursor) {
            const [ch, cm] = cursor.split(":").map(Number);
            const [bh, bm] = block.start.split(":").map(Number);
            const dur = (bh * 60 + bm) - (ch * 60 + cm);
            if (dur >= minDuration) {
              slots.push({ start: cursor, end: block.start, durationMinutes: dur });
            }
          }
          if (block.end > cursor) cursor = block.end;
        }
        if (cursor < "18:00") {
          const [ch, cm] = cursor.split(":").map(Number);
          const dur = (18 * 60) - (ch * 60 + cm);
          if (dur >= minDuration) {
            slots.push({ start: cursor, end: "18:00", durationMinutes: dur });
          }
        }

        return {
          date: args.date,
          busyBlocks: busy,
          freeSlots: slots,
          totalFreeMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0),
        };
      }),
    }),
  };
}
