import { v } from "convex/values";
import { agentValidator, getIdentity } from "./lib/actor";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  recurrenceValidator,
  normalizeRecurrence,
  validateRecurrence,
  nextOccurrence,
  alignDateToRecurrence,
  type StoredRecurrence,
} from "./lib/recurrence";

// ─── "HH:MM" helpers (kept local so the Convex bundle has no app imports) ───
const MAX_DAY_MIN = 23 * 60 + 59;
const pad2 = (n: number) => String(n).padStart(2, "0");
function timeToMin(t: string | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
/** Minutes between start and end, or null when either is missing or end <= start. */
function durationBetween(start: string | undefined, end: string | undefined): number | null {
  const s = timeToMin(start), e = timeToMin(end);
  if (s === null || e === null || e <= s) return null;
  return e - s;
}
/** start + minutes, clamped to 23:59 on the same day. */
function clampedEndTime(start: string, minutes: number): string {
  const s = timeToMin(start) ?? 0;
  const e = Math.min(MAX_DAY_MIN, s + Math.max(1, minutes));
  return `${pad2(Math.floor(e / 60))}:${pad2(e % 60)}`;
}
/** Tolerance for client/server clock skew when comparing sync timestamps. */
const SYNC_CLOCK_SKEW_MS = 30_000;

export const list = query({
  args: { agent: agentValidator,
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    projectId: v.optional(v.id("projects")),
    scheduledDate: v.optional(v.string()),
    source: v.optional(v.union(v.literal("local"), v.literal("google_calendar"))),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const userId = identity.subject;

    let tasks;

    if (args.projectId) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_projectId", (q) =>
          q.eq("userId", userId).eq("projectId", args.projectId)
        )
        .collect();
    } else if (args.scheduledDate) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_scheduledDate", (q) =>
          q.eq("userId", userId).eq("scheduledDate", args.scheduledDate)
        )
        .collect();
    } else if (args.status) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_status", (q) =>
          q.eq("userId", userId).eq("status", args.status!)
        )
        .collect();
    } else {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
    }

    // Apply source filter if provided
    if (args.source) {
      if (args.source === "local") {
        // "local" matches tasks with source === "local" OR source === undefined (backward compat)
        tasks = tasks.filter((t) => !t.source || t.source === "local");
      } else {
        tasks = tasks.filter((t) => t.source === args.source);
      }
    }

    // Apply status filter for paths that didn't use the status index
    if (args.status && (args.projectId || args.scheduledDate)) {
      tasks = tasks.filter((t) => t.status === args.status);
    }

    return tasks.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const getById = query({
  args: { agent: agentValidator, id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return null;

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) return null;
    return task;
  },
});

export const getSubtasks = query({
  args: { agent: agentValidator, parentTaskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];

    return await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) =>
        q.eq("parentTaskId", args.parentTaskId)
      )
      .collect();
  },
});

export const create = mutation({
  args: { agent: agentValidator,
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    priority: v.optional(
      v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))
    ),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    scheduledDate: v.optional(v.string()),
    scheduledStartTime: v.optional(v.string()),
    scheduledEndTime: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    recurrence: v.optional(recurrenceValidator),
    labels: v.optional(v.array(v.string())),
    columnId: v.optional(v.string()),
    parentTaskId: v.optional(v.id("tasks")),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    location: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    // Client-provided local date (format: "YYYY-MM-DD") to avoid UTC drift on the server.
    // Falls back to server UTC date if not provided.
    userDate: v.optional(v.string()),
    /** Settings: add new tasks to the top of the list. */
    placeAtTop: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const maxOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), 0);
    const minOrder = existing.reduce((min, t) => Math.min(min, t.sortOrder), 0);

    // Default dueDate to today if not provided — tasks must always have a date.
    // Prefer client-supplied userDate (local timezone) over server UTC date.
    const today = args.userDate || new Date().toISOString().slice(0, 10);
    if (args.recurrence) validateRecurrence(args.recurrence);

    // A date that disagrees with the repeat rule (a Monday under "every Sun")
    // would show on one day while claiming another, so the rule wins and the
    // date moves forward to the first day the rule can actually land on.
    const rawDue = args.dueDate || today;
    const dueDate = args.recurrence ? alignDateToRecurrence(args.recurrence, rawDue) : rawDue;

    return await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: args.status ?? "todo",
      priority: args.priority ?? "p3",
      dueDate,
      dueTime: args.dueTime,
      scheduledDate: args.scheduledDate === rawDue ? dueDate : args.scheduledDate,
      scheduledStartTime: args.scheduledStartTime,
      scheduledEndTime: args.scheduledEndTime,
      projectId: args.projectId,
      recurrence: args.recurrence,
      labels: args.labels,
      parentTaskId: args.parentTaskId,
      columnId: args.columnId,
      googleEventId: args.googleEventId,
      googleCalendarId: args.googleCalendarId,
      location: args.location,
      isAllDay: args.isAllDay,
      source: "local",
      sortOrder: args.placeAtTop ? minOrder - 1 : maxOrder + 1,
      userId,
    });
  },
});

