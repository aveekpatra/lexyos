/**
 * AI Agent tools — executed server-side in the API route.
 * Each tool maps to Convex mutations/queries via ConvexHttpClient.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  setGmailToken,
  clearGmailToken,
  listMessagesWithDetails,
  sendMessage as gmailSendMessage,
  getMessage as gmailGetMessage,
  archiveMessage,
  trashMessage,
  markAsRead,
  markAsUnread,
  starMessage,
  unstarMessage,
} from "@/lib/gmail-api";

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
export function createTools(authToken: string, googleToken?: string): Record<string, any> {
  const convex = getConvex(authToken);

  /** Wrap a gmail-api call with token setup/teardown */
  async function withGmail<T>(fn: () => Promise<T>): Promise<T> {
    if (!googleToken) throw new Error("Gmail not connected");
    setGmailToken(googleToken);
    try {
      return await fn();
    } finally {
      clearGmailToken();
    }
  }

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
      parameters: z.object({
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
        }));
      }),
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
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
          userDate: today(),
        });

        // Auto-push to Google Calendar
        try {
          const { pushTaskToGoogleCalendar } = await import("@/app/actions/calendarSync");
          const result = await pushTaskToGoogleCalendar({
            id: id as string,
            title: args.title,
            description: args.description,
            dueDate,
            dueTime,
            durationMinutes: args.scheduledStartTime && args.scheduledEndTime
              ? (() => {
                  const [sh, sm] = args.scheduledStartTime!.split(":").map(Number);
                  const [eh, em] = args.scheduledEndTime!.split(":").map(Number);
                  const d = (eh * 60 + em) - (sh * 60 + sm);
                  return d > 0 ? d : 60;
                })()
              : 60,
          });
          if (result?.googleEventId) {
            await convex.mutation(api.tasks.update, {
              id: id as Id<"tasks">,
              googleEventId: result.googleEventId,
              googleCalendarId: result.googleCalendarId || "primary",
            });
          }
        } catch (err) {
          console.warn("[AI] Auto-push to Google Calendar failed:", err);
        }

        return { id, title: args.title, dueDate, created: true };
      }),
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
      execute: safe(async (args: any) => {
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

        // Fetch current task state before updating (for Google sync)
        const taskBefore = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });
        await convex.mutation(api.tasks.update, updateArgs as Parameters<typeof convex.mutation<typeof api.tasks.update>>[1]);

        // Sync to Google Calendar
        if (taskBefore) {
          try {
            if (taskBefore.googleEventId) {
              // Update existing Google event
              const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
              const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
              const gUpdates: Record<string, unknown> = {};
              if (args.title) gUpdates.summary = args.title;
              if (args.description !== undefined) gUpdates.description = args.description;
              const newDate = args.dueDate || taskBefore.dueDate || taskBefore.scheduledDate;
              const newTime = args.dueTime || (taskBefore as any).dueTime || taskBefore.scheduledStartTime;
              if (args.dueDate || args.dueTime || args.scheduledStartTime || args.scheduledEndTime) {
                if (newDate && newTime) {
                  const endTime = args.scheduledEndTime || taskBefore.scheduledEndTime;
                  let et = endTime;
                  if (!et) {
                    const [h, m] = newTime.split(":").map(Number);
                    et = `${String(Math.floor((h * 60 + m + 60) / 60) % 24).padStart(2, "0")}:${String((h * 60 + m + 60) % 60).padStart(2, "0")}`;
                  }
                  gUpdates.start = { dateTime: `${newDate}T${newTime}:00`, timeZone: tz };
                  gUpdates.end = { dateTime: `${newDate}T${et}:00`, timeZone: tz };
                } else if (newDate) {
                  const next = new Date(newDate + "T00:00:00");
                  next.setDate(next.getDate() + 1);
                  gUpdates.start = { date: newDate };
                  gUpdates.end = { date: next.toISOString().slice(0, 10) };
                }
              }
              if (Object.keys(gUpdates).length > 0) {
                await updateGoogleEvent(taskBefore.googleCalendarId || "primary", taskBefore.googleEventId, gUpdates);
              }
            } else if (args.dueDate || taskBefore.dueDate) {
              // Task got a date but no Google event yet — auto-push
              const { pushTaskToGoogleCalendar } = await import("@/app/actions/calendarSync");
              const pushDate = args.dueDate || taskBefore.dueDate || today();
              const pushTime = args.dueTime || (taskBefore as any).dueTime || taskBefore.scheduledStartTime;
              const result = await pushTaskToGoogleCalendar({
                id: args.id,
                title: args.title || taskBefore.title,
                dueDate: pushDate,
                dueTime: pushTime,
                durationMinutes: 60,
              });
              if (result?.googleEventId) {
                await convex.mutation(api.tasks.update, {
                  id: args.id as Id<"tasks">,
                  googleEventId: result.googleEventId,
                  googleCalendarId: result.googleCalendarId || "primary",
                });
              }
            }
          } catch (err) {
            console.warn("[AI] Google Calendar sync failed for update:", err);
          }
        }

        return { id: args.id, updated: true };
      }),
    }),

    complete_task: ({
      description: `Mark a task as done (or toggle it back to todo if already done). Use when the user says they finished something, completed a task, or want to mark it done.`,
      parameters: z.object({
        id: z.string().describe("Task ID to complete"),
      }),
      execute: safe(async (args: any) => {
        const taskBefore = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });
        await convex.mutation(api.tasks.toggleComplete, { id: args.id as Id<"tasks"> });
        // Sync [Done] prefix to Google Calendar
        if (taskBefore?.googleEventId) {
          try {
            const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
            const wasDone = taskBefore.status === "done";
            const newTitle = wasDone
              ? taskBefore.title.replace(/^\[Done\]\s*/, "")
              : `[Done] ${taskBefore.title}`;
            await updateGoogleEvent(taskBefore.googleCalendarId || "primary", taskBefore.googleEventId, { summary: newTitle });
          } catch (err) {
            console.warn("[AI] Google sync failed for complete:", err);
          }
        }
        return { id: args.id, toggled: true };
      }),
    }),

    delete_task: ({
      description: `Permanently delete a task. IMPORTANT: This is irreversible — confirm with the user BEFORE calling this tool. Don't use this for completing tasks — use complete_task instead.`,
      parameters: z.object({
        id: z.string().describe("Task ID to delete"),
      }),
      execute: safe(async (args: any) => {
        // Fetch task before deleting to get Google event ID
        const taskBefore = await convex.query(api.tasks.getById, { id: args.id as Id<"tasks"> });
        await convex.mutation(api.tasks.remove, { id: args.id as Id<"tasks"> });
        // Delete from Google Calendar
        if (taskBefore?.googleEventId) {
          try {
            const { deleteGoogleEvent } = await import("@/app/actions/calendarSync");
            await deleteGoogleEvent(taskBefore.googleCalendarId || "primary", taskBefore.googleEventId);
          } catch (err) {
            console.warn("[AI] Google Calendar delete failed:", err);
          }
        }
        return { id: args.id, deleted: true };
      }),
    }),

    search_tasks: ({
      description: `Search tasks by title text. Use when the user refers to a task by name and you need to find its ID. Returns matching tasks.`,
      parameters: z.object({
        query: z.string().describe("Search text to match against task titles"),
      }),
      execute: safe(async (args: any) => {
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
      }),
    }),

    // ═══════════════════════════════════════════
    // PROJECT TOOLS
    // ═══════════════════════════════════════════

    list_projects: ({
      description: `List all active projects. Returns project id, name, color, priority, dates. Use this to find project IDs when the user mentions a project by name.`,
      parameters: z.object({}),
      execute: safe(async (_args: any) => {
        const projects = await convex.query(api.projects.list, { status: "active" });
        return projects.map((p) => ({
          id: p._id,
          name: p.name,
          color: p.color,
          priority: p.priority,
          startDate: p.startDate,
          endDate: p.dueDate,
        }));
      }),
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
      execute: safe(async (args: any) => {
        const id = await convex.mutation(api.projects.create, {
          name: args.name,
          color: args.color || "#3b82f6",
          priority: args.priority,
          startDate: args.startDate,
          dueDate: args.endDate,
        });
        return { id, name: args.name, created: true };
      }),
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
      execute: safe(async (args: any) => {
        await convex.mutation(api.projects.update, {
          id: args.id as Id<"projects">,
          name: args.name,
          color: args.color,
          priority: args.priority,
          startDate: args.startDate,
          dueDate: args.endDate,
        });
        return { id: args.id, updated: true };
      }),
    }),

    // ═══════════════════════════════════════════
    // INTELLIGENCE TOOLS
    // ═══════════════════════════════════════════

    get_today_summary: ({
      description: `Get a summary of today's schedule: overdue tasks, today's tasks, calendar events, and upcoming deadlines this week. Use this when the user asks "what's on my plate", "what do I have today", "give me a rundown", etc.`,
      parameters: z.object({}),
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
      parameters: z.object({
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
      parameters: z.object({
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

    // ═══════════════════════════════════════════
    // EMAIL TOOLS
    // ═══════════════════════════════════════════

    search_emails: ({
      description: `Search emails using Gmail search syntax. Use when the user asks about emails, wants to find a message, check unread mail, etc. Returns subject, from, date, snippet, and IDs. Supports Gmail search operators: from:, to:, subject:, is:unread, is:starred, has:attachment, after:, before:, label:, etc.`,
      parameters: z.object({
        query: z.string().describe("Gmail search query (e.g. 'from:john subject:meeting is:unread', 'after:2024/01/01')"),
        maxResults: z.number().optional().describe("Max results to return (default: 10)"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          const result = await listMessagesWithDetails({
            query: args.query,
            maxResults: args.maxResults || 10,
          });
          return result.messages.map((m) => ({
            id: m.id,
            threadId: m.threadId,
            subject: m.subject,
            from: m.from,
            to: m.to,
            date: m.date,
            snippet: m.snippet,
            isUnread: m.isUnread,
            isStarred: m.isStarred,
            hasAttachments: m.attachments.length > 0,
          }));
        });
      }),
    }),

    read_email: ({
      description: `Read the full content of a specific email by its message ID. Use after search_emails to get the full body text of a message.`,
      parameters: z.object({
        messageId: z.string().describe("Gmail message ID"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          const msg = await gmailGetMessage(args.messageId);
          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: msg.subject,
            from: msg.from,
            to: msg.to,
            cc: msg.cc,
            date: msg.date,
            bodyText: msg.bodyText,
            isUnread: msg.isUnread,
            isStarred: msg.isStarred,
            attachments: msg.attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
            })),
          };
        });
      }),
    }),

    send_email: ({
      description: `Compose and send a new email. IMPORTANT: This is irreversible — always confirm the recipient, subject, and body with the user BEFORE calling this tool.`,
      parameters: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body (plain text)"),
        cc: z.string().optional().describe("CC email address(es), comma separated"),
        bcc: z.string().optional().describe("BCC email address(es), comma separated"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          const sent = await gmailSendMessage({
            to: args.to.trim(),
            subject: args.subject.trim(),
            body: args.body,
            cc: args.cc?.trim(),
            bcc: args.bcc?.trim(),
          });
          return { id: sent.id, threadId: sent.threadId, sent: true };
        });
      }),
    }),

    reply_to_email: ({
      description: `Reply to an email thread. IMPORTANT: This is irreversible — confirm the reply content with the user BEFORE calling this tool. Requires the message ID to reply to (get it from search_emails or read_email first).`,
      parameters: z.object({
        messageId: z.string().describe("The message ID to reply to"),
        body: z.string().describe("Reply body (plain text)"),
        replyAll: z.boolean().optional().describe("If true, reply to all recipients (default: false)"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          const original = await gmailGetMessage(args.messageId);
          const replyTo = args.replyAll
            ? [original.from.email, ...original.to.map((a: { email: string }) => a.email), ...original.cc.map((a: { email: string }) => a.email)].join(", ")
            : original.from.email;
          const subject = original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`;
          const sent = await gmailSendMessage({
            to: replyTo,
            subject,
            body: args.body,
            threadId: original.threadId,
            inReplyTo: original.messageIdHeader,
            references: original.messageIdHeader,
          });
          return { id: sent.id, threadId: sent.threadId, replied: true };
        });
      }),
    }),

    archive_email: ({
      description: `Archive an email (remove from inbox). Use when the user wants to archive a message.`,
      parameters: z.object({
        messageId: z.string().describe("Gmail message ID to archive"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          await archiveMessage(args.messageId);
          return { messageId: args.messageId, archived: true };
        });
      }),
    }),

    trash_email: ({
      description: `Move an email to trash. Use when the user wants to delete a message.`,
      parameters: z.object({
        messageId: z.string().describe("Gmail message ID to trash"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          await trashMessage(args.messageId);
          return { messageId: args.messageId, trashed: true };
        });
      }),
    }),

    toggle_email_star: ({
      description: `Star or unstar an email. Use when the user wants to star/flag or unstar a message.`,
      parameters: z.object({
        messageId: z.string().describe("Gmail message ID"),
        star: z.boolean().describe("true to star, false to unstar"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          if (args.star) {
            await starMessage(args.messageId);
          } else {
            await unstarMessage(args.messageId);
          }
          return { messageId: args.messageId, starred: args.star };
        });
      }),
    }),

    toggle_email_read: ({
      description: `Mark an email as read or unread.`,
      parameters: z.object({
        messageId: z.string().describe("Gmail message ID"),
        read: z.boolean().describe("true to mark as read, false to mark as unread"),
      }),
      execute: safe(async (args: any) => {
        return withGmail(async () => {
          if (args.read) {
            await markAsRead(args.messageId);
          } else {
            await markAsUnread(args.messageId);
          }
          return { messageId: args.messageId, read: args.read };
        });
      }),
    }),
  };
}
