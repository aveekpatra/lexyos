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
    /** Project board column. Falls back to the column matching `status`. */
    columnId: v.optional(v.string()),
    /**
     * On a done snapshot of a repeating task, the live row it was cut from.
     * Without it the history of a habit is a title-match guess, so adherence
     * cannot be computed and an un-complete cannot find its series.
     */
    seriesId: v.optional(v.id("tasks")),
    googleEventId: v.optional(v.string()),       // linked Google Calendar event ID
    /** Set when googleEventId is a series master: Google owns the rule, we only roll locally. */
    googleRecurringEventId: v.optional(v.string()),
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
    /**
     * How a closed task ended. Absent means done; "missed" means it was closed
     * without happening (status is still "done", so everything that hides or
     * skips finished work treats it the same). The reason is optional context
     * for the user and the agent.
     */
    outcome: v.optional(v.literal("missed")),
    missedReason: v.optional(v.string()),
    /** Stable per-account number, shown as #142. See convex/lib/taskNumbers.ts. */
    number: v.optional(v.number()),
    userId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_number", ["userId", "number"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId_and_projectId", ["userId", "projectId"])
    .index("by_userId_and_scheduledDate", ["userId", "scheduledDate"])
    .index("by_userId_and_dueDate", ["userId", "dueDate"])
    .index("by_parentTaskId", ["parentTaskId"])
    .index("by_userId_and_googleEventId", ["userId", "googleEventId"])
    .index("by_seriesId", ["seriesId"]),

  // A task's story: one row per change (convex/lib/taskHistory.ts).
  taskEvents: defineTable({
    taskId: v.id("tasks"),
    userId: v.string(),
    at: v.number(),
    /** "web" | "mac" | "agent" | "google" | "system" */
    actor: v.string(),
    /** "created", "occurrence", or a field: day, time, priority, status, outcome, title, projectId, recurrence, parentTaskId, columnId, description */
    field: v.string(),
    from: v.optional(v.any()),
    to: v.optional(v.any()),
  }).index("by_taskId", ["taskId", "at"]),

  // Task to task links, by relation "related" (both directions read alike).
  taskLinks: defineTable({
    userId: v.string(),
    fromId: v.id("tasks"),
    toId: v.id("tasks"),
    createdAt: v.number(),
  })
    .index("by_fromId", ["fromId"])
    .index("by_toId", ["toId"]),

  // Notebooks hold notes (Markdown pages), like Notion's top-level pages.
  notebooks: defineTable({
    userId: v.string(),
    name: v.string(),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    sortOrder: v.number(),
  }).index("by_userId", ["userId"]),

  notes: defineTable({
    userId: v.string(),
    notebookId: v.id("notebooks"),
    title: v.string(),
    body: v.string(),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notebookId", ["notebookId", "updatedAt"])
    .index("by_userId", ["userId"]),

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
    /** Board columns. Absent means the default template (todo, planned, in progress, review, done). */
    columns: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      /** Status a task takes when moved here. Custom columns leave it unset. */
      status: v.optional(v.union(v.literal("todo"), v.literal("planned"), v.literal("in_progress"), v.literal("review"), v.literal("done"))),
    }))),
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

  // Next free task number per user (convex/lib/taskNumbers.ts).
  taskCounters: defineTable({
    userId: v.string(),
    next: v.number(),
  }).index("by_userId", ["userId"]),

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

  /** OAuth 2.1 authorization server for MCP clients (Claude, ChatGPT, Cursor...). */
  oauthClients: defineTable({
    clientId: v.string(),
    clientSecretHash: v.optional(v.string()),
    name: v.string(),
    redirectUris: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_clientId", ["clientId"]),

  oauthCodes: defineTable({
    codeHash: v.string(),
    clientId: v.string(),
    clientName: v.string(),
    userId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    scope: v.string(),
    resource: v.optional(v.string()),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_codeHash", ["codeHash"]),

  oauthTokens: defineTable({
    accessHash: v.string(),
    refreshHash: v.string(),
    clientId: v.string(),
    clientName: v.string(),
    userId: v.string(),
    scope: v.string(),
    accessExpiresAt: v.number(),
    refreshExpiresAt: v.number(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_accessHash", ["accessHash"])
    .index("by_refreshHash", ["refreshHash"])
    .index("by_userId", ["userId"]),
});
