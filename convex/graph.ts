import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { agentValidator, getIdentity } from "./lib/actor";

/**
 * Everything one task or note is connected to, both ways: what its text
 * mentions, what mentions it, and manual task links. For backlinks in the
 * apps and for the agent to gather context before it acts.
 */
export const related = query({
  args: { agent: agentValidator, kind: v.union(v.literal("task"), v.literal("note")), id: v.string() },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const userId = identity.subject;
    const out: Array<{
      kind: "task" | "note"; id: string; title: string; number?: number; status?: string; direction: "out" | "in"; via: string;
    }> = [];
    const seen = new Set<string>();
    const push = async (kind: string, id: string, direction: "out" | "in", via: string) => {
      const key = `${kind}:${id}:${direction}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (kind === "task") {
        const t = await ctx.db.get("tasks", id as Id<"tasks">);
        if (t && t.userId === userId) out.push({ kind: "task", id, title: t.title, number: t.number, status: t.status, direction, via });
      } else {
        const n = await ctx.db.get("notes", id as Id<"notes">);
        if (n && n.userId === userId) out.push({ kind: "note", id, title: n.title || "Untitled", direction, via });
      }
    };
    for (const e of await ctx.db.query("graphEdges").withIndex("by_from", (q) => q.eq("fromKind", args.kind).eq("fromId", args.id)).collect()) {
      if (e.userId === userId) await push(e.toKind, e.toId, "out", e.via);
    }
    for (const e of await ctx.db.query("graphEdges").withIndex("by_to", (q) => q.eq("toKind", args.kind).eq("toId", args.id)).collect()) {
      if (e.userId === userId) await push(e.fromKind, e.fromId, "in", e.via);
    }
    if (args.kind === "task") {
      const id = args.id as Id<"tasks">;
      for (const l of await ctx.db.query("taskLinks").withIndex("by_fromId", (q) => q.eq("fromId", id)).collect()) await push("task", l.toId, "out", "link");
      for (const l of await ctx.db.query("taskLinks").withIndex("by_toId", (q) => q.eq("toId", id)).collect()) await push("task", l.fromId, "in", "link");
    }
    return out;
  },
});

const kindValidator = v.union(v.literal("task"), v.literal("note"));

/** Checks a node exists and belongs to the user. */
async function owned(ctx: { db: any }, userId: string, kind: "task" | "note", id: string) {
  const doc = await ctx.db.get(kind === "task" ? "tasks" : "notes", id);
  return doc && doc.userId === userId ? doc : null;
}

/**
 * Connects any two nodes directly (via "link"), without touching their text.
 * Mentions stay the way text links things; this is for "these belong together".
 */
export const connect = mutation({
  args: { agent: agentValidator, fromKind: kindValidator, fromId: v.string(), toKind: kindValidator, toId: v.string() },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    if (args.fromKind === args.toKind && args.fromId === args.toId) throw new Error("Cannot connect something to itself");
    const [a, b] = [await owned(ctx, userId, args.fromKind, args.fromId), await owned(ctx, userId, args.toKind, args.toId)];
    if (!a || !b) throw new Error("Not found");
    const existing = await ctx.db.query("graphEdges").withIndex("by_from", (q) => q.eq("fromKind", args.fromKind).eq("fromId", args.fromId)).collect();
    if (existing.some((e) => e.via === "link" && e.toKind === args.toKind && e.toId === args.toId)) return;
    await ctx.db.insert("graphEdges", { userId, fromKind: args.fromKind, fromId: args.fromId, toKind: args.toKind, toId: args.toId, via: "link", at: Date.now() });
  },
});

export const disconnect = mutation({
  args: { agent: agentValidator, fromKind: kindValidator, fromId: v.string(), toKind: kindValidator, toId: v.string() },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    for (const [fk, fi, tk, ti] of [[args.fromKind, args.fromId, args.toKind, args.toId], [args.toKind, args.toId, args.fromKind, args.fromId]] as const) {
      const edges = await ctx.db.query("graphEdges").withIndex("by_from", (q) => q.eq("fromKind", fk).eq("fromId", fi)).collect();
      for (const e of edges) if (e.via === "link" && e.toKind === tk && e.toId === ti && e.userId === identity.subject) await ctx.db.delete("graphEdges", e._id);
    }
  },
});
