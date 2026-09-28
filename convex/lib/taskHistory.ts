/**
 * A task's story: one taskEvents row per change, written by every mutation
 * that touches a task. recordChanges compares the task before and after a
 * write, so the log always matches what really changed.
 *
 * Fields are recorded the way a person reads them, not as stored: the day is
 * one field (dueDate and scheduledDate move together), and the time is one
 * field ("09:00-10:30"). The description records that it changed, not its text.
 */
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Actor = "web" | "mac" | "agent" | "google" | "system";

/** Who is writing, from the arguments the mutation received. */
export function actorOf(args: { agent?: unknown; syncTimeZone?: string }): Actor {
  if (args.agent) return "agent";
  if (args.syncTimeZone) return "mac";
  return "web";
}

type View = Record<string, unknown>;

function view(t: Doc<"tasks">): View {
  const start = t.scheduledStartTime || t.dueTime;
  return {
    title: t.title,
    status: t.status,
    outcome: t.outcome,
    priority: t.priority,
    day: t.dueDate || t.scheduledDate,
    time: start ? (t.scheduledEndTime ? `${start}-${t.scheduledEndTime}` : start) : undefined,
    projectId: t.projectId,
    recurrence: t.recurrence,
    parentTaskId: t.parentTaskId,
    columnId: t.columnId,
    description: t.description ? "set" : undefined,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function insert(ctx: MutationCtx, task: Doc<"tasks">, actor: Actor, field: string, from?: unknown, to?: unknown) {
  await ctx.db.insert("taskEvents", {
    taskId: task._id,
    userId: task.userId,
    at: Date.now(),
    actor,
    field,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  });
}

export async function recordCreated(ctx: MutationCtx, id: Id<"tasks">, actor: Actor) {
  const t = await ctx.db.get("tasks", id);
  if (!t) return;
  const v = view(t);
  await insert(ctx, t, actor, "created", undefined, { day: v.day, time: v.time, priority: v.priority, projectId: v.projectId });
}

/** Call after a write with the task as it was before it. */
export async function recordChanges(ctx: MutationCtx, before: Doc<"tasks">, actor: Actor) {
  const after = await ctx.db.get("tasks", before._id);
  if (!after) return;
  const a = view(before), b = view(after);
  for (const field of Object.keys(b)) {
    if (field === "description") {
      if (before.description !== after.description) await insert(ctx, after, actor, "description");
      continue;
    }
    if (!same(a[field], b[field])) await insert(ctx, after, actor, field, a[field], b[field]);
  }
}

/** A repeating task was completed (or missed) for one day and moved to its next. */
export async function recordOccurrence(ctx: MutationCtx, before: Doc<"tasks">, actor: Actor, missed: boolean) {
  const after = await ctx.db.get("tasks", before._id);
  if (!after) return;
  await insert(ctx, after, actor, "occurrence", { day: view(before).day, missed }, view(after).day);
}

export async function clearHistory(ctx: MutationCtx, taskId: Id<"tasks">) {
  const rows = await ctx.db.query("taskEvents").withIndex("by_taskId", (q) => q.eq("taskId", taskId)).collect();
  for (const r of rows) await ctx.db.delete("taskEvents", r._id);
}