export const update = mutation({
  args: { agent: agentValidator,
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    priority: v.optional(
      v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))
    ),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    scheduledDate: v.optional(v.string()),
    scheduledStartTime: v.optional(v.string()),
    scheduledEndTime: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    recurrence: v.optional(recurrenceValidator),
    labels: v.optional(v.array(v.string())),
    columnId: v.optional(v.string()),
    parentTaskId: v.optional(v.id("tasks")),
    clearColumnId: v.optional(v.boolean()),
    clearParentTaskId: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    location: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    // Explicit clear flags — when true, clear the corresponding field
    clearDueDate: v.optional(v.boolean()),
    clearDueTime: v.optional(v.boolean()),
    clearScheduledDate: v.optional(v.boolean()),
    clearScheduledStartTime: v.optional(v.boolean()),
    clearScheduledEndTime: v.optional(v.boolean()),
    clearProjectId: v.optional(v.boolean()),
    clearRecurrence: v.optional(v.boolean()),
    clearDescription: v.optional(v.boolean()),
    clearLabels: v.optional(v.boolean()),
    clearLocation: v.optional(v.boolean()),
    // Client-provided local date (format: "YYYY-MM-DD") to avoid UTC drift on the server.
    // Used by clearDueDate/clearScheduledDate handlers to reset to "today" in the user's timezone.
    userDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    // `agent` is who is calling, not a task field: it must never reach the patch.
    const { agent, id, clearDueDate, clearDueTime, clearScheduledDate, clearScheduledStartTime,
      clearScheduledEndTime, clearProjectId, clearRecurrence, clearDescription, clearLabels, clearLocation,
      clearColumnId, clearParentTaskId, userDate, ...updates } = args;
    void agent;

    if (args.recurrence) validateRecurrence(args.recurrence);

    // Build patch: include set values, apply clears
    const patch: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) patch[key] = val;
    }
    if (clearColumnId) patch.columnId = undefined;
    if (clearParentTaskId) patch.parentTaskId = undefined;
    if (args.parentTaskId) {
      const parent = await ctx.db.get("tasks", args.parentTaskId);
      if (!parent || parent.userId !== identity.subject || parent._id === id) throw new Error("Parent task not found");
    }

    // When dueTime changes, keep scheduledStartTime in sync and preserve duration
    if (patch.dueTime && typeof patch.dueTime === "string") {
      const newStart = patch.dueTime as string;
      // If scheduledStartTime wasn't explicitly set, update it to match dueTime
      if (!patch.scheduledStartTime) {
        patch.scheduledStartTime = newStart;
      }
      // If scheduledEndTime wasn't explicitly set, preserve the original duration.
      // The end is clamped to 23:59 on the same day (never wrapped past midnight),
      // matching the rule used by the grid and the Google push.
      if (!patch.scheduledEndTime && task.scheduledStartTime && task.scheduledEndTime) {
        const durMin = durationBetween(task.scheduledStartTime, task.scheduledEndTime);
        if (durMin !== null) {
          patch.scheduledEndTime = clampedEndTime(newStart, durMin);
        }
      }
    }

    // Reject an explicit end that is not after its start; store 23:59 instead
    // of an inverted block that every consumer would have to special-case.
    if (typeof patch.scheduledEndTime === "string") {
      const start = (patch.scheduledStartTime as string | undefined) ?? task.scheduledStartTime;
      if (start && durationBetween(start, patch.scheduledEndTime as string) === null) {
        patch.scheduledEndTime = clampedEndTime(start, MAX_DAY_MIN);
      }
    }

    // Linking to a Google event counts as a sync point, so the next pull does
    // not overwrite local content with the (identical or older) Google copy.
    if (typeof patch.googleEventId === "string" && patch.googleEventId !== task.googleEventId) {
      patch.lastSyncedAt = Date.now();
    }

    // When dueDate changes, keep scheduledDate in sync
    if (patch.dueDate && !patch.scheduledDate) {
      patch.scheduledDate = patch.dueDate;
    }

    // When status changes to "done", auto-set completedAt. When leaving "done", clear it.
    if (patch.status === "done" && task.status !== "done") {
      patch.completedAt = Date.now();
    } else if (patch.status && patch.status !== "done" && task.status === "done") {
      patch.completedAt = undefined;
    }

    // Clearing date resets to today — tasks must always have a date to stay visible.
    // Prefer client-supplied userDate (local timezone) over server UTC date.
    if (clearDueDate) {
      const today = userDate || new Date().toISOString().slice(0, 10);
      patch.dueDate = today;
      patch.scheduledDate = today;
    }
    if (clearDueTime) patch.dueTime = undefined;
    if (clearScheduledDate) {
      const today = userDate || new Date().toISOString().slice(0, 10);
      patch.scheduledDate = today;
    }
    if (clearScheduledStartTime) patch.scheduledStartTime = undefined;
    if (clearScheduledEndTime) patch.scheduledEndTime = undefined;
    if (clearProjectId) patch.projectId = undefined;
    if (clearRecurrence) patch.recurrence = undefined;
    if (clearDescription) patch.description = undefined;
    if (clearLabels) patch.labels = undefined;
    if (clearLocation) patch.location = undefined;

    // Whenever the date or the rule moves, reconcile them: a task must never
    // sit on a day its own repeat rule cannot produce. Deliberately scoped to
    // edits that touch one of the two, so renaming a task never reschedules it.
    if (!clearRecurrence && (patch.recurrence !== undefined || patch.dueDate !== undefined)) {
      const due = (patch.dueDate as string | undefined) ?? task.dueDate;
      const rec = normalizeRecurrence((patch.recurrence ?? task.recurrence) as StoredRecurrence | undefined, due);
      if (rec && due) {
        const aligned = alignDateToRecurrence(rec, due);
        if (aligned !== due) {
          patch.dueDate = aligned;
          patch.scheduledDate = aligned;
        }
      }
    }

    await ctx.db.patch("tasks", id, patch);
  },
});

