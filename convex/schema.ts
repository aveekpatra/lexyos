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
    // Gmail linking fields
    gmailMessageId: v.optional(v.string()),
    gmailThreadId: v.optional(v.string()),
    gmailSubject: v.optional(v.string()),
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
    .index("by_userId_and_sectionId", ["userId", "sectionId"])
    .index("by_userId_and_googleEventId", ["userId", "googleEventId"])
    .index("by_userId_and_gmailThreadId", ["userId", "gmailThreadId"]),

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

  emails: defineTable({
    gmailMessageId: v.string(),
    gmailThreadId: v.string(),
    labelIds: v.array(v.string()),
    snippet: v.string(),
    subject: v.string(),
    fromName: v.string(),
    fromEmail: v.string(),
    toSummary: v.string(),
    date: v.number(),
    hasAttachments: v.boolean(),
    isUnread: v.boolean(),
    isStarred: v.boolean(),
    historyId: v.string(),
    userId: v.string(),
  })
    .index("by_userId_and_date", ["userId", "date"])
    .index("by_userId_and_threadId", ["userId", "gmailThreadId"])
    .index("by_userId_and_messageId", ["userId", "gmailMessageId"])
    .index("by_userId_and_unread", ["userId", "isUnread"]),

  emailSyncState: defineTable({
    lastHistoryId: v.string(),
    lastSyncedAt: v.number(),
    userId: v.string(),
  }).index("by_userId", ["userId"]),

  aiSettings: defineTable({
    apiKey: v.string(),
    model: v.optional(v.string()),
    userId: v.string(),
  }).index("by_userId", ["userId"]),
});
