import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { agentValidator, getIdentity } from "./lib/actor";

/** A plain-text taste of the body for lists: first lines, Markdown marks dropped. */
function snippet(body: string): string {
  return body
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+|^\s*[-*+]\s+(\[[ xX]\]\s+)?|^\s*\d+\.\s+|^>\s?/g, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);
}

/** The notes of a notebook, most recently edited first, without their bodies. */
export const list = query({
  args: { agent: agentValidator, notebookId: v.id("notebooks") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const book = await ctx.db.get("notebooks", args.notebookId);
    if (!book || book.userId !== identity.subject) return [];
    const notes = await ctx.db.query("notes").withIndex("by_notebookId", (q) => q.eq("notebookId", args.notebookId)).order("desc").collect();
    return notes.map((n: Doc<"notes">) => ({
      _id: n._id, notebookId: n.notebookId, title: n.title, snippet: snippet(n.body), updatedAt: n.updatedAt, _creationTime: n._creationTime,
    }));
  },
});

export const get = query({
  args: { agent: agentValidator, id: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return null;
    const note = await ctx.db.get("notes", args.id);
    return note && note.userId === identity.subject ? note : null;
  },
});

export const create = mutation({
  args: { agent: agentValidator, notebookId: v.id("notebooks"), title: v.optional(v.string()), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const book = await ctx.db.get("notebooks", args.notebookId);
    if (!book || book.userId !== identity.subject) throw new Error("Notebook not found");
    return await ctx.db.insert("notes", {
      userId: identity.subject, notebookId: args.notebookId, title: args.title ?? "", body: args.body ?? "",
      sortOrder: Date.now(), updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    agent: agentValidator, id: v.id("notes"),
    title: v.optional(v.string()), body: v.optional(v.string()), notebookId: v.optional(v.id("notebooks")),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const note = await ctx.db.get("notes", args.id);
    if (!note || note.userId !== identity.subject) throw new Error("Note not found");
    if (args.notebookId) {
      const book = await ctx.db.get("notebooks", args.notebookId);
      if (!book || book.userId !== identity.subject) throw new Error("Notebook not found");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title;
    if (args.body !== undefined) patch.body = args.body;
    if (args.notebookId !== undefined) patch.notebookId = args.notebookId;
    await ctx.db.patch("notes", args.id, patch);
  },
});

export const remove = mutation({
  args: { agent: agentValidator, id: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const note = await ctx.db.get("notes", args.id);
    if (!note || note.userId !== identity.subject) throw new Error("Note not found");
    await ctx.db.delete("notes", args.id);
  },
});