/**
 * Result of completing a task. `rolled` means the task repeats: it was NOT
 * marked done; a done snapshot was written and the live task moved to
 * `next`. Callers move the Google event to `next` instead of prefixing [Done].
 */
export type CompleteResult = {
  googleEventId?: string;
  googleCalendarId?: string;
  rolled: boolean;
  next?: { date: string; start?: string; end?: string };
  snapshotId?: Id<"tasks">;
};

/**
 * Mark a task done. For a repeating task this writes a done copy for history
 * and advances the live task to its next occurrence (keeping its Google link).
 * The next occurrence is computed strictly after max(task date, today) so a
 * task completed late does not land in the past.
 */
async function completeTask(ctx: MutationCtx, task: Doc<"tasks">, userDate?: string): Promise<CompleteResult> {
  const base = { googleEventId: task.googleEventId, googleCalendarId: task.googleCalendarId };
  const today = userDate || new Date().toISOString().slice(0, 10);
  const anchor = task.dueDate || task.scheduledDate || today;
  const rec = normalizeRecurrence(task.recurrence, anchor);
  const from = anchor > today ? anchor : today;
  const next = rec ? nextOccurrence(rec, from, anchor) : null;

  if (!rec || !next) {
    // Not repeating, or the rule has run out: plain completion.
    await ctx.db.patch("tasks", task._id, {
      status: "done",
      completedAt: Date.now(),
      ...(rec && !next ? { recurrence: undefined } : {}),
    });
    return { ...base, rolled: false };
  }

  // 1. History: a done copy of this occurrence, unlinked from Google and the rule.
  const { _id, _creationTime, ...fields } = task;
  void _id; void _creationTime;
  const snapshotId = await ctx.db.insert("tasks", {
    ...fields,
    seriesId: task._id,
    status: "done",
    completedAt: Date.now(),
    recurrence: undefined,
    googleEventId: undefined,
    googleCalendarId: undefined,
    lastSyncedAt: undefined,
    googleUpdatedAt: undefined,
    htmlLink: undefined,
  });

  // 2. Advance the live task. Weekly slots may dictate their own time.
  const patch: Record<string, unknown> = {
    dueDate: next.date,
    scheduledDate: next.date,
    recurrence: rec, // persist the normalised form so legacy strings retire
    status: task.status === "done" ? "todo" : task.status,
    completedAt: undefined,
  };
  let start = next.start;
  let end = next.end;
  if (start) {
    const dur = durationBetween(task.scheduledStartTime, task.scheduledEndTime) ?? 60;
    end = end && durationBetween(start, end) !== null ? end : clampedEndTime(start, dur);
    patch.dueTime = start;
    patch.scheduledStartTime = start;
    patch.scheduledEndTime = end;
  } else {
    start = task.scheduledStartTime || task.dueTime;
    end = task.scheduledEndTime;
  }
  await ctx.db.patch("tasks", task._id, patch);

  return { ...base, rolled: true, next: { date: next.date, start, end }, snapshotId };
}

