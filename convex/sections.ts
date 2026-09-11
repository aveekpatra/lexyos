import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    const sections = await ctx.db
      .query("sections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return sections.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("sections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const maxOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), 0);

    return await ctx.db.insert("sections", {
      name: args.name,
      sortOrder: maxOrder + 1,
      userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("sections"),
    name: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const section = await ctx.db.get("sections", args.id);
    if (!section || section.userId !== identity.subject) {
      throw new Error("Section not found");
    }

    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch("sections", id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("sections") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const section = await ctx.db.get("sections", args.id);
    if (!section || section.userId !== identity.subject) {
      throw new Error("Section not found");
    }

    // Unset sectionId on all tasks in this section
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId_and_sectionId", (q) =>
        q.eq("userId", identity.subject).eq("sectionId", args.id)
      )
      .collect();
    for (const task of tasks) {
      await ctx.db.patch("tasks", task._id, { sectionId: undefined });
    }

    await ctx.db.delete("sections", args.id);
  },
});
