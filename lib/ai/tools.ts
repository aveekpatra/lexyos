/**
 * AI Agent tools — executed server-side in the API route.
 * Each tool maps to Convex mutations/queries via ConvexHttpClient.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// ─── Convex client setup ───
// We use ConvexHttpClient (not the React client) since this runs server-side.
// Auth token is injected per-request from Clerk.
function getConvex(token: string) {
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  return client;
}

// ─── Helper: get today's date in user's timezone ───
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Tool factory: creates tools that receive auth token at runtime ───
export function createTools(authToken: string): Record<string, any> {
  const convex = getConvex(authToken);

  return {
    // ═══════════════════════════════════════════
    // TASK TOOLS
    // ═══════════════════════════════════════════

    list_tasks: ({
      description: `List tasks with optional filters. Returns task id, title, status, priority, dueDate, dueTime, scheduledStartTime, scheduledEndTime, projectId, source. Use this to answer questions about the user's tasks, what's planned, what's overdue, etc.`,
      parameters: z.object({
        status: z.enum(["todo", "planned", "in_progress", "review", "done"]).optional()
          .describe("Filter by status"),
        projectId: z.string().optional()
          .describe("Filter by project ID"),
        source: z.enum(["local", "google_calendar"]).optional()
          .describe("Filter by source: 'local' for user-created tasks, 'google_calendar' for synced events"),
      }),
      execute: async (args: any) => {
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
        }));
      },
    }),

    create_task: ({
      description: `Create a new task. Always set a dueDate (defaults to today if not specified). Set priority to p1 (urgent), p2 (high), p3 (medium/default), or p4 (low). If the user mentions a time, set dueTime in HH:MM format. If they mention a project, look up the project ID first with list_projects.`,
      parameters: z.object({
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description/notes"),
        dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format. Defaults to today."),
        dueTime: z.string().optional().describe("Due time in HH:MM 24h format (e.g. '14:30')"),
        priority: z.enum(["p1", "p2", "p3", "p4"]).optional().describe("Priority: p1=urgent, p2=high, p3=medium, p4=low"),
        status: z.enum(["todo", "planned", "in_progress", "review"]).optional().describe("Initial status"),
        projectId: z.string().optional().describe("Project ID to assign to"),
        scheduledStartTime: z.string().optional().describe("Start time in HH:MM format"),
        scheduledEndTime: z.string().optional().describe("End time in HH:MM format"),
      }),
      execute: async (args: any) => {
        const id = await convex.mutation(api.tasks.create, {
          title: args.title,
          description: args.description,
          dueDate: args.dueDate || today(),
          dueTime: args.dueTime,
          priority: args.priority as "p1" | "p2" | "p3" | "p4" | undefined,
          status: args.status as "todo" | "planned" | "in_progress" | "review" | undefined,
          projectId: args.projectId as Id<"projects"> | undefined,
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
          userDate: today(),
        });
        return { id, title: args.title, dueDate: args.dueDate || today(), created: true };
      },
    }),

    update_task: ({
      description: `Update an existing task. Only include the fields you want to change. Use this for rescheduling, changing priority, renaming, adding descriptions, moving to a project, etc.`,
      parameters: z.object({
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
      }),
      execute: async (args: any) => {
        const updateArgs: Record<string, unknown> = { id: args.id };
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
        return { id: args.id, updated: true };
      },
    }),

    complete_task: ({
      description: `Mark a task as done (or toggle it back to todo if already done). Use when the user says they finished something, completed a task, or want to mark it done.`,
      parameters: z.object({
        id: z.string().describe("Task ID to complete"),
      }),
      execute: async (args: any) => {
        await convex.mutation(api.tasks.toggleComplete, { id: args.id as Id<"tasks"> });
        return { id: args.id, toggled: true };
      },
    }),

    delete_task: ({
      description: `Permanently delete a task. Use when the user explicitly asks to remove or delete a task. Don't use this for completing tasks — use complete_task instead.`,
      parameters: z.object({
        id: z.string().describe("Task ID to delete"),
      }),
      execute: async (args: any) => {
        await convex.mutation(api.tasks.remove, { id: args.id as Id<"tasks"> });
        return { id: args.id, deleted: true };
      },
    }),

    search_tasks: ({
      description: `Search tasks by title text. Use when the user refers to a task by name and you need to find its ID. Returns matching tasks.`,
      parameters: z.object({
        query: z.string().describe("Search text to match against task titles"),
      }),
      execute: async (args: any) => {
        const all = await convex.query(api.tasks.list, {});
        const q = args.query.toLowerCase();
        const matches = all.filter((t) => t.title.toLowerCase().includes(q));
        return matches.slice(0, 10).map((t) => ({
          id: t._id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          projectId: t.projectId,
        }));
      },
    }),

    // ═══════════════════════════════════════════
    // PROJECT TOOLS
    // ═══════════════════════════════════════════

    list_projects: ({
      description: `List all active projects. Returns project id, name, color, priority, dates. Use this to find project IDs when the user mentions a project by name.`,
      parameters: z.object({}),
      execute: async (_args: any) => {
        const projects = await convex.query(api.projects.list, { status: "active" });
        return projects.map((p) => ({
          id: p._id,
          name: p.name,
          color: p.color,
          priority: p.priority,
          startDate: p.startDate,
          endDate: p.dueDate,
        }));
      },
    }),

    create_project: ({
      description: `Create a new project. Projects organize tasks into groups.`,
      parameters: z.object({
        name: z.string().describe("Project name"),
        color: z.string().optional().describe("Hex color (e.g. '#3b82f6')"),
        priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("Project priority"),
        startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      }),
      execute: async (args: any) => {
        const id = await convex.mutation(api.projects.create, {
          name: args.name,
          color: args.color || "#3b82f6",
          priority: args.priority,
          startDate: args.startDate,
          dueDate: args.endDate,
        });
        return { id, name: args.name, created: true };
      },
    }),

    update_project: ({
      description: `Update an existing project's properties.`,
      parameters: z.object({
        id: z.string().describe("Project ID"),
        name: z.string().optional().describe("New name"),
        color: z.string().optional().describe("New hex color"),
        priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("New priority"),
        startDate: z.string().optional().describe("New start date"),
        endDate: z.string().optional().describe("New end date"),
      }),
      execute: async (args: any) => {
        await convex.mutation(api.projects.update, {
          id: args.id as Id<"projects">,
          name: args.name,
          color: args.color,
          priority: args.priority,
          startDate: args.startDate,
          dueDate: args.endDate,
        });
        return { id: args.id, updated: true };
      },
    }),

    // ═══════════════════════════════════════════
    // INTELLIGENCE TOOLS
    // ═══════════════════════════════════════════

    get_today_summary: ({
      description: `Get a summary of today's schedule: overdue tasks, today's tasks, calendar events, and upcoming deadlines this week. Use this when the user asks "what's on my plate", "what do I have today", "give me a rundown", etc.`,
      parameters: z.object({}),
      execute: async (_args: any) => {
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
      },
    }),

    plan_day: ({
      description: `Get all tasks and events for a specific date, organized by time. Use when the user asks to plan a day, see their schedule, or wants a time-blocked view.`,
      parameters: z.object({
        date: z.string().optional().describe("Date to plan (YYYY-MM-DD). Defaults to today."),
      }),
      execute: async (args: any) => {
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
      },
    }),

    find_free_time: ({
      description: `Find free time slots on a given date. Use when the user asks "when am I free", "find me a slot", "when can I schedule X". Returns available time blocks between 9am-6pm.`,
      parameters: z.object({
        date: z.string().describe("Date to check (YYYY-MM-DD)"),
        durationMinutes: z.number().optional().describe("Minimum slot duration in minutes (default: 30)"),
      }),
      execute: async (args: any) => {
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
      },
    }),
  };
}