export const toggleComplete = mutation({
  args: { agent: agentValidator,
    id: v.id("tasks"),
    // Client local date ("YYYY-MM-DD") so recurring tasks roll relative to the user's today.
    userDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CompleteResult> => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    if (task.status === "done") {
      // Un-completing a repeating task's snapshot means "I did not actually do
      // that one". The snapshot carries no rule, so reviving it in place would
      // leave a second live row beside the series that never repeats again.
      // Retract the record instead, and move the series back onto that date
      // when it is the most recent completion.
      if (task.seriesId) {
        const live = await ctx.db.get("tasks", task.seriesId);
        const snapDate = task.dueDate || task.scheduledDate;
        if (live && live.userId === identity.subject && snapDate) {
          const newer = await ctx.db
            .query("tasks")
            .withIndex("by_seriesId", (q) => q.eq("seriesId", task.seriesId!))
            .collect();
          const isLatest = !newer.some((s) => s._id !== task._id && (s.dueDate || s.scheduledDate || "") > snapDate);
          if (isLatest) {
            await ctx.db.patch("tasks", live._id, {
              dueDate: snapDate,
              scheduledDate: task.scheduledDate || snapDate,
              dueTime: task.dueTime,
              scheduledStartTime: task.scheduledStartTime,
              scheduledEndTime: task.scheduledEndTime,
              status: live.status === "done" ? "todo" : live.status,
              completedAt: undefined,
            });
          }
          await ctx.db.delete("tasks", task._id);
          return {
            googleEventId: live.googleEventId,
            googleCalendarId: live.googleCalendarId,
            rolled: isLatest,
            ...(isLatest ? { next: { date: snapDate, start: task.scheduledStartTime || task.dueTime, end: task.scheduledEndTime } } : {}),
          };
        }
      }
      await ctx.db.patch("tasks", args.id, {
        status: "todo",
        completedAt: undefined,
      });
      return { googleEventId: task.googleEventId, googleCalendarId: task.googleCalendarId, rolled: false };
    }

    const result = await completeTask(ctx, task, args.userDate);
    await maybeCompleteParent(ctx, task, identity.subject);
    return result;
  },
});

/** Settings: complete the parent once every sub-issue is done. */
async function maybeCompleteParent(ctx: MutationCtx, task: Doc<"tasks">, userId: string) {
  if (!task.parentTaskId) return;
  const prefs = await ctx.db.query("userPreferences").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
  const on = (prefs?.prefs as { general?: { completeParentWhenSubtasksDone?: boolean } } | undefined)?.general?.completeParentWhenSubtasksDone;
  if (!on) return;
  const parent = await ctx.db.get("tasks", task.parentTaskId);
  if (!parent || parent.status === "done") return;
  const siblings = await ctx.db.query("tasks").withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", parent._id)).collect();
  if (siblings.every((s) => s.status === "done" || s._id === task._id)) await completeTask(ctx, parent);
}

