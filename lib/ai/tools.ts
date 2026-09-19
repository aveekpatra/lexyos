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
import { describeRecurrence, normalizeRecurrence, shortRecurrenceLabel, type Recurrence } from "@/convex/lib/recurrence";
import { projectColumns, columnForTask, newColumnId, DEFAULT_COLUMNS, COLUMN_PALETTE, type BoardColumn } from "@/convex/lib/columns";

/** Column definitions from the agent (names, optional colour/status) into stored columns with ids. */
function buildColumns(input?: Array<{ name: string; color?: string; status?: BoardColumn["status"] }>): BoardColumn[] | undefined {
  if (!input || input.length === 0) return undefined;
  const out: BoardColumn[] = [];
  for (const c of input) out.push({ id: newColumnId(c.name, out), name: c.name, color: c.color ?? COLUMN_PALETTE[out.length % COLUMN_PALETTE.length], status: c.status });
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

  return {
    // ═══════════════════════════════════════════
    // TASK TOOLS
    // ═══════════════════════════════════════════

    list_tasks: ({
      description: `List tasks with optional filters. Returns task id, title, status, priority, dueDate, dueTime, scheduledStartTime, scheduledEndTime, projectId, source. Use this to answer questions about the user's tasks, what's planned, what's overdue, etc.`,
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
          repeats: (() => {
            const r = normalizeRecurrence(t.recurrence, t.dueDate);
            return r ? shortRecurrenceLabel(r) : undefined;
          })(),
        }));
      }),
    }),

    get_task: ({
      description: `One task in full: every property, its description (the task's own context), and its subtasks. Use it to read state after a write, and before editing a task you did not just fetch.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to retrieve"),
      }),
      execute: safe(async (args: any) => {
        const task = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });
        if (!task) return { error: "Task not found" };
        const subtasks = await convex.query(api.tasks.getSubtasks, { parentTaskId: task._id });
        return {
          id: task._id,
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
          subtasks: subtasks.map((s) => ({ id: s._id, title: s.title, status: s.status, priority: s.priority, dueDate: s.dueDate, dueTime: s.dueTime, description: s.description })),
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
        recurrence: recurrenceSchema.optional(),
      }),
      execute: safe(async (args: any) => {
        const dueDate = args.dueDate || today();
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
          parentTaskId: args.parentTaskId as Id<"tasks"> | undefined,
          labels: args.labels,
          scheduledDate: args.scheduledDate,
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
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

        return {
          id, title: args.title, dueDate, created: true,
          repeats: args.recurrence ? describeRecurrence(args.recurrence, dueDate) : undefined,
        };
      }),
    }),

    update_task: ({
      description: `Update an existing task. Only include the fields you want to change. Use this for rescheduling, changing priority, renaming, adding descriptions, moving to a project, etc.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to update"),
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
        parentTaskId: z.string().optional().describe("Make it a subtask of that task (use 'none' to detach)"),
        labels: z.array(z.string()).optional().describe("Replace labels"),
        scheduledDate: z.string().optional().describe("YYYY-MM-DD"),
        clearDueDate: z.boolean().optional().describe("Remove the date entirely"),
        clearDueTime: z.boolean().optional().describe("Make it all-day"),
      }),
      execute: safe(async (args: any) => {
        const updateArgs: Record<string, unknown> = { id: args.id };
        if (args.columnId === "none") updateArgs.clearColumnId = true; else if (args.columnId) updateArgs.columnId = args.columnId;
        if (args.parentTaskId === "none") updateArgs.clearParentTaskId = true; else if (args.parentTaskId) updateArgs.parentTaskId = args.parentTaskId;
        if (args.labels) updateArgs.labels = args.labels;
        if (args.scheduledDate) updateArgs.scheduledDate = args.scheduledDate;
        if (args.clearDueDate) { updateArgs.clearDueDate = true; updateArgs.userDate = today(); }
        if (args.clearDueTime) updateArgs.clearDueTime = true;
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

        return { id: args.id, updated: true };
      }),
    }),

    complete_task: ({
      description: `Mark a task as done (or toggle it back to todo if already done). Use when the user says they finished something, completed a task, or want to mark it done. For a repeating task this does NOT mark it done: it records a done copy and moves the task to its next occurrence; the result tells you the new date.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to complete"),
      }),
      execute: safe(async (args: any) => {
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

    delete_task: ({
      description: `Permanently delete a task. IMPORTANT: This is irreversible — confirm with the user BEFORE calling this tool. Don't use this for completing tasks — use complete_task instead.`,
      inputSchema: z.object({
        id: z.string().describe("Task ID to delete"),
      }),
      execute: safe(async (args: any) => {
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
      description: `Find tasks by text in title or description. Fast and cheap: call it before creating anything, so you reuse or update an existing task instead of duplicating it. Scope with projectId when the work belongs to a project. Returns up to 15 matches with a description snippet and subtask count.`,
      inputSchema: z.object({
        query: z.string().describe("Text to match against title and description (case-insensitive)"),
        projectId: z.string().optional().describe("Only search inside this project"),
        includeDone: z.boolean().optional().describe("Include completed tasks. Default false."),
      }),
      execute: safe(async (args: any) => {
        const all = await convex.query(api.tasks.list, args.projectId ? { projectId: args.projectId as Id<"projects"> } : {});
        const q = String(args.query).toLowerCase();
        const pool = all.filter((t) => args.includeDone || t.status !== "done");
        const matches = pool.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
        const children = new Map<string, number>();
        for (const t of all) if (t.parentTaskId) children.set(t.parentTaskId, (children.get(t.parentTaskId) ?? 0) + 1);
        return matches.slice(0, 15).map((t) => ({
          id: t._id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime,
          projectId: t.projectId, columnId: t.columnId, parentTaskId: t.parentTaskId,
          descriptionSnippet: t.description ? t.description.slice(0, 160) : undefined,
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
            open: mine.filter((t) => t.status !== "done").length, done: mine.filter((t) => t.status === "done").length,
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
          id: t._id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime,
          startTime: t.scheduledStartTime, endTime: t.scheduledEndTime, description: t.description,
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
          columns: columns.map((c) => ({ id: c.id, name: c.name, color: c.color, status: c.status })),
          board,
          counts: { open: tasks.filter((t) => !t.parentTaskId && t.status !== "done").length, done: tasks.filter((t) => !t.parentTaskId && t.status === "done").length },
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
        columns: z.array(z.object({
          name: z.string(),
          color: z.string().optional().describe("Hex colour"),
          status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional().describe("Status a task takes in this column. Give exactly one column status 'done' if you want completion to land somewhere."),
        })).optional().describe("Custom board columns in order. Omit for the default template."),
      }),
      execute: safe(async (args: any) => {
        const columns = buildColumns(args.columns);
        const id = await convex.mutation(api.projects.create, {
          name: args.name, description: args.description, notes: args.context,
          color: args.color || "#3b82f6", priority: args.priority,
          startDate: args.startDate, dueDate: args.dueDate, columns,
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
        status: z.enum(["active", "archived"]).optional(),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
      }),
      execute: safe(async (args: any) => {
        const patch: Record<string, unknown> = { id: args.id };
        for (const k of ["name", "description", "color", "priority", "status", "startDate", "dueDate"]) if (args[k] !== undefined) patch[k] = args[k];
        if (args.context !== undefined) patch.notes = args.context;
        await convex.mutation(api.projects.update, patch as Parameters<typeof convex.mutation<typeof api.projects.update>>[1]);
        return { id: args.id, updated: true };
      }),
    }),

    set_project_columns: ({
      description: `Replace a project's board columns (rename, reorder, add, remove). Send the complete list in order. Keep an existing column's id to preserve which tasks sit in it; new columns get an id from their name. Tasks in a removed column fall back to the column matching their status.`,
      inputSchema: z.object({
        projectId: z.string(),
        columns: z.array(z.object({
          id: z.string().optional().describe("Existing column id to keep; omit for a new column"),
          name: z.string(),
          color: z.string().optional(),
          status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional(),
        })).min(1),
      }),
      execute: safe(async (args: any) => {
        const p = await convex.query(api.projects.getById, { id: args.projectId as Id<"projects"> });
        if (!p) return { error: "Project not found" };
        const existing = projectColumns(p);
        const out: BoardColumn[] = [];
        for (const c of args.columns as Array<{ id?: string; name: string; color?: string; status?: BoardColumn["status"] }>) {
          const prev = c.id ? existing.find((e) => e.id === c.id) : undefined;
          out.push({ id: prev?.id ?? newColumnId(c.name, [...existing, ...out]), name: c.name, color: c.color ?? prev?.color ?? COLUMN_PALETTE[out.length % COLUMN_PALETTE.length], status: c.status ?? prev?.status });
        }
        await convex.mutation(api.projects.setColumns, { id: p._id, columns: out });
        return { projectId: p._id, columns: out.map((c) => ({ id: c.id, name: c.name, status: c.status })), updated: true };
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
          overdueTasks: overdue.slice(0, 5).map((t) => ({ id: t._id, title: t.title, dueDate: t.dueDate, priority: t.priority })),
          todayCount: todayTasks.length,
          todayTasks: todayTasks.map((t) => ({
            id: t._id,
            title: t.title,
            dueTime: t.dueTime,
            startTime: t.scheduledStartTime,
            endTime: t.scheduledEndTime,
            priority: t.priority,
            source: t.source,
          })),
          upcomingThisWeek: upcoming.length,
          upcomingTasks: upcoming.slice(0, 10).map((t) => ({ id: t._id, title: t.title, dueDate: t.dueDate, priority: t.priority })),
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
            id: t._id, title: t.title, start: t.scheduledStartTime, end: t.scheduledEndTime, source: t.source, status: t.status,
          })),
          unscheduled: unscheduled.map((t) => ({
            id: t._id, title: t.title, priority: t.priority, status: t.status,
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
