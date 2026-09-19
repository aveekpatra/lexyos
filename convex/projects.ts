import { v } from "convex/values";
import { agentValidator, getIdentity } from "./lib/actor";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: { agent: agentValidator,
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return [];
    const userId = identity.subject;

    if (args.status) {
      return await ctx.db
        .query("projects")
        .withIndex("by_userId_and_status", (q) =>
          q.eq("userId", userId).eq("status", args.status!)
        )
        .collect();
    }

    return await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getById = query({
  args: { agent: agentValidator, id: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return null;
    const project = await ctx.db.get("projects", args.id);
    if (!project || project.userId !== identity.subject) return null;
    return project;
  },
});

export const getTaskCounts = query({
  args: { agent: agentValidator, id: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) return null;
    const project = await ctx.db.get("projects", args.id);
    if (!project || project.userId !== identity.subject) return null;

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId_and_projectId", (q) =>
        q.eq("userId", identity.subject).eq("projectId", args.id)
      )
      .collect();

    return {
      total: tasks.length,
      planned: tasks.filter((t) => t.status === "todo" || t.status === "planned").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      review: tasks.filter((t) => t.status === "review").length,
      done: tasks.filter((t) => t.status === "done").length,
    };
  },
});

export const create = mutation({
  args: { agent: agentValidator,
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
    icon: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))
    ),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    client: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const maxOrder = existing.reduce((max, p) => Math.max(max, p.sortOrder), 0);

    return await ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      color: args.color,
      icon: args.icon,
      priority: args.priority,
      startDate: args.startDate,
      dueDate: args.dueDate,
      client: args.client,
      tags: args.tags,
      notes: args.notes,
      status: "active",
      sortOrder: maxOrder + 1,
      userId,
    });
  },
});

export const update = mutation({
  args: { agent: agentValidator,
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    priority: v.optional(
      v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))
    ),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    client: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const project = await ctx.db.get("projects", args.id);
    if (!project || project.userId !== identity.subject) throw new Error("Project not found");

    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch("projects", id, filtered);
  },
});

export const duplicate = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    const project = await ctx.db.get("projects", args.id);
    if (!project || project.userId !== userId) throw new Error("Project not found");

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const maxOrder = existing.reduce((max, p) => Math.max(max, p.sortOrder), 0);

    return await ctx.db.insert("projects", {
      name: `${project.name} (copy)`,
      description: project.description,
      color: project.color,
      icon: project.icon,
      priority: project.priority,
      startDate: project.startDate,
      dueDate: project.dueDate,
      client: project.client,
      tags: project.tags,
      notes: project.notes,
      status: "active",
      sortOrder: maxOrder + 1,
      userId,
    });
  },
});

export const reorder = mutation({
  args: {
    orderedIds: v.array(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    for (let i = 0; i < args.orderedIds.length; i++) {
      const project = await ctx.db.get("projects", args.orderedIds[i]);
      if (project && project.userId === userId) {
        await ctx.db.patch("projects", args.orderedIds[i], { sortOrder: i });
      }
    }
  },
});

export const remove = mutation({
  args: { agent: agentValidator, id: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx, args.agent);
    if (!identity) throw new Error("Not authenticated");
    const project = await ctx.db.get("projects", args.id);
    if (!project || project.userId !== identity.subject) throw new Error("Project not found");

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId_and_projectId", (q) =>
        q.eq("userId", identity.subject).eq("projectId", args.id)
      )
      .collect();
    for (const task of tasks) {
      await ctx.db.patch("tasks", task._id, { projectId: undefined });
    }
    await ctx.db.delete("projects", args.id);
  },
});