export const remove = mutation({
  args: { agent: agentValidator, id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    // Also remove subtasks
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const subtask of subtasks) {
      await ctx.db.delete("tasks", subtask._id);
    }

    await ctx.db.delete("tasks", args.id);

    // Return google info so the UI can handle Google Calendar deletion if needed
    return { googleEventId: task.googleEventId, googleCalendarId: task.googleCalendarId };
  },
});

export const bulkUpdateStatus = mutation({
  args: { agent: agentValidator,
    ids: v.array(v.id("tasks")),
    status: v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done")),
    userDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");

    const results: Array<{ id: Id<"tasks"> } & CompleteResult> = [];
    for (const id of args.ids) {
      const task = await ctx.db.get("tasks", id);
      if (!task || task.userId !== identity.subject) continue;
      if (args.status === "done" && task.status !== "done") {
        results.push({ id, ...(await completeTask(ctx, task, args.userDate)) });
      } else {
        await ctx.db.patch("tasks", id, {
          status: args.status,
          completedAt: args.status === "done" ? Date.now() : undefined,
        });
        results.push({ id, googleEventId: task.googleEventId, googleCalendarId: task.googleCalendarId, rolled: false });
      }
    }
    return results;
  },
});

// ─── Google Calendar Sync Mutations ───

/**
 * Helper: parse an ISO datetime string into dueDate (YYYY-MM-DD),
 * dueTime (HH:MM), and scheduledStartTime/scheduledEndTime (HH:MM).
 */
function parseGoogleDateTime(
  startDateTime: string | undefined,
  endDateTime: string | undefined,
  startDate: string | undefined,
) {
  let dueDate: string | undefined;
  let dueTime: string | undefined;
  let scheduledDate: string | undefined;
  let scheduledStartTime: string | undefined;
  let scheduledEndTime: string | undefined;

  // Parse date and time from an ISO string, handling timezone correctly.
  //
  // Google Calendar returns 3 formats:
  // 1. With offset: "2026-03-22T14:30:00+01:00" → extract 14:30 directly (already local)
  // 2. UTC (Z):     "2026-03-22T08:00:00Z"      → convert to local using offset
  // 3. No tz info:  "2026-03-22T09:00:00"        → treat as local (already correct)
  //
  // For format (1) and (3), regex extraction is correct.
  // For format (2), we need to convert UTC to the event's timezone.
  function extractDateAndTime(iso: string): { date: string; time: string } {
    const pad = (n: number) => String(n).padStart(2, "0");

    // Check if the string ends with 'Z' (UTC) — needs conversion
    if (iso.endsWith("Z")) {
      // Use Date to convert UTC to the local environment time
      // Convex runs in UTC, so we can't rely on Date's local timezone.
      // Instead, parse the UTC time and apply the offset manually if we know it.
      // Since we can't use Intl in Convex, extract the offset from other events
      // or just parse the UTC time — the caller should pass timezone-aware strings.
      //
      // Best approach: parse with Date, format in UTC (Convex is UTC),
      // but note: the calling code should convert Z times to local before passing.
      const dt = new Date(iso);
      return {
        date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
        time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
      };
    }

    // Has explicit offset (+01:00, -05:00) or no timezone — extract directly
    const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (match) {
      return { date: match[1], time: match[2] };
    }

    // Fallback
    const dt = new Date(iso);
    return {
      date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
    };
  }

  if (startDateTime) {
    const { date, time } = extractDateAndTime(startDateTime);
    dueDate = date;
    dueTime = time;
    scheduledDate = date;
    scheduledStartTime = time;
  } else if (startDate) {
    // All-day event: "2026-03-22"
    dueDate = startDate;
    scheduledDate = startDate;
  }

  if (endDateTime) {
    const { time } = extractDateAndTime(endDateTime);
    scheduledEndTime = time;
  }

  return { dueDate, dueTime, scheduledDate, scheduledStartTime, scheduledEndTime };
}

