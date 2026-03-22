import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    projectId: v.optional(v.id("projects")),
    scheduledDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    if (args.projectId) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_projectId", (q) =>
          q.eq("userId", userId).eq("projectId", args.projectId)
        )
        .collect();
      if (args.status) {
        return tasks
          .filter((t) => t.status === args.status)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      }
      return tasks.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    if (args.scheduledDate) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_scheduledDate", (q) =>
          q.eq("userId", userId).eq("scheduledDate", args.scheduledDate)
        )
        .collect();
      if (args.status) {
        return tasks
          .filter((t) => t.status === args.status)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      }
      return tasks.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    if (args.status) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_userId_and_status", (q) =>
          q.eq("userId", userId).eq("status", args.status!)
        )
        .collect();
    }

    return await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) return null;
    return task;
  },
});

export const getSubtasks = query({
  args: { parentTaskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) =>
        q.eq("parentTaskId", args.parentTaskId)
      )
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    priority: v.optional(
      v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))
    ),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    scheduledDate: v.optional(v.string()),
    scheduledStartTime: v.optional(v.string()),
    scheduledEndTime: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    sectionId: v.optional(v.id("sections")),
    recurrence: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const maxOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), 0);

    return await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: args.status ?? "todo",
      priority: args.priority ?? "p3",
      dueDate: args.dueDate,
      dueTime: args.dueTime,
      scheduledDate: args.scheduledDate,
      scheduledStartTime: args.scheduledStartTime,
      scheduledEndTime: args.scheduledEndTime,
      projectId: args.projectId,
      sectionId: args.sectionId,
      recurrence: args.recurrence,
      labels: args.labels,
      parentTaskId: args.parentTaskId,
      sortOrder: maxOrder + 1,
      userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))
    ),
    priority: v.optional(
      v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))
    ),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    scheduledDate: v.optional(v.string()),
    scheduledStartTime: v.optional(v.string()),
    scheduledEndTime: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    sectionId: v.optional(v.id("sections")),
    recurrence: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    sortOrder: v.optional(v.number()),
    // Explicit clear flags — when true, clear the corresponding field
    clearDueDate: v.optional(v.boolean()),
    clearDueTime: v.optional(v.boolean()),
    clearScheduledDate: v.optional(v.boolean()),
    clearScheduledStartTime: v.optional(v.boolean()),
    clearScheduledEndTime: v.optional(v.boolean()),
    clearProjectId: v.optional(v.boolean()),
    clearSectionId: v.optional(v.boolean()),
    clearRecurrence: v.optional(v.boolean()),
    clearDescription: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    const { id, clearDueDate, clearDueTime, clearScheduledDate, clearScheduledStartTime,
      clearScheduledEndTime, clearProjectId, clearSectionId, clearRecurrence, clearDescription,
      ...updates } = args;

    // Build patch: include set values, apply clears
    const patch: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) patch[key] = val;
    }
    if (clearDueDate) patch.dueDate = undefined;
    if (clearDueTime) patch.dueTime = undefined;
    if (clearScheduledDate) patch.scheduledDate = undefined;
    if (clearScheduledStartTime) patch.scheduledStartTime = undefined;
    if (clearScheduledEndTime) patch.scheduledEndTime = undefined;
    if (clearProjectId) patch.projectId = undefined;
    if (clearSectionId) patch.sectionId = undefined;
    if (clearRecurrence) patch.recurrence = undefined;
    if (clearDescription) patch.description = undefined;

    await ctx.db.patch(id, patch);
  },
});

export const toggleComplete = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    if (task.status === "done") {
      await ctx.db.patch(args.id, {
        status: "todo",
        completedAt: undefined,
      });
    } else {
      await ctx.db.patch(args.id, {
        status: "done",
        completedAt: Date.now(),
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== identity.subject) {
      throw new Error("Task not found");
    }

    // Also remove subtasks
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const subtask of subtasks) {
      await ctx.db.delete(subtask._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const bulkUpdateStatus = mutation({
  args: {
    ids: v.array(v.id("tasks")),
    status: v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (task && task.userId === identity.subject) {
        await ctx.db.patch(id, {
          status: args.status,
          completedAt: args.status === "done" ? Date.now() : undefined,
        });
      }
    }
  },
});
