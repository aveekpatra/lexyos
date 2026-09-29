import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { dropNode } from "./graph";

/** Deletes a note with its story, versions and graph edges. */
export async function deleteNoteWithHistory(ctx: MutationCtx, id: Id<"notes">) {
  await dropNode(ctx, { kind: "note", id });
  for (const e of await ctx.db.query("noteEvents").withIndex("by_noteId", (q) => q.eq("noteId", id)).collect()) await ctx.db.delete("noteEvents", e._id);
  for (const r of await ctx.db.query("noteRevisions").withIndex("by_noteId", (q) => q.eq("noteId", id)).collect()) await ctx.db.delete("noteRevisions", r._id);
  await ctx.db.delete("notes", id);
}
