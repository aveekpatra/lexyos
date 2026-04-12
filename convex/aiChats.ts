import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const chat = await ctx.db
      .query("aiChats")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    return chat;
  },
});

export const save = mutation({
  args: {
    messages: v.array(v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
      toolCalls: v.optional(v.array(v.object({
        toolName: v.string(),
        input: v.any(),
        output: v.any(),
      }))),
    })),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("aiChats")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { messages: args.messages });
    } else {
      await ctx.db.insert("aiChats", { messages: args.messages, userId });
    }
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("aiChats")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { messages: [] });
    }
  },
});
