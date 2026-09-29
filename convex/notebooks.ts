import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { agentValidator, getIdentity } from "./lib/actor";
import { deleteNoteWithHistory } from "./lib/notesLib";

/** Notebooks, in the user's order, each with how many notes it holds. */
export const list = query({
  args: { agent: agentValidator },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const books = await ctx.db.query("notebooks").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    const out = [];
    for (const b of books.sort((a, c) => a.sortOrder - c.sortOrder)) {
      const notes = await ctx.db.query("notes").withIndex("by_notebookId", (q) => q.eq("notebookId", b._id)).collect();
      out.push({ ...b, noteCount: notes.length });
    }
    return out;
  },
});

export const create = mutation({
  args: { agent: agentValidator, name: v.string(), icon: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const existing = await ctx.db.query("notebooks").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    const order = existing.reduce((m, b) => Math.max(m, b.sortOrder), 0) + 1;
    return await ctx.db.insert("notebooks", {
      userId: identity.subject, name: args.name.trim() || "Untitled", icon: args.icon, color: args.color, sortOrder: order,
    });
  },
});

export const update = mutation({
  args: { agent: agentValidator, id: v.id("notebooks"), name: v.optional(v.string()), icon: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const book = await ctx.db.get("notebooks", args.id);
    if (!book || book.userId !== identity.subject) throw new Error("Notebook not found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim() || book.name;
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.color !== undefined) patch.color = args.color;
    await ctx.db.patch("notebooks", args.id, patch);
  },
});

/** Deletes the notebook and every note in it. */
export const remove = mutation({
  args: { agent: agentValidator, id: v.id("notebooks") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const book = await ctx.db.get("notebooks", args.id);
    if (!book || book.userId !== identity.subject) throw new Error("Notebook not found");
    const notes = await ctx.db.query("notes").withIndex("by_notebookId", (q) => q.eq("notebookId", args.id)).collect();
    for (const n of notes) await deleteNoteWithHistory(ctx, n._id);
    await ctx.db.delete("notebooks", args.id);
  },
});
