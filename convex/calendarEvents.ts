/**
 * Calendar sync-state only.
 *
 * All Google Calendar event sync lives in tasks.ts (upsertFromGoogle,
 * bulkUpsertFromGoogle, removeDeletedGoogleEvents). This file is trimmed to the
 * two functions still in use: the per-calendar incremental sync cursor.
 *
 * NOTE: the `calendarEvents` table is intentionally left in schema.ts — Convex
 * errors if an existing table is removed from the schema. The table is unused.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