export const upsertFromGoogle = mutation({
  args: {
    googleEventId: v.string(),
    googleCalendarId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startDateTime: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDateTime: v.optional(v.string()),
    endDate: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    googleStatus: v.optional(v.string()), // "confirmed" | "tentative" | "cancelled"
    htmlLink: v.optional(v.string()),
    calendarColor: v.optional(v.string()),
    isAllDay: v.boolean(),
    googleUpdatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    // Skip cancelled events and events with no start at all (they could never
    // be rendered and would linger as undated rows).
    if (args.googleStatus === "cancelled") return null;
    if (!args.startDateTime && !args.startDate) return null;

    // Check if task already exists for this Google event
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_userId_and_googleEventId", (q) =>
        q.eq("userId", userId).eq("googleEventId", args.googleEventId)
      )
      .first();

    const parsed = parseGoogleDateTime(args.startDateTime, args.endDateTime, args.startDate);

    if (existing) {
      // Update existing task — preserve user-modified fields (projectId, priority, status)
      const patch: Record<string, unknown> = {
        title: args.title,
        description: args.description,
        googleCalendarId: args.googleCalendarId,
        location: args.location,
        isAllDay: args.isAllDay,
        calendarColor: args.calendarColor,
        htmlLink: args.htmlLink,
        timeZone: args.timeZone,
        googleUpdatedAt: args.googleUpdatedAt,
        lastSyncedAt: Date.now(),
        // Update time fields from Google
        dueDate: parsed.dueDate,
        dueTime: parsed.dueTime,
        scheduledDate: parsed.scheduledDate,
        scheduledStartTime: parsed.scheduledStartTime,
        scheduledEndTime: parsed.scheduledEndTime,
      };

      await ctx.db.patch("tasks", existing._id, patch);
      return existing._id;
    } else {
      // Create new task from Google event
      return await ctx.db.insert("tasks", {
        title: args.title,
        description: args.description,
        status: "todo",
        priority: "p4",
        dueDate: parsed.dueDate,
        dueTime: parsed.dueTime,
        scheduledDate: parsed.scheduledDate,
        scheduledStartTime: parsed.scheduledStartTime,
        scheduledEndTime: parsed.scheduledEndTime,
        googleEventId: args.googleEventId,
        googleCalendarId: args.googleCalendarId,
        source: "google_calendar",
        location: args.location,
        isAllDay: args.isAllDay,
        calendarColor: args.calendarColor,
        htmlLink: args.htmlLink,
        timeZone: args.timeZone,
        googleUpdatedAt: args.googleUpdatedAt,
        lastSyncedAt: Date.now(),
        sortOrder: 0,
        userId,
      });
    }
  },
});

