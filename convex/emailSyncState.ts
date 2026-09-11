import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("emailSyncState")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
  },
});

export const upsert = mutation({
  args: {
    lastHistoryId: v.string(),
    lastSyncedAt: v.number(),
    lastFullSyncAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("emailSyncState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const patch: Record<string, unknown> = {
      lastHistoryId: args.lastHistoryId,
      lastSyncedAt: args.lastSyncedAt,
    };
    if (args.lastFullSyncAt !== undefined) {
      patch.lastFullSyncAt = args.lastFullSyncAt;
    }

    if (existing) {
      await ctx.db.patch("emailSyncState", existing._id, patch);
    } else {
      await ctx.db.insert("emailSyncState", {
        lastHistoryId: args.lastHistoryId,
        lastSyncedAt: args.lastSyncedAt,
        lastFullSyncAt: args.lastFullSyncAt,
        userId,
      });
    }
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("emailSyncState")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (existing) {
      await ctx.db.delete("emailSyncState", existing._id);
    }
  },
});
