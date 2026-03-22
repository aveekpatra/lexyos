import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return favorites.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const add = mutation({
  args: {
    type: v.union(v.literal("project"), v.literal("label")),
    referenceId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Check if already favorited
    const alreadyFavorited = existing.find(
      (f) => f.type === args.type && f.referenceId === args.referenceId
    );
    if (alreadyFavorited) return alreadyFavorited._id;

    const maxOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder), 0);

    return await ctx.db.insert("favorites", {
      type: args.type,
      referenceId: args.referenceId,
      sortOrder: maxOrder + 1,
      userId,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("favorites") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const favorite = await ctx.db.get(args.id);
    if (!favorite || favorite.userId !== identity.subject) {
      throw new Error("Favorite not found");
    }

    await ctx.db.delete(args.id);
  },
});