export const bulkUpsertFromGoogle = mutation({
  args: {
    events: v.array(
      v.object({
        googleEventId: v.string(),
        googleCalendarId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        startDateTime: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDateTime: v.optional(v.string()),
        endDate: v.optional(v.string()),
        timeZone: v.optional(v.string()),
        googleStatus: v.optional(v.string()),
        htmlLink: v.optional(v.string()),
        calendarColor: v.optional(v.string()),
        isAllDay: v.boolean(),
        googleUpdatedAt: v.optional(v.string()),
        // Convex task ID stored in Google's extendedProperties for round-trip identification
        unifocusTaskId: v.optional(v.string()),
        /** Present when this row stands for a whole recurring series (googleEventId is the master). */
        googleRecurringEventId: v.optional(v.string()),
        recurrence: v.optional(recurrenceValidator),
      })
    ),
    // When the events were read from Google (ms). lastSyncedAt is stamped with
    // this, not with the mutation time, so a Google edit made between the fetch
    // and this write is still seen as "newer than our sync" on the next pull.
    fetchedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    const syncStamp = args.fetchedAt ?? Date.now();

    // Get all existing tasks with googleEventId for quick lookup
    const existingTasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const existingByGoogleId = new Map(
      existingTasks
        .filter((t) => t.googleEventId)
        .map((t) => [t.googleEventId!, t])
    );

    // Also build a map by Convex _id string for round-trip matching via unifocusTaskId
    const existingByConvexId = new Map(
      existingTasks.map((t) => [t._id.toString(), t])
    );

    let upserted = 0;
    for (const event of args.events) {
      // Skip cancelled events and events with no start at all
      if (event.googleStatus === "cancelled") continue;
      if (!event.startDateTime && !event.startDate) continue;

      // Try matching by googleEventId first, then by unifocusTaskId (round-trip from pushed local tasks)
      let existing = existingByGoogleId.get(event.googleEventId);
      if (!existing && event.unifocusTaskId) {
        existing = existingByConvexId.get(event.unifocusTaskId) ?? undefined;
      }
      const parsed = parseGoogleDateTime(event.startDateTime, event.endDateTime, event.startDate);

      // A series row replaces every flattened per-instance copy of the same series
      // (ids look like "<master>_20260922T070000Z"). Completed copies stay as history.
      if (event.googleRecurringEventId) {
        const prefix = `${event.googleRecurringEventId}_`;
        for (const t of existingTasks) {
          if (t.source !== "google_calendar" || !t.googleEventId?.startsWith(prefix)) continue;
          if (t.status === "done") continue;
          await ctx.db.delete("tasks", t._id);
          existingByGoogleId.delete(t.googleEventId);
        }
      }

      if (existing) {
        // Update — but DON'T overwrite if user edited more recently than Google's update
        // This prevents the sync from reverting user's drag/resize/rename changes
        const googleUpdatedMs = event.googleUpdatedAt ? new Date(event.googleUpdatedAt).getTime() : 0;
        const lastSynced = existing.lastSyncedAt || 0;
        const userEditedSinceSync = lastSynced > 0 && googleUpdatedMs > 0 && googleUpdatedMs < lastSynced;

        const patch: Record<string, unknown> = {
          // Always update metadata (non-conflicting)
          // Ensure googleEventId is set (important for unifocusTaskId round-trip matches)
          googleEventId: event.googleEventId,
          googleCalendarId: event.googleCalendarId,
          calendarColor: event.calendarColor,
          htmlLink: event.htmlLink,
          timeZone: event.timeZone,
          googleUpdatedAt: event.googleUpdatedAt,
          lastSyncedAt: syncStamp,
        };

        if (event.googleRecurringEventId) {
          // Series: the rule and metadata always follow Google. The date follows
          // Google's next instance unless the user already rolled this task past it
          // by completing it here, in which case the local roll wins.
          patch.googleRecurringEventId = event.googleRecurringEventId;
          if (event.recurrence) patch.recurrence = event.recurrence;
          patch.title = event.title;
          patch.description = event.description;
          patch.location = event.location;
          const rolledAhead = !!existing.dueDate && !!parsed.dueDate && existing.dueDate > parsed.dueDate && existing.status !== "done";
          if (!rolledAhead) {
            patch.isAllDay = event.isAllDay;
            patch.dueDate = parsed.dueDate;
            patch.dueTime = parsed.dueTime;
            patch.scheduledDate = parsed.scheduledDate;
            patch.scheduledStartTime = parsed.scheduledStartTime;
            patch.scheduledEndTime = parsed.scheduledEndTime;
            if (existing.status === "done") { patch.status = "todo"; patch.completedAt = undefined; }
          }
        } else if (!userEditedSinceSync) {
          // Only overwrite content fields if Google's version is newer (user didn't edit since last sync)
          patch.title = event.title;
          patch.description = event.description;
          patch.location = event.location;
          patch.isAllDay = event.isAllDay;
          patch.dueDate = parsed.dueDate;
          patch.dueTime = parsed.dueTime;
          patch.scheduledDate = parsed.scheduledDate;
          patch.scheduledStartTime = parsed.scheduledStartTime;
          patch.scheduledEndTime = parsed.scheduledEndTime;
        }

        await ctx.db.patch("tasks", existing._id, patch);
      } else {
        // Create new task
        await ctx.db.insert("tasks", {
          title: event.title,
          description: event.description,
          status: "todo",
          priority: "p4",
          dueDate: parsed.dueDate,
          dueTime: parsed.dueTime,
          scheduledDate: parsed.scheduledDate,
          scheduledStartTime: parsed.scheduledStartTime,
          scheduledEndTime: parsed.scheduledEndTime,
          googleEventId: event.googleEventId,
          googleCalendarId: event.googleCalendarId,
          googleRecurringEventId: event.googleRecurringEventId,
          recurrence: event.recurrence,
          source: "google_calendar",
          location: event.location,
          isAllDay: event.isAllDay,
          calendarColor: event.calendarColor,
          htmlLink: event.htmlLink,
          timeZone: event.timeZone,
          googleUpdatedAt: event.googleUpdatedAt,
          lastSyncedAt: syncStamp,
          sortOrder: 0,
          userId,
        });
      }
      upserted++;
    }

    return { upserted };
  },
});

