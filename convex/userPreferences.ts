import { v } from "convex/values";
import { agentValidator, getIdentity } from "./lib/actor";
import { query, mutation } from "./_generated/server";

export const get = query({
  args: { agent: agentValidator,},
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return null;

    return await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
  },
});

export const set = mutation({
  args: {
    theme: v.optional(v.string()),
    projectSort: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // Build patch with only provided fields
    const patch: Record<string, string> = {};
    if (args.theme !== undefined) patch.theme = args.theme;
    if (args.projectSort !== undefined) patch.projectSort = args.projectSort;

    if (existing) {
      await ctx.db.patch("userPreferences", existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("userPreferences", { ...patch, userId });
  },
});

/** Shallow-merge a partial settings object into `prefs`. Keys set to null are removed. */
export const update = mutation({
  args: { agent: agentValidator, prefs: v.any() },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const current = (existing?.prefs ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    for (const [k, val] of Object.entries(args.prefs as Record<string, unknown>)) {
      if (val === null) delete next[k];
      else if (typeof val === "object" && !Array.isArray(val) && typeof current[k] === "object" && current[k] !== null && !Array.isArray(current[k])) {
        next[k] = { ...(current[k] as Record<string, unknown>), ...(val as Record<string, unknown>) };
      } else next[k] = val;
    }
    if (existing) { await ctx.db.patch("userPreferences", existing._id, { prefs: next }); return existing._id; }
    return await ctx.db.insert("userPreferences", { prefs: next, userId });
  },
});
