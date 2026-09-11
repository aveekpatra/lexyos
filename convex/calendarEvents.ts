/**
 * @deprecated This file is no longer actively used. All Google Calendar sync
 * logic has been unified into tasks.ts (upsertFromGoogle, bulkUpsertFromGoogle,
 * removeDeletedGoogleEvents). The calendarEvents table and this file are kept
 * to avoid Convex schema errors from removing an existing table, but no new
 * code should reference these functions. Use the equivalents in tasks.ts instead.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Queries ───

export const list = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    let events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Filter cancelled
    events = events.filter((e) => e.status !== "cancelled");

    // Filter by date range if provided
    if (args.startDate || args.endDate) {
      events = events.filter((e) => {
        const eventDate = e.startDateTime || e.startDate || "";
        if (args.startDate && eventDate < args.startDate) return false;
        if (args.endDate && eventDate > args.endDate) return false;
        return true;
      });
    }

    // Sort by start time
    events.sort((a, b) => {
      const aTime = a.startDateTime || a.startDate || "";
      const bTime = b.startDateTime || b.startDate || "";
      return aTime.localeCompare(bTime);
    });

    return events;
  },
});

export const getByGoogleId = query({
  args: { googleEventId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;

    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_userId_and_googleEventId", (q) =>
        q.eq("userId", userId).eq("googleEventId", args.googleEventId)
      )
      .collect();

    return events[0] ?? null;
  },
});

export const getByLinkedTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;

    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_userId_and_linkedTaskId", (q) =>
        q.eq("userId", userId).eq("linkedTaskId", args.taskId)
      )
      .collect();

    return events[0] ?? null;
  },
});

// ─── Mutations ───

export const upsertFromGoogle = mutation({
  args: {
    googleEventId: v.string(),
    googleCalendarId: v.string(),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startDateTime: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDateTime: v.optional(v.string()),
    endDate: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    status: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    colorId: v.optional(v.string()),
    calendarColor: v.optional(v.string()),
    isAllDay: v.boolean(),
    googleUpdatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    // Check if event already exists
    const existing = await ctx.db
      .query("calendarEvents")
      .withIndex("by_userId_and_googleEventId", (q) =>
        q.eq("userId", userId).eq("googleEventId", args.googleEventId)
      )
      .first();

    const data = {
      ...args,
      lastSyncedAt: Date.now(),
      userId,
    };

    if (existing) {
      // Update, but preserve linkedTaskId
      await ctx.db.patch("calendarEvents", existing._id, {
        ...data,
        linkedTaskId: existing.linkedTaskId,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("calendarEvents", data);
    }
  },
});

export const create = mutation({
  args: {
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    summary: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startDateTime: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDateTime: v.optional(v.string()),
    endDate: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    linkedTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    return await ctx.db.insert("calendarEvents", {
      googleEventId: args.googleEventId || `local-${Date.now()}`,
      googleCalendarId: args.googleCalendarId || "primary",
      summary: args.summary,
      description: args.description,
      location: args.location,
      startDateTime: args.startDateTime,
      startDate: args.startDate,
      endDateTime: args.endDateTime,
      endDate: args.endDate,
      timeZone: args.timeZone,
      status: "confirmed",
      isAllDay: args.isAllDay ?? false,
      linkedTaskId: args.linkedTaskId,
      lastSyncedAt: Date.now(),
      userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("calendarEvents"),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startDateTime: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDateTime: v.optional(v.string()),
    endDate: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    status: v.optional(v.string()),
    linkedTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const event = await ctx.db.get("calendarEvents", args.id);
    if (!event || event.userId !== identity.subject) {
      throw new Error("Event not found");
    }

    const { id, ...updates } = args;
    // Remove undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch("calendarEvents", id, cleanUpdates);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const event = await ctx.db.get("calendarEvents", args.id);
    if (!event || event.userId !== identity.subject) {
      throw new Error("Event not found");
    }

    await ctx.db.delete("calendarEvents", args.id);
  },
});

export const linkToTask = mutation({
  args: {
    id: v.id("calendarEvents"),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const event = await ctx.db.get("calendarEvents", args.id);
    if (!event || event.userId !== identity.subject) {
      throw new Error("Event not found");
    }

    await ctx.db.patch("calendarEvents", args.id, { linkedTaskId: args.taskId });
  },
});

// Bulk upsert for sync — more efficient than individual calls
export const bulkUpsertFromGoogle = mutation({
  args: {
    events: v.array(
      v.object({
        googleEventId: v.string(),
        googleCalendarId: v.string(),
        summary: v.optional(v.string()),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        startDateTime: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDateTime: v.optional(v.string()),
        endDate: v.optional(v.string()),
        timeZone: v.optional(v.string()),
        status: v.optional(v.string()),
        htmlLink: v.optional(v.string()),
        colorId: v.optional(v.string()),
        calendarColor: v.optional(v.string()),
        isAllDay: v.boolean(),
        googleUpdatedAt: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    // Get all existing events for this user for quick lookup
    const existingEvents = await ctx.db
      .query("calendarEvents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const existingMap = new Map(
      existingEvents.map((e) => [e.googleEventId, e])
    );

    let upserted = 0;
    for (const event of args.events) {
      const existing = existingMap.get(event.googleEventId);
      const data = {
        ...event,
        lastSyncedAt: Date.now(),
        userId,
      };

      if (existing) {
        await ctx.db.patch("calendarEvents", existing._id, {
          ...data,
          linkedTaskId: existing.linkedTaskId, // preserve task link
        });
      } else {
        await ctx.db.insert("calendarEvents", data);
      }
      upserted++;
    }

    return { upserted };
  },
});

// Update sync state
export const updateSyncState = mutation({
  args: {
    googleCalendarId: v.string(),
    calendarName: v.optional(v.string()),
    calendarColor: v.optional(v.string()),
    syncToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("calendarSyncState")
      .withIndex("by_userId_and_calendarId", (q) =>
        q.eq("userId", userId).eq("googleCalendarId", args.googleCalendarId)
      )
      .first();

    if (existing) {
      await ctx.db.patch("calendarSyncState", existing._id, {
        ...args,
        lastSyncedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("calendarSyncState", {
        ...args,
        lastSyncedAt: Date.now(),
        userId,
      });
    }
  },
});

export const getSyncState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    return await ctx.db
      .query("calendarSyncState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});
