"use server";

import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { callOpenRouter, AITool } from "@/lib/ai-providers";
import {
  getCalendarEvents,
  createCalendarEvent,
  GoogleEvent,
} from "@/lib/calendar-api";
import {
  archiveMessage,
  archiveMessages,
  trashMessage,
  markAsRead,
  markAsUnread,
  markMessagesAsRead,
  markMessagesAsUnread,
  starMessage,
  unstarMessage,
  trashMessages,
  sendMessage as gmailSendMessage,
  createDraft as gmailCreateDraft,
  setGmailToken,
  clearGmailToken,
} from "@/lib/gmail-api";
import { getGoogleAccessToken } from "./google-auth";
import { format, addDays, parseISO, startOfDay, endOfDay } from "date-fns";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export interface AIAction {
  type: "create_task" | "create_event" | "update_task" | "list_tasks" | "plan_day" | "find_slots" | "breakdown" | "email_action" | "send_email" | "draft_email" | "list_emails";
  summary: string;
  details?: Record<string, unknown>;
}

export interface AIActionResult {
  message: string;
  actions: AIAction[];
}

const AI_TOOLS: AITool[] = [
  {
    name: "createTask",
    description: "Create a new task with title, priority, due date, and optional scheduled time",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        priority: { type: "string", enum: ["p1", "p2", "p3", "p4"], description: "Priority level" },
        dueDate: { type: "string", description: "Due date in YYYY-MM-DD format" },
        scheduledDate: { type: "string", description: "Date to work on it in YYYY-MM-DD format" },
        scheduledStartTime: { type: "string", description: "Start time in HH:mm format" },
        scheduledEndTime: { type: "string", description: "End time in HH:mm format" },
        description: { type: "string", description: "Task description" },
      },
      required: ["title"],
    },
  },
  {
    name: "createEvent",
    description: "Create a Google Calendar event with title, date, start/end time, and optional description/location",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        startTime: { type: "string", description: "Start time in HH:mm format" },
        endTime: { type: "string", description: "End time in HH:mm format" },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
      },
      required: ["summary", "date", "startTime", "endTime"],
    },
  },
  {
    name: "updateTask",
    description: "Update an existing task's status, priority, or dates. Use taskTitle to find the task.",
    parameters: {
      type: "object",
      properties: {
        taskTitle: { type: "string", description: "Title of the task to update (fuzzy match)" },
        status: { type: "string", enum: ["todo", "in_progress", "done"] },
        priority: { type: "string", enum: ["p1", "p2", "p3", "p4"] },
        dueDate: { type: "string", description: "New due date in YYYY-MM-DD format" },
        scheduledDate: { type: "string", description: "New scheduled date in YYYY-MM-DD format" },
      },
      required: ["taskTitle"],
    },
  },
  {
    name: "listTasks",
    description: "List tasks, optionally filtered by status",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["todo", "in_progress", "done"], description: "Filter by status" },
      },
    },
  },
  {
    name: "getCalendarEvents",
    description: "Get calendar events for a date or date range",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        endDate: { type: "string", description: "End date for range in YYYY-MM-DD format" },
      },
      required: ["date"],
    },
  },
  {
    name: "findFreeSlots",
    description: "Find available time slots on a given date",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        durationMinutes: { type: "number", description: "Desired slot duration in minutes" },
      },
      required: ["date"],
    },
  },
  {
    name: "breakdownTask",
    description: "Break a complex task into subtasks with time estimates",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Main task title" },
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              estimateMinutes: { type: "number" },
              priority: { type: "string", enum: ["p1", "p2", "p3", "p4"] },
            },
            required: ["title"],
          },
          description: "List of subtasks",
        },
        dueDate: { type: "string", description: "Due date for the parent task" },
      },
      required: ["title", "subtasks"],
    },
  },
  {
    name: "planDay",
    description: "Analyze the user's events and tasks and suggest an optimized daily schedule",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date to plan in YYYY-MM-DD format" },
      },
      required: ["date"],
    },
  },
  // --- Email tools ---
  {
    name: "searchEmails",
    description: "Search emails in the Convex cache by label, sender, subject, or unread status. Returns matching emails.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Filter by label: INBOX, STARRED, SENT, DRAFT, TRASH, SPAM, or any custom label" },
        unreadOnly: { type: "boolean", description: "If true, only return unread emails" },
        query: { type: "string", description: "Search term to match against subject, sender name, or sender email" },
        limit: { type: "number", description: "Max results to return (default 20)" },
      },
    },
  },
  {
    name: "archiveEmails",
    description: "Archive one or more emails (remove from INBOX). Provide Gmail message IDs.",
    parameters: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs to archive",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "trashEmails",
    description: "Move one or more emails to trash. Provide Gmail message IDs.",
    parameters: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs to trash",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "markEmailsRead",
    description: "Mark one or more emails as read. Provide Gmail message IDs.",
    parameters: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs to mark as read",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "markEmailsUnread",
    description: "Mark one or more emails as unread. Provide Gmail message IDs.",
    parameters: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs to mark as unread",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "starEmails",
    description: "Star one or more emails. Provide Gmail message IDs.",
    parameters: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs to star",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "unstarEmails",
    description: "Remove star from one or more emails. Provide Gmail message IDs.",
    parameters: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs to unstar",
        },
      },
      required: ["messageIds"],
    },
  },
  {
    name: "sendEmail",
    description: "Send a new email to one or more recipients.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma-separated" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (plain text)" },
        cc: { type: "string", description: "CC recipients, comma-separated" },
        bcc: { type: "string", description: "BCC recipients, comma-separated" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "draftEmail",
    description: "Create a draft email (saved but not sent).",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma-separated" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (plain text)" },
        cc: { type: "string", description: "CC recipients, comma-separated" },
        bcc: { type: "string", description: "BCC recipients, comma-separated" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

async function setConvexAuth(clerkToken: string) {
  convex.setAuth(clerkToken);
}

export async function processAICommand(
  userMessage: string,
  clerkToken: string
): Promise<AIActionResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Set auth for Convex client
  await setConvexAuth(clerkToken);

  // Pre-fetch Google OAuth token before any Convex calls consume the request context
  try {
    const googleToken = await getGoogleAccessToken();
    setGmailToken(googleToken);
  } catch {
    // Gmail not connected — email tools will fail gracefully
  }

  try {
  // Get AI settings
  const aiSettings = await convex.query(api.aiSettings.getFullKey, {});
  if (!aiSettings) {
    return {
      message: "Please configure your AI settings first. Go to Settings and add your OpenRouter API key.",
      actions: [],
    };
  }

  // Build context
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const todayEvents = await getCalendarEventsForDay(today);
  const tasks = await convex.query(api.tasks.list, {});
  const pendingTasks = tasks.filter((t) => t.status !== "done");

  // Get recent unread emails for context
  const allEmails = await convex.query(api.emails.list, { labelFilter: "INBOX" });
  const unreadEmails = allEmails.filter((e: { isUnread: boolean }) => e.isUnread);

  const contextSummary = buildContext(now, todayEvents, pendingTasks, unreadEmails);

  const systemPrompt = `You are UniFocus AI, a productivity assistant. You help users manage their calendar, tasks, and schedule.

Current date and time: ${format(now, "EEEE, MMMM d, yyyy 'at' h:mm a")}
Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}

${contextSummary}

Instructions:
- When the user asks to create events or tasks, use the appropriate tools.
- When dates are relative (e.g., "tomorrow", "next Monday"), calculate the actual date.
- Today is ${today}.
- Tomorrow is ${format(addDays(now, 1), "yyyy-MM-dd")}.
- For time parsing: "3pm" = "15:00", "9am" = "09:00", etc.
- Default event duration is 1 hour if end time not specified.
- Default task priority is p3 unless urgency is indicated.
- Be concise in your responses.
- When planning a day, consider existing events and suggest optimal task scheduling.
- For email operations, first use searchEmails to find the relevant messages, then use the action tools with the returned Gmail message IDs.
- When the user says "archive all newsletters" or similar bulk operations, search first to find matching emails.
- IMPORTANT: For destructive or bulk email actions (trash, bulk archive, send email), DO NOT execute the action tools yet. Instead, only call searchEmails to find the emails, then respond with a summary of what you WOULD do and ask the user to confirm. You have NOT done anything yet — you are only proposing the action. Wait for the user to say "yes" or "confirm" before executing.
- When sending emails, compose professional and concise messages unless the user specifies a tone. Show the draft to the user and ask for confirmation before actually sending.`;

  // Call OpenRouter
  const result = await callOpenRouter({
    apiKey: aiSettings.apiKey,
    model: aiSettings.model || "anthropic/claude-sonnet-4",
    systemPrompt,
    userMessage,
    tools: AI_TOOLS,
  });

  // Execute tool calls
  const actions: AIAction[] = [];

  for (const toolCall of result.toolCalls) {
    try {
      const action = await executeToolCall(toolCall.name, toolCall.arguments, clerkToken);
      if (action) actions.push(action);
    } catch (err) {
      console.error(`Tool call ${toolCall.name} failed:`, err);
      actions.push({
        type: "create_task",
        summary: `Failed to execute: ${toolCall.name}`,
        details: { error: String(err) },
      });
    }
  }

  return {
    message: result.message || (actions.length > 0 ? "Done! Here's what I did:" : "I'm not sure how to help with that."),
    actions,
  };
  } finally {
    clearGmailToken();
  }
}

async function getCalendarEventsForDay(date: string): Promise<GoogleEvent[]> {
  try {
    const dayStart = startOfDay(parseISO(date));
    const dayEnd = endOfDay(parseISO(date));
    return await getCalendarEvents(dayStart.toISOString(), dayEnd.toISOString());
  } catch {
    return [];
  }
}

function buildContext(
  now: Date,
  events: GoogleEvent[],
  tasks: Array<{ title: string; status: string; priority: string; dueDate?: string; scheduledDate?: string }>,
  unreadEmails: Array<{ gmailMessageId: string; subject: string; fromName: string; fromEmail: string; snippet: string }>
): string {
  let ctx = "";

  if (events.length > 0) {
    ctx += "Today's calendar events:\n";
    for (const e of events) {
      const time = e.start.dateTime
        ? format(parseISO(e.start.dateTime), "h:mm a")
        : "All day";
      ctx += `- ${time}: ${e.summary || "(No title)"}\n`;
    }
    ctx += "\n";
  }

  if (tasks.length > 0) {
    ctx += `Pending tasks (${tasks.length}):\n`;
    for (const t of tasks.slice(0, 20)) {
      ctx += `- [${t.priority.toUpperCase()}] ${t.title}`;
      if (t.dueDate) ctx += ` (due: ${t.dueDate})`;
      if (t.scheduledDate) ctx += ` (scheduled: ${t.scheduledDate})`;
      ctx += `\n`;
    }
    if (tasks.length > 20) ctx += `... and ${tasks.length - 20} more\n`;
    ctx += "\n";
  }

  if (unreadEmails.length > 0) {
    ctx += `Unread emails (${unreadEmails.length}):\n`;
    for (const e of unreadEmails.slice(0, 15)) {
      ctx += `- [${e.gmailMessageId}] From: ${e.fromName || e.fromEmail} — "${e.subject}" — ${e.snippet.slice(0, 80)}\n`;
    }
    if (unreadEmails.length > 15) ctx += `... and ${unreadEmails.length - 15} more\n`;
  }

  return ctx;
}

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  clerkToken: string
): Promise<AIAction | null> {
  await setConvexAuth(clerkToken);

  switch (name) {
    case "createTask": {
      const taskArgs = args as {
        title: string;
        priority?: string;
        dueDate?: string;
        scheduledDate?: string;
        scheduledStartTime?: string;
        scheduledEndTime?: string;
        description?: string;
      };
      await convex.mutation(api.tasks.create, {
        title: taskArgs.title,
        priority: (taskArgs.priority as "p1" | "p2" | "p3" | "p4") || "p3",
        dueDate: taskArgs.dueDate,
        scheduledDate: taskArgs.scheduledDate,
        scheduledStartTime: taskArgs.scheduledStartTime,
        scheduledEndTime: taskArgs.scheduledEndTime,
        description: taskArgs.description,
      });
      return {
        type: "create_task",
        summary: `Created task: ${taskArgs.title}`,
        details: { priority: taskArgs.priority, dueDate: taskArgs.dueDate },
      };
    }

    case "createEvent": {
      const eventArgs = args as {
        summary: string;
        date: string;
        startTime: string;
        endTime: string;
        description?: string;
        location?: string;
      };
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await createCalendarEvent({
        summary: eventArgs.summary,
        description: eventArgs.description,
        location: eventArgs.location,
        start: { dateTime: `${eventArgs.date}T${eventArgs.startTime}:00`, timeZone: tz },
        end: { dateTime: `${eventArgs.date}T${eventArgs.endTime}:00`, timeZone: tz },
      });
      return {
        type: "create_event",
        summary: `Created event: ${eventArgs.summary} on ${eventArgs.date} at ${eventArgs.startTime}`,
      };
    }

    case "updateTask": {
      const updateArgs = args as {
        taskTitle: string;
        status?: string;
        priority?: string;
        dueDate?: string;
        scheduledDate?: string;
      };
      const allTasks = await convex.query(api.tasks.list, {});
      const target = allTasks.find(
        (t) => t.title.toLowerCase().includes(updateArgs.taskTitle.toLowerCase())
      );
      if (!target) {
        return {
          type: "update_task",
          summary: `Could not find task matching "${updateArgs.taskTitle}"`,
        };
      }
      await convex.mutation(api.tasks.update, {
        id: target._id,
        status: updateArgs.status as "todo" | "in_progress" | "done" | undefined,
        priority: updateArgs.priority as "p1" | "p2" | "p3" | "p4" | undefined,
        dueDate: updateArgs.dueDate,
        scheduledDate: updateArgs.scheduledDate,
      });
      return {
        type: "update_task",
        summary: `Updated task: ${target.title}`,
        details: { status: updateArgs.status, priority: updateArgs.priority },
      };
    }

    case "listTasks": {
      const listArgs = args as { status?: string };
      const tasks = await convex.query(api.tasks.list, {
        status: listArgs.status as "todo" | "in_progress" | "done" | undefined,
      });
      return {
        type: "list_tasks",
        summary: `Found ${tasks.length} tasks`,
        details: { tasks: tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority })) },
      };
    }

    case "getCalendarEvents": {
      const calArgs = args as { date: string; endDate?: string };
      const events = await getCalendarEventsForDay(calArgs.date);
      return {
        type: "find_slots",
        summary: `Found ${events.length} events on ${calArgs.date}`,
        details: {
          events: events.map((e) => ({
            title: e.summary,
            start: e.start.dateTime || e.start.date,
            end: e.end.dateTime || e.end.date,
          })),
        },
      };
    }

    case "findFreeSlots": {
      const slotArgs = args as { date: string; durationMinutes?: number };
      const events = await getCalendarEventsForDay(slotArgs.date);
      const slots = computeFreeSlots(events, slotArgs.durationMinutes || 60);
      return {
        type: "find_slots",
        summary: `Found ${slots.length} free slots on ${slotArgs.date}`,
        details: { slots },
      };
    }

    case "breakdownTask": {
      const bdArgs = args as {
        title: string;
        subtasks: Array<{ title: string; estimateMinutes?: number; priority?: string }>;
        dueDate?: string;
      };
      // Create parent task
      const parentId = await convex.mutation(api.tasks.create, {
        title: bdArgs.title,
        priority: "p2",
        dueDate: bdArgs.dueDate,
      });
      // Create subtasks
      for (const sub of bdArgs.subtasks) {
        await convex.mutation(api.tasks.create, {
          title: sub.title,
          priority: (sub.priority as "p1" | "p2" | "p3" | "p4") || "p3",
          parentTaskId: parentId,
          dueDate: bdArgs.dueDate,
        });
      }
      return {
        type: "breakdown",
        summary: `Created "${bdArgs.title}" with ${bdArgs.subtasks.length} subtasks`,
        details: { subtasks: bdArgs.subtasks.map((s) => s.title) },
      };
    }

    case "planDay": {
      const planArgs = args as { date: string };
      return {
        type: "plan_day",
        summary: `Generated plan for ${planArgs.date}`,
      };
    }

    // --- Email tool handlers ---

    case "searchEmails": {
      const searchArgs = args as {
        label?: string;
        unreadOnly?: boolean;
        query?: string;
        limit?: number;
      };
      const label = searchArgs.label || "INBOX";
      const allEmails = await convex.query(api.emails.list, { labelFilter: label });
      let results = allEmails;

      if (searchArgs.unreadOnly) {
        results = results.filter((e: { isUnread: boolean }) => e.isUnread);
      }
      if (searchArgs.query) {
        const q = searchArgs.query.toLowerCase();
        results = results.filter(
          (e: { subject: string; fromName: string; fromEmail: string; snippet: string }) =>
            e.subject.toLowerCase().includes(q) ||
            e.fromName.toLowerCase().includes(q) ||
            e.fromEmail.toLowerCase().includes(q) ||
            e.snippet.toLowerCase().includes(q)
        );
      }
      const limit = searchArgs.limit || 20;
      results = results.slice(0, limit);

      return {
        type: "list_emails",
        summary: `Found ${results.length} emails${searchArgs.unreadOnly ? " (unread)" : ""} in ${label}`,
        details: {
          emails: results.map((e: { gmailMessageId: string; subject: string; fromName: string; fromEmail: string; snippet: string; isUnread: boolean; isStarred: boolean; date: number }) => ({
            id: e.gmailMessageId,
            subject: e.subject,
            from: e.fromName || e.fromEmail,
            snippet: e.snippet.slice(0, 100),
            isUnread: e.isUnread,
            isStarred: e.isStarred,
            date: format(new Date(e.date), "MMM d, h:mm a"),
          })),
        },
      };
    }

    case "archiveEmails": {
      const archiveArgs = args as { messageIds: string[] };
      if (archiveArgs.messageIds.length === 1) {
        await archiveMessage(archiveArgs.messageIds[0]);
      } else {
        await archiveMessages(archiveArgs.messageIds);
      }
      // Update Convex cache
      for (const id of archiveArgs.messageIds) {
        await convex.mutation(api.emails.updateLabels, {
          gmailMessageId: id,
          removeLabelIds: ["INBOX"],
        });
      }
      return {
        type: "email_action",
        summary: `Archived ${archiveArgs.messageIds.length} email(s)`,
      };
    }

    case "trashEmails": {
      const trashArgs = args as { messageIds: string[] };
      if (trashArgs.messageIds.length === 1) {
        await trashMessage(trashArgs.messageIds[0]);
      } else {
        await trashMessages(trashArgs.messageIds);
      }
      for (const id of trashArgs.messageIds) {
        await convex.mutation(api.emails.updateLabels, {
          gmailMessageId: id,
          addLabelIds: ["TRASH"],
          removeLabelIds: ["INBOX"],
        });
      }
      return {
        type: "email_action",
        summary: `Trashed ${trashArgs.messageIds.length} email(s)`,
      };
    }

    case "markEmailsRead": {
      const readArgs = args as { messageIds: string[] };
      if (readArgs.messageIds.length === 1) {
        await markAsRead(readArgs.messageIds[0]);
      } else {
        await markMessagesAsRead(readArgs.messageIds);
      }
      for (const id of readArgs.messageIds) {
        await convex.mutation(api.emails.updateLabels, {
          gmailMessageId: id,
          removeLabelIds: ["UNREAD"],
        });
      }
      return {
        type: "email_action",
        summary: `Marked ${readArgs.messageIds.length} email(s) as read`,
      };
    }

    case "markEmailsUnread": {
      const unreadArgs = args as { messageIds: string[] };
      if (unreadArgs.messageIds.length === 1) {
        await markAsUnread(unreadArgs.messageIds[0]);
      } else {
        await markMessagesAsUnread(unreadArgs.messageIds);
      }
      for (const id of unreadArgs.messageIds) {
        await convex.mutation(api.emails.updateLabels, {
          gmailMessageId: id,
          addLabelIds: ["UNREAD"],
        });
      }
      return {
        type: "email_action",
        summary: `Marked ${unreadArgs.messageIds.length} email(s) as unread`,
      };
    }

    case "starEmails": {
      const starArgs = args as { messageIds: string[] };
      for (const id of starArgs.messageIds) {
        await starMessage(id);
        await convex.mutation(api.emails.updateLabels, {
          gmailMessageId: id,
          addLabelIds: ["STARRED"],
        });
      }
      return {
        type: "email_action",
        summary: `Starred ${starArgs.messageIds.length} email(s)`,
      };
    }

    case "unstarEmails": {
      const unstarArgs = args as { messageIds: string[] };
      for (const id of unstarArgs.messageIds) {
        await unstarMessage(id);
        await convex.mutation(api.emails.updateLabels, {
          gmailMessageId: id,
          removeLabelIds: ["STARRED"],
        });
      }
      return {
        type: "email_action",
        summary: `Unstarred ${unstarArgs.messageIds.length} email(s)`,
      };
    }

    case "sendEmail": {
      const sendArgs = args as {
        to: string;
        subject: string;
        body: string;
        cc?: string;
        bcc?: string;
      };
      await gmailSendMessage({
        to: sendArgs.to,
        subject: sendArgs.subject,
        body: sendArgs.body,
        cc: sendArgs.cc,
        bcc: sendArgs.bcc,
      });
      return {
        type: "send_email",
        summary: `Sent email to ${sendArgs.to}: "${sendArgs.subject}"`,
      };
    }

    case "draftEmail": {
      const draftArgs = args as {
        to: string;
        subject: string;
        body: string;
        cc?: string;
        bcc?: string;
      };
      await gmailCreateDraft({
        to: draftArgs.to,
        subject: draftArgs.subject,
        body: draftArgs.body,
        cc: draftArgs.cc,
        bcc: draftArgs.bcc,
      });
      return {
        type: "draft_email",
        summary: `Created draft to ${draftArgs.to}: "${draftArgs.subject}"`,
      };
    }

    default:
      return null;
  }
}

