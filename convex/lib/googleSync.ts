/**
 * Server-owned Google Calendar sync, queue side.
 *
 * A client opts in by passing `syncTimeZone` (its IANA zone) to a task
 * mutation. The mutation then records what changed in `pendingSyncQueue` and
 * schedules `googleSync.run`, which makes the Google event match the task.
 * Clients that do not pass it (the web app, which still syncs from the
 * browser) are untouched, so no event is ever written twice with different
 * times.
 */
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/** The zone timed events are written in. Opting in is passing it. */
export const syncTimeZoneValidator = v.optional(v.string());

type Action = "push" | "update" | "delete";

/**
 * Queue one sync for a task, merged with anything still pending for it:
 * a pending push stays a push (it builds from current state anyway), and a
 * delete replaces whatever was queued.
 */
export async function queueGoogleSync(
  ctx: MutationCtx,
  userId: string,
  taskId: Id<"tasks">,
  action: Action,
  timeZone: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const payload = { ...extra, timeZone };
  const existing = await ctx.db
    .query("pendingSyncQueue")
    .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .first();
  if (existing) {
    await ctx.db.patch("pendingSyncQueue", existing._id, {
      action: action === "delete" ? "delete" : existing.action,
      payload: { ...((existing.payload as Record<string, unknown>) ?? {}), ...payload },
      createdAt: new Date().toISOString(),
    });
    // A run is already scheduled for the pending row.
    return;
  }
  await ctx.db.insert("pendingSyncQueue", {
    userId,
    taskId,
    action,
    payload,
    retryCount: 0,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  await ctx.scheduler.runAfter(0, internal.googleSync.run, { userId });
}
