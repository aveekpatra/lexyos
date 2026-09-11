import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (!settings) return null;

    // Mask the API key for display
    const maskedKey =
      settings.apiKey.length > 8
        ? settings.apiKey.slice(0, 4) + "..." + settings.apiKey.slice(-4)
        : "****";

    return {
      _id: settings._id,
      apiKey: maskedKey,
      model: settings.model,
      userId: settings.userId,
    };
  },
});

export const getFullKey = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const settings = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (!settings) return null;

    return {
      apiKey: settings.apiKey,
      model: settings.model,
    };
  },
});

export const upsert = mutation({
  args: {
    apiKey: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("aiSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch("aiSettings", existing._id, {
        apiKey: args.apiKey,
        model: args.model,
      });
      return existing._id;
    }

    return await ctx.db.insert("aiSettings", {
      apiKey: args.apiKey,
      model: args.model,
      userId,
    });
  },
});
