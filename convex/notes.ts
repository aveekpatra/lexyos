import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { agentValidator, getIdentity } from "./lib/actor";
import { syncMentions } from "./lib/graph";
import { deleteNoteWithHistory } from "./lib/notesLib";

/** A plain-text taste of the body for lists: first lines, Markdown marks dropped. */
function snippet(body: string): string {
  return body
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+|^\s*[-*+]\s+(\[[ xX]\]\s+)?|^\s*\d+\.\s+|^>\s?/g, "").replace(/[*_`]|\[\[|\]\]/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);
}

/** Who is writing: the agent, the Mac app (client: "mac"), or the web. */
const clientValidator = v.optional(v.string());
function actor(args: { agent?: unknown; client?: string }) {
  return args.agent ? "agent" : args.client === "mac" ? "mac" : "web";
}

const SESSION_MS = 10 * 60_000;

async function event(ctx: MutationCtx, note: Doc<"notes">, who: string, field: string, from?: unknown, to?: unknown) {
  await ctx.db.insert("noteEvents", {
    noteId: note._id, userId: note.userId, at: Date.now(), actor: who, field,
    ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}),
  });
}

/**
 * Body edits are one story line per editing session: the latest "edited"
 * event by the same writer within 10 minutes grows instead of a new line.
 * Versions follow the same session rule.
 */
async function recordEdit(ctx: MutationCtx, before: Doc<"notes">, after: { title: string; body: string }, who: string) {
  const now = Date.now();
  const delta = after.body.length - before.body.length;
  const last = await ctx.db.query("noteEvents").withIndex("by_noteId", (q) => q.eq("noteId", before._id)).order("desc").first();
  if (before.body !== after.body) {
    if (last && last.field === "body" && last.actor === who && now - last.at < SESSION_MS) {
      const prev = (last.to ?? {}) as { added?: number; removed?: number };
      await ctx.db.patch("noteEvents", last._id, {
        at: now,
        to: { added: (prev.added ?? 0) + Math.max(0, delta), removed: (prev.removed ?? 0) + Math.max(0, -delta), length: after.body.length },
      });
    } else {
      await event(ctx, before, who, "body", undefined, { added: Math.max(0, delta), removed: Math.max(0, -delta), length: after.body.length });
    }
  }
  const rev = await ctx.db.query("noteRevisions").withIndex("by_noteId", (q) => q.eq("noteId", before._id)).order("desc").first();
  if (rev && now - rev.at < SESSION_MS) await ctx.db.patch("noteRevisions", rev._id, { at: now, title: after.title, body: after.body });
  else await ctx.db.insert("noteRevisions", { noteId: before._id, userId: before.userId, at: now, title: after.title, body: after.body });
}

/** Re-reads the note's mentions; each new or dropped link is a line in both stories. */
async function syncNoteMentions(ctx: MutationCtx, note: Doc<"notes">, body: string, who: string) {
  const { added, removed } = await syncMentions(ctx, note.userId, { kind: "note", id: note._id }, body);
  for (const a of added) {
    await event(ctx, note, who, "mention", undefined, { kind: a.kind, id: a.id, label: a.label });
    if (a.kind === "task") {
      await ctx.db.insert("taskEvents", { taskId: a.id as Id<"tasks">, userId: note.userId, at: Date.now(), actor: who, field: "mentionedIn", to: { kind: "note", id: note._id, label: note.title || "Untitled" } });
    }
  }
  for (const r of removed) await event(ctx, note, who, "mention", { kind: r.kind, id: r.id }, undefined);
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
    return notes.map((n) => ({
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

/** A note by exact title (case-insensitive), for "[[Title]]" links. */
export const byTitle = query({
  args: { agent: agentValidator, title: v.string() },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return null;
    const want = args.title.trim().toLowerCase();
    const notes = await ctx.db.query("notes").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    return notes.find((n) => n.title.trim().toLowerCase() === want) ?? null;
  },
});

/** Notes whose title or text contains every word of the query, newest first. */
export const search = query({
  args: { agent: agentValidator, query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const words = args.query.toLowerCase().split(/\s+/).filter(Boolean);
    const notes = await ctx.db.query("notes").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    return notes
      .filter((n) => { const hay = `${n.title}\n${n.body}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, args.limit ?? 20)
      .map((n) => ({ _id: n._id, notebookId: n.notebookId, title: n.title, snippet: snippet(n.body), updatedAt: n.updatedAt }));
  },
});