function computeFreeSlots(
  events: GoogleEvent[],
  durationMinutes: number
): Array<{ start: string; end: string }> {
  const workStart = 9 * 60; // 9 AM
  const workEnd = 18 * 60; // 6 PM

  const busy: Array<{ start: number; end: number }> = [];
  for (const e of events) {
    if (e.start.dateTime && e.end.dateTime) {
      const s = parseISO(e.start.dateTime);
      const en = parseISO(e.end.dateTime);
      busy.push({
        start: s.getHours() * 60 + s.getMinutes(),
        end: en.getHours() * 60 + en.getMinutes(),
      });
    }
  }
  busy.sort((a, b) => a.start - b.start);

  const slots: Array<{ start: string; end: string }> = [];
  let cursor = workStart;

  for (const b of busy) {
    if (b.start > cursor && b.start - cursor >= durationMinutes) {
      slots.push({
        start: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
        end: `${String(Math.floor(b.start / 60)).padStart(2, "0")}:${String(b.start % 60).padStart(2, "0")}`,
      });
    }
    cursor = Math.max(cursor, b.end);
  }

  if (cursor < workEnd && workEnd - cursor >= durationMinutes) {
    slots.push({
      start: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
      end: `${String(Math.floor(workEnd / 60)).padStart(2, "0")}:${String(workEnd % 60).padStart(2, "0")}`,
    });
  }

  return slots;
}
