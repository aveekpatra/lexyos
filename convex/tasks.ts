import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) return null;
    return task;
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

    return await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: args.status ?? "todo",
      priority: args.priority ?? "p3",
      dueDate: args.dueDate,
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    const { id, clearDueDate, clearDueTime, clearScheduledDate, clearScheduledStartTime,
      clearScheduledEndTime, clearProjectId, clearSectionId, clearRecurrence, clearDescription,
      ...updates } = args;

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
      // If scheduledEndTime wasn't explicitly set, preserve the original duration
      if (!patch.scheduledEndTime && task.scheduledStartTime && task.scheduledEndTime) {
        const [osh, osm] = task.scheduledStartTime.split(":").map(Number);
        const [oeh, oem] = task.scheduledEndTime.split(":").map(Number);
        const durMin = (oeh * 60 + oem) - (osh * 60 + osm);
        if (durMin > 0) {
          const [nsh, nsm] = newStart.split(":").map(Number);
          const endMin = nsh * 60 + nsm + durMin;
          const endH = String(Math.floor(endMin / 60) % 24).padStart(2, "0");
          const endM = String(endMin % 60).padStart(2, "0");
          patch.scheduledEndTime = `${endH}:${endM}`;
        }
      }
    }

    // When dueDate changes, keep scheduledDate in sync
    if (patch.dueDate && !patch.scheduledDate) {
      patch.scheduledDate = patch.dueDate;
    }
    if (clearDueDate) patch.dueDate = undefined;
    if (clearDueTime) patch.dueTime = undefined;
    if (clearScheduledDate) patch.scheduledDate = undefined;
    if (clearScheduledStartTime) patch.scheduledStartTime = undefined;
    if (clearScheduledEndTime) patch.scheduledEndTime = undefined;
    if (clearProjectId) patch.projectId = undefined;
    if (clearSectionId) patch.sectionId = undefined;
    if (clearRecurrence) patch.recurrence = undefined;
    if (clearDescription) patch.description = undefined;

    await ctx.db.patch(id, patch);
  },
});

export const toggleComplete = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    if (task.status === "done") {
      await ctx.db.patch(args.id, {
        status: "todo",
        completedAt: undefined,
      });
    } else {
      await ctx.db.patch(args.id, {
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

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    // Also remove subtasks
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const subtask of subtasks) {
      await ctx.db.delete(subtask._id);
    }

    await ctx.db.delete(args.id);

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
      const task = await ctx.db.get(id);
      if (task && task.userId === identity.subject) {
        await ctx.db.patch(id, {
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

    // Skip cancelled events
    if (args.googleStatus === "cancelled") return null;

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

      await ctx.db.patch(existing._id, patch);
      return existing._id;
    } else {
      // Create new task from Google event
      return await ctx.db.insert("tasks", {
        title: args.title,
        description: args.description,
        status: "planned",
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

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
      // Skip cancelled events
      if (event.googleStatus === "cancelled") continue;

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
          lastSyncedAt: Date.now(),
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

        await ctx.db.patch(existing._id, patch);
      } else {
        // Create new task
        await ctx.db.insert("tasks", {
          title: event.title,
          description: event.description,
          status: "planned",
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
          lastSyncedAt: Date.now(),
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
    syncRangeStart: v.string(), // ISO date
    syncRangeEnd: v.string(),   // ISO date
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
    let removed = 0;

    for (const task of allTasks) {
      if (task.source !== "google_calendar" || !task.googleEventId) continue;
      // Only consider tasks within the synced date range
      const taskDate = task.dueDate || task.scheduledDate;
      if (!taskDate) continue;
      if (taskDate < args.syncRangeStart || taskDate > args.syncRangeEnd) continue;
      // If Google didn't return this event, it was deleted
      if (!knownSet.has(task.googleEventId)) {
        await ctx.db.delete(task._id);
        removed++;
      }
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
      await ctx.db.patch(task._id, {
        title: cleanTitle,
        status: "planned",
        completedAt: undefined,
      });
      fixed++;
    }

    return { fixed };
  },
});
