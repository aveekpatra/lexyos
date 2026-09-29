/**
 * The knowledge graph: tasks and notes connected by what their text mentions.
 * Not shown as a graph anywhere; it exists so the agent (and backlinks) can
 * walk from anything to everything related.
 *
 * Mentions are "#142" (a task, by number) and "[[Note title]]" (a note, by
 * title, as in Obsidian). They are re-read from the text on every save, so a
 * deleted mention removes its edge. Manual task links live in taskLinks and
 * are merged in by graph.related.
 */
import type { MutationCtx } from "../_generated/server";

export type NodeKind = "task" | "note";
export type Node = { kind: NodeKind; id: string };

const TASK_REF = /(?<![\w[/#])#(\d{1,6})\b/g;
const NOTE_REF = /\[\[([^\]\n]{1,120})\]\]/g;

/** Every node a text mentions, resolved for this user. Unknown references are skipped. */
export async function resolveMentions(ctx: MutationCtx, userId: string, text: string, self: Node): Promise<Array<Node & { label: string }>> {
  const out = new Map<string, Node & { label: string }>();
  for (const m of text.matchAll(TASK_REF)) {
    const n = Number(m[1]);
    const t = await ctx.db.query("tasks").withIndex("by_userId_and_number", (q) => q.eq("userId", userId).eq("number", n)).first();
    if (t && !(self.kind === "task" && self.id === t._id)) out.set(`task:${t._id}`, { kind: "task", id: t._id, label: `#${n}` });
  }
  // Obsidian forms: [[Title|alias]], [[Title#Heading]], ![[Title]] all point at Title.
  const titles = [...text.matchAll(NOTE_REF)].map((m) => m[1].split("|")[0].split("#")[0].trim().toLowerCase()).filter(Boolean);
  if (titles.length) {
    const notes = await ctx.db.query("notes").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
    for (const title of titles) {
      const note = notes.find((n) => n.title.trim().toLowerCase() === title);
      if (note && !(self.kind === "note" && self.id === note._id)) out.set(`note:${note._id}`, { kind: "note", id: note._id, label: note.title });
    }
  }
  return [...out.values()];
}

/**
 * Makes the node's outgoing mention edges match its text. Returns what was
 * added and removed so the callers can write it into the story.
 */
export async function syncMentions(ctx: MutationCtx, userId: string, from: Node, text: string) {
  const wanted = await resolveMentions(ctx, userId, text, from);
  const existing = await ctx.db.query("graphEdges").withIndex("by_from", (q) => q.eq("fromKind", from.kind).eq("fromId", from.id)).collect();
  const mentions = existing.filter((e) => e.via === "mention");
  const key = (k: string, id: string) => `${k}:${id}`;
  const have = new Set(mentions.map((e) => key(e.toKind, e.toId)));
  const want = new Set(wanted.map((w) => key(w.kind, w.id)));
  const added = wanted.filter((w) => !have.has(key(w.kind, w.id)));
  const removed = mentions.filter((e) => !want.has(key(e.toKind, e.toId)));
  for (const a of added) {
    await ctx.db.insert("graphEdges", { userId, fromKind: from.kind, fromId: from.id, toKind: a.kind, toId: a.id, via: "mention", at: Date.now() });
  }
  for (const r of removed) await ctx.db.delete("graphEdges", r._id);
  return { added, removed: removed.map((r) => ({ kind: r.toKind as NodeKind, id: r.toId })) };
}

/** Drops every edge touching a node (it is being deleted). */
export async function dropNode(ctx: MutationCtx, node: Node) {
  const from = await ctx.db.query("graphEdges").withIndex("by_from", (q) => q.eq("fromKind", node.kind).eq("fromId", node.id)).collect();
  const to = await ctx.db.query("graphEdges").withIndex("by_to", (q) => q.eq("toKind", node.kind).eq("toId", node.id)).collect();
  for (const e of [...from, ...to]) await ctx.db.delete("graphEdges", e._id);
}
