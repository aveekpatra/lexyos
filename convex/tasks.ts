import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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
  args: {
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    projectId: v.optional(v.id("projects")),
    scheduledDate: v.optional(v.string()),
    source: v.optional(v.union(v.literal("local"), v.literal("google_calendar"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
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
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) return null;
    return task;
  },
});

export const getByGmailThread = query({
  args: { gmailThreadId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId_and_gmailThreadId", (q) =>
        q.eq("userId", identity.subject).eq("gmailThreadId", args.gmailThreadId)
      )
      .collect();
    return tasks[0] || null;
  },
});

export const getSubtasks = query({
  args: { parentTaskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
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
  args: {
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
    sectionId: v.optional(v.id("sections")),
    recurrence: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    // Gmail linking
    gmailMessageId: v.optional(v.string()),
    gmailThreadId: v.optional(v.string()),
    gmailSubject: v.optional(v.string()),
    // Client-provided local date (format: "YYYY-MM-DD") to avoid UTC drift on the server.
    // Falls back to server UTC date if not provided.
    userDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const maxOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), 0);

    // Default dueDate to today if not provided — tasks must always have a date.
    // Prefer client-supplied userDate (local timezone) over server UTC date.
    const today = args.userDate || new Date().toISOString().slice(0, 10);

    return await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: args.status ?? "todo",
      priority: args.priority ?? "p3",
      dueDate: args.dueDate || today,
      dueTime: args.dueTime,
      scheduledDate: args.scheduledDate,
      scheduledStartTime: args.scheduledStartTime,
      scheduledEndTime: args.scheduledEndTime,
      projectId: args.projectId,
      sectionId: args.sectionId,
      recurrence: args.recurrence,
      labels: args.labels,
      parentTaskId: args.parentTaskId,
      googleEventId: args.googleEventId,
      googleCalendarId: args.googleCalendarId,
      gmailMessageId: args.gmailMessageId,
      gmailThreadId: args.gmailThreadId,
      gmailSubject: args.gmailSubject,
      source: "local",
      sortOrder: maxOrder + 1,
      userId,
    });
  },
});

export const update = mutation({
  args: {
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
    sectionId: v.optional(v.id("sections")),
    recurrence: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    sortOrder: v.optional(v.number()),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    // Explicit clear flags — when true, clear the corresponding field
    clearDueDate: v.optional(v.boolean()),
    clearDueTime: v.optional(v.boolean()),
    clearScheduledDate: v.optional(v.boolean()),
    clearScheduledStartTime: v.optional(v.boolean()),
    clearScheduledEndTime: v.optional(v.boolean()),
    clearProjectId: v.optional(v.boolean()),
    clearSectionId: v.optional(v.boolean()),
    clearRecurrence: v.optional(v.boolean()),
    clearDescription: v.optional(v.boolean()),
    // Client-provided local date (format: "YYYY-MM-DD") to avoid UTC drift on the server.
    // Used by clearDueDate/clearScheduledDate handlers to reset to "today" in the user's timezone.
    userDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    const { id, clearDueDate, clearDueTime, clearScheduledDate, clearScheduledStartTime,
      clearScheduledEndTime, clearProjectId, clearSectionId, clearRecurrence, clearDescription,
      userDate, ...updates } = args;

    // Build patch: include set values, apply clears
    const patch: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) patch[key] = val;
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
    if (clearSectionId) patch.sectionId = undefined;
    if (clearRecurrence) patch.recurrence = undefined;
    if (clearDescription) patch.description = undefined;

    await ctx.db.patch("tasks", id, patch);
  },
});

export const toggleComplete = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get("tasks", args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    if (task.status === "done") {
      await ctx.db.patch("tasks", args.id, {
        status: "todo",
        completedAt: undefined,
      });
    } else {
      await ctx.db.patch("tasks", args.id, {
        status: "done",
        completedAt: Date.now(),
      });
    }

    // Return googleEventId so the UI can handle Google Calendar sync if needed
    return { googleEventId: task.googleEventId, googleCalendarId: task.googleCalendarId };
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
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
  args: {
    ids: v.array(v.id("tasks")),
    status: v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    for (const id of args.ids) {
      const task = await ctx.db.get("tasks", id);
      if (task && task.userId === identity.subject) {
        await ctx.db.patch("tasks", id, {
          status: args.status,
          completedAt: args.status === "done" ? Date.now() : undefined,
        });
      }
    }
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

        // Only overwrite content fields if Google's version is newer (user didn't edit since last sync)
        if (!userEditedSinceSync) {
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
