import type { MutationCtx } from "../_generated/server";

/**
 * Stable per-account task numbers (#1, #2, ...), shown in the task detail and
 * accepted anywhere a task id is. One sequence per user, not per project: tasks
 * move between the inbox and projects, and a project-prefixed key would either
 * change or lie after the move.
 *
 * Done snapshots of a repeating task are history, not tasks, so they take no
 * number; the live row keeps the series' number for its whole life.
 */

/** Give every unnumbered live task a number, oldest first, and return the next free one. */
async function numberExisting(ctx: MutationCtx, userId: string): Promise<number> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  let next = tasks.reduce((max, t) => Math.max(max, t.number ?? 0), 0) + 1;
  const unnumbered = tasks
    .filter((t) => t.number === undefined && !t.seriesId)
    .sort((a, b) => a._creationTime - b._creationTime);
  for (const t of unnumbered) await ctx.db.patch("tasks", t._id, { number: next++ });
  return next;
}

/** Ensure the user's counter exists (numbering their existing tasks the first time). */
export async function ensureTaskCounter(ctx: MutationCtx, userId: string) {
  const counter = await ctx.db
    .query("taskCounters")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (counter) return counter;
  const next = await numberExisting(ctx, userId);
  const id = await ctx.db.insert("taskCounters", { userId, next });
  return (await ctx.db.get("taskCounters", id))!;
}

/** Reserve the next number for a task about to be inserted. */
export async function claimTaskNumber(ctx: MutationCtx, userId: string): Promise<number> {
  const counter = await ensureTaskCounter(ctx, userId);
  await ctx.db.patch("taskCounters", counter._id, { next: counter.next + 1 });
  return counter.next;
}