/**
 * Remove Google Calendar tasks from Convex that no longer exist in Google.
 * Called after sync — pass in all googleEventIds that Google returned for the time range.
 * Only removes tasks whose date falls within the synced range.
 */
export const removeDeletedGoogleEvents = mutation({
  args: {
    knownGoogleEventIds: v.array(v.string()),
    syncRangeStart: v.string(), // local "YYYY-MM-DD", inclusive
    syncRangeEnd: v.string(),   // local "YYYY-MM-DD", inclusive
    // When the caller started reading from Google (ms). Rows synced at or after
    // this instant (e.g. inserted by the background incremental pull while the
    // caller's fetch was in flight) are NOT deleted, since the caller's snapshot
    // cannot know about them.
    fetchStartedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const knownSet = new Set(args.knownGoogleEventIds);
    const cutoff = args.fetchStartedAt !== undefined ? args.fetchStartedAt - SYNC_CLOCK_SKEW_MS : null;
    let removed = 0;

    for (const task of allTasks) {
      if (task.source !== "google_calendar" || !task.googleEventId) continue;
      if (knownSet.has(task.googleEventId)) continue;
      // Rows written after the caller's snapshot was taken are out of its view.
      if (cutoff !== null) {
        const seenAt = Math.max(task.lastSyncedAt ?? 0, task._creationTime);
        if (seenAt >= cutoff) continue;
      }
      // Only consider tasks within the synced date range. Undated Google rows can
      // never render, so they are removed whenever Google no longer lists them.
      const taskDate = task.dueDate || task.scheduledDate;
      if (taskDate && (taskDate < args.syncRangeStart || taskDate > args.syncRangeEnd)) continue;
      await ctx.db.delete("tasks", task._id);
      removed++;
    }

    return { removed };
  },
});

/**
 * Remove tasks for specific Google events (used by the incremental pull when
 * Google reports an event as cancelled).
 */
export const removeGoogleEventsByIds = mutation({
  args: { googleEventIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    let removed = 0;
    for (const googleEventId of args.googleEventIds) {
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_googleEventId", (q) =>
          q.eq("userId", userId).eq("googleEventId", googleEventId)
        )
        .first();
      if (!task) continue;
      if (task.source === "google_calendar") {
        await ctx.db.delete("tasks", task._id);
      } else {
        // A local task whose Google copy was deleted: unlink, keep the task.
        await ctx.db.patch("tasks", task._id, { googleEventId: undefined, googleCalendarId: undefined });
      }
      removed++;
    }
    return { removed };
  },
});

/**
 * One-time cleanup: reset Google Calendar tasks that were incorrectly marked as done.
 * Removes "[Done] " prefix from titles, sets status back to "planned", clears completedAt.
 */
export const cleanupGoogleCalendarDone = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    let fixed = 0;
    for (const task of allTasks) {
      if (task.source !== "google_calendar") continue;

      const needsFix = task.status === "done" || (task.title && task.title.startsWith("[Done] "));
      if (!needsFix) continue;

      const cleanTitle = task.title?.replace(/^\[Done\]\s*/, "") || task.title;
      await ctx.db.patch("tasks", task._id, {
        title: cleanTitle,
        status: "planned",
        completedAt: undefined,
      });
      fixed++;
    }

    return { fixed };
  },
});

/**
 * Move every open, locally owned task dated before `today` onto `today`.
 * Used by the optional task rollover setting. Returns how many moved.
 */
export const rolloverOverdue = mutation({
  args: { today: v.string(), includeRecurring: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .collect();
    let moved = 0;
    for (const t of tasks) {
      if (t.status === "done" || t.source === "google_calendar" || t.parentTaskId) continue;
      if (t.recurrence && !args.includeRecurring) continue;
      const d = t.dueDate || t.scheduledDate;
      if (!d || d >= args.today) continue;
      await ctx.db.patch("tasks", t._id, { dueDate: args.today, scheduledDate: args.today });
      moved++;
    }
    return moved;
  },
});
