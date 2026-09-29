import { v } from "convex/values";
import { query } from "./_generated/server";
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
