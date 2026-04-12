import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Sync queue mutations — manages pending Google Calendar sync operations.
 * Tasks are enqueued here instead of making inline GCal API calls.
 */

/** Enqueue a sync operation. Deduplicates by taskId — if a pending entry
 *  already exists for the same task, updates it in place. */
export const enqueue = mutation({
  args: {
    taskId: v.id("tasks"),
    action: v.union(v.literal("push"), v.literal("update"), v.literal("delete")),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;

    // Check for existing pending entry for this task
    const existing = await ctx.db
      .query("pendingSyncQueue")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();

    if (existing) {
      // Merge: if existing is "push" and new is "update", keep "push" (it already needs full creation)
      // If existing is anything and new is "delete", upgrade to "delete"
      const mergedAction = args.action === "delete" ? "delete" : existing.action;
      const mergedPayload = args.action === "delete"
        ? args.payload // delete payload has googleEventId/calendarId
        : { ...(existing.payload as Record<string, unknown> || {}), ...(args.payload as Record<string, unknown> || {}) };

      await ctx.db.patch(existing._id, {
        action: mergedAction,
        payload: mergedPayload,
        createdAt: new Date().toISOString(),
      });
      return existing._id;
    }

    return await ctx.db.insert("pendingSyncQueue", {
      userId,
      taskId: args.taskId,
      action: args.action,
      payload: args.payload,
      retryCount: 0,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  },
});

/** Get pending queue items for the current user. */
export const getPending = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    const items = await ctx.db
      .query("pendingSyncQueue")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", "pending")
      )
      .take(args.limit || 10);

    return items;
  },
});

/** Claim items for processing — set status to "processing". */
export const markProcessing = mutation({
  args: {
    ids: v.array(v.id("pendingSyncQueue")),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    for (const id of args.ids) {
      const item = await ctx.db.get(id);
      if (item && item.status === "pending") {
        await ctx.db.patch(id, { status: "processing", lastAttemptAt: now });
      }
    }
  },
});

/** Mark a queue item as done — deletes it from the queue. */
export const markDone = mutation({
  args: { id: v.id("pendingSyncQueue") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/** Mark a queue item as failed — increment retry count.
 *  If retryCount >= 5, set status to "failed" permanently.
 *  Otherwise, set back to "pending" for retry. */
export const markFailed = mutation({
  args: {
    id: v.id("pendingSyncQueue"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (!item) return;

    const newRetryCount = item.retryCount + 1;
    await ctx.db.patch(args.id, {
      retryCount: newRetryCount,
      errorMessage: args.errorMessage,
      status: newRetryCount >= 5 ? "failed" : "pending",
      lastAttemptAt: new Date().toISOString(),
    });
  },
});

/** Remove all pending/processing entries for a task (used before delete). */
export const clearForTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("pendingSyncQueue")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .collect();

    for (const item of items) {
      await ctx.db.delete(item._id);
    }
  },
});
