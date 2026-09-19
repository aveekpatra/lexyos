import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { recurrenceValidator } from "./lib/recurrence";

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    /** Legacy: sections were removed; older documents may still carry this. */
    sectionId: v.optional(v.string()),
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
    // Structured rule (see convex/lib/recurrence.ts). Plain strings are legacy
    // rows ("daily", "weekdays", ...) and are normalised on read.
    recurrence: v.optional(v.union(v.string(), recurrenceValidator)),
    labels: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
    googleEventId: v.optional(v.string()),       // linked Google Calendar event ID
    googleCalendarId: v.optional(v.string()),     // which calendar it's on (default "primary")
    // Calendar-sourced task fields
    source: v.optional(v.union(v.literal("local"), v.literal("google_calendar"))),
    location: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    calendarColor: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    googleUpdatedAt: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
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
    .index("by_userId_and_googleEventId", ["userId", "googleEventId"]),

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

  calendarEvents: defineTable({
    // Google Calendar event ID + calendar ID (together form the unique key)
    googleEventId: v.string(),
    googleCalendarId: v.string(),
    // Core fields
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    // Time (either dateTime for timed events or date for all-day)
    startDateTime: v.optional(v.string()), // ISO 8601
    startDate: v.optional(v.string()),     // YYYY-MM-DD (all-day)
    endDateTime: v.optional(v.string()),
    endDate: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    // Metadata
    status: v.optional(v.string()),        // "confirmed" | "tentative" | "cancelled"
    htmlLink: v.optional(v.string()),
    colorId: v.optional(v.string()),
    calendarColor: v.optional(v.string()), // inherited from the calendar
    isAllDay: v.boolean(),
    // If this event was created from a task, link it
    linkedTaskId: v.optional(v.id("tasks")),
    // Sync metadata
    googleUpdatedAt: v.optional(v.string()), // Google's "updated" field
    lastSyncedAt: v.number(),               // when we last synced this event
    userId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_googleEventId", ["userId", "googleEventId"])
    .index("by_userId_and_linkedTaskId", ["userId", "linkedTaskId"])
    .index("by_userId_and_startDateTime", ["userId", "startDateTime"]),

  calendarSyncState: defineTable({
    googleCalendarId: v.string(),
    calendarName: v.optional(v.string()),
    calendarColor: v.optional(v.string()),
    lastSyncedAt: v.number(),
    syncToken: v.optional(v.string()), // Google's incremental sync token
    userId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_calendarId", ["userId", "googleCalendarId"]),

  pendingSyncQueue: defineTable({
    userId: v.string(),
    taskId: v.id("tasks"),
    action: v.union(v.literal("push"), v.literal("update"), v.literal("delete")),
    payload: v.optional(v.any()),
    retryCount: v.number(),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("failed")),
    createdAt: v.string(),
    lastAttemptAt: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_taskId", ["taskId"]),

  // One Google account per user. Tokens are encrypted by the Next server
  // before they get here (see lib/google-oauth.ts); Convex only stores ciphertext.
  userPreferences: defineTable({
    theme: v.optional(v.string()),
    projectSort: v.optional(v.string()),
    /** Free-form settings blob, merged shallowly by userPreferences.update. Shape: lib/settings.ts */
    prefs: v.optional(v.any()),
    userId: v.string(),
  }).index("by_userId", ["userId"]),

  // Personal API tokens for MCP and integrations. Only a hash is stored.
  apiTokens: defineTable({
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
    /** The plain key, sealed by the Next server so Settings can show it again. */
    keyEnc: v.optional(v.string()),
    scope: v.union(v.literal("read"), v.literal("write"), v.literal("readwrite")),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    userId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_hash", ["hash"]),

  aiChats: defineTable({
    messages: v.array(v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
      toolCalls: v.optional(v.array(v.object({
        toolName: v.string(),
        input: v.any(),
        output: v.any(),
        error: v.optional(v.boolean()),
      }))),
    })),
    userId: v.string(),
  }).index("by_userId", ["userId"]),
});
