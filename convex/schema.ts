import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("todo"),
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("done")
    ),
    priority: v.union(
      v.literal("p1"),
      v.literal("p2"),
      v.literal("p3"),
      v.literal("p4")
    ),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    scheduledDate: v.optional(v.string()),
    scheduledStartTime: v.optional(v.string()),
    scheduledEndTime: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    sectionId: v.optional(v.id("sections")),
    recurrence: v.optional(v.string()), // "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly" | ""
    labels: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
    sortOrder: v.number(),
    completedAt: v.optional(v.number()),
    userId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId_and_projectId", ["userId", "projectId"])
    .index("by_userId_and_scheduledDate", ["userId", "scheduledDate"])
    .index("by_userId_and_dueDate", ["userId", "dueDate"])
    .index("by_parentTaskId", ["parentTaskId"])
    .index("by_userId_and_sectionId", ["userId", "sectionId"]),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
    icon: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    priority: v.optional(v.union(v.literal("p1"), v.literal("p2"), v.literal("p3"), v.literal("p4"))),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    client: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    sortOrder: v.number(),
    userId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"]),

  sections: defineTable({
    name: v.string(),
    sortOrder: v.number(),
    userId: v.string(),
  }).index("by_userId", ["userId"]),

  favorites: defineTable({
    type: v.union(v.literal("project"), v.literal("label")),
    referenceId: v.string(),
    sortOrder: v.number(),
    userId: v.string(),
  }).index("by_userId", ["userId"]),

  aiSettings: defineTable({
    apiKey: v.string(),
    model: v.optional(v.string()),
    userId: v.string(),
  }).index("by_userId", ["userId"]),
});