/** A note's story, oldest first. */
export const history = query({
  args: { agent: agentValidator, id: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const note = await ctx.db.get("notes", args.id);
    if (!note || note.userId !== identity.subject) return [];
    return await ctx.db.query("noteEvents").withIndex("by_noteId", (q) => q.eq("noteId", args.id)).order("asc").take(500);
  },
});

/** Saved versions, newest first. */
export const revisions = query({
  args: { agent: agentValidator, id: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const note = await ctx.db.get("notes", args.id);
    if (!note || note.userId !== identity.subject) return [];
    return await ctx.db.query("noteRevisions").withIndex("by_noteId", (q) => q.eq("noteId", args.id)).order("desc").take(100);
  },
});

export const create = mutation({
  args: { agent: agentValidator, client: clientValidator, notebookId: v.id("notebooks"), title: v.optional(v.string()), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const book = await ctx.db.get("notebooks", args.notebookId);
    if (!book || book.userId !== identity.subject) throw new Error("Notebook not found");
    const id = await ctx.db.insert("notes", {
      userId: identity.subject, notebookId: args.notebookId, title: args.title ?? "", body: args.body ?? "",
      sortOrder: Date.now(), updatedAt: Date.now(),
    });
    const note = (await ctx.db.get("notes", id))!;
    const who = actor(args);
    await event(ctx, note, who, "created", undefined, { notebook: book.name });
    if (note.body) {
      await ctx.db.insert("noteRevisions", { noteId: id, userId: note.userId, at: Date.now(), title: note.title, body: note.body });
      await syncNoteMentions(ctx, note, note.body, who);
    }
    return id;
  },
});

export const update = mutation({
  args: {
    agent: agentValidator, client: clientValidator, id: v.id("notes"),
    title: v.optional(v.string()), body: v.optional(v.string()), notebookId: v.optional(v.id("notebooks")),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const note = await ctx.db.get("notes", args.id);
    if (!note || note.userId !== identity.subject) throw new Error("Note not found");
    const who = actor(args);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.notebookId && args.notebookId !== note.notebookId) {
      const book = await ctx.db.get("notebooks", args.notebookId);
      if (!book || book.userId !== identity.subject) throw new Error("Notebook not found");
      const old = await ctx.db.get("notebooks", note.notebookId);
      patch.notebookId = args.notebookId;
      await event(ctx, note, who, "notebook", old?.name, book.name);
    }
    if (args.title !== undefined && args.title !== note.title) {
      patch.title = args.title;
      const last = await ctx.db.query("noteEvents").withIndex("by_noteId", (q) => q.eq("noteId", note._id)).order("desc").first();
      // Typing a title is one rename, not one per keystroke.
      if (last && last.field === "title" && last.actor === who && Date.now() - last.at < SESSION_MS) {
        await ctx.db.patch("noteEvents", last._id, { at: Date.now(), to: args.title });
      } else {
        await event(ctx, note, who, "title", note.title, args.title);
      }
    }
    if (args.body !== undefined) patch.body = args.body;
    await ctx.db.patch("notes", args.id, patch);
    const title = (patch.title as string | undefined) ?? note.title;
    const body = (patch.body as string | undefined) ?? note.body;
    if (title !== note.title || body !== note.body) await recordEdit(ctx, note, { title, body }, who);
    if (args.body !== undefined && args.body !== note.body) await syncNoteMentions(ctx, { ...note, title }, body, who);
  },
});

export const remove = mutation({
  args: { agent: agentValidator, id: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const note = await ctx.db.get("notes", args.id);
    if (!note || note.userId !== identity.subject) throw new Error("Note not found");
    await deleteNoteWithHistory(ctx, args.id);
  },
});
