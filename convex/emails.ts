import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// --- Queries ---

export const list = query({
  args: {
    labelFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    const emails = await ctx.db
      .query("emails")
      .withIndex("by_userId_and_date", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    if (!args.labelFilter) return emails;

    // Filter by label
    return emails.filter((e) => e.labelIds.includes(args.labelFilter!));
  },
});

export const getByThreadId = query({
  args: { gmailThreadId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("emails")
      .withIndex("by_userId_and_threadId", (q) =>
        q.eq("userId", identity.subject).eq("gmailThreadId", args.gmailThreadId)
      )
      .collect();
  },
});

export const unreadCount = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;

    const unread = await ctx.db
      .query("emails")
      .withIndex("by_userId_and_unread", (q) =>
        q.eq("userId", identity.subject).eq("isUnread", true)
      )
      .collect();

    // Only count inbox unread
    return unread.filter((e) => e.labelIds.includes("INBOX")).length;
  },
});

export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const q = args.query.toLowerCase();
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_userId_and_date", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();

    return emails.filter(
      (e) =>
        e.subject.toLowerCase().includes(q) ||
        e.snippet.toLowerCase().includes(q) ||
        e.fromName.toLowerCase().includes(q) ||
        e.fromEmail.toLowerCase().includes(q)
    );
  },
});

// --- Mutations ---

export const bulkUpsert = mutation({
  args: {
    messages: v.array(
      v.object({
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
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    let inserted = 0;
    let updated = 0;

    for (const msg of args.messages) {
      const existing = await ctx.db
        .query("emails")
        .withIndex("by_userId_and_messageId", (q) =>
          q.eq("userId", userId).eq("gmailMessageId", msg.gmailMessageId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          labelIds: msg.labelIds,
          snippet: msg.snippet,
          subject: msg.subject,
          fromName: msg.fromName,
          fromEmail: msg.fromEmail,
          toSummary: msg.toSummary,
          date: msg.date,
          hasAttachments: msg.hasAttachments,
          isUnread: msg.isUnread,
          isStarred: msg.isStarred,
          historyId: msg.historyId,
        });
        updated++;
      } else {
        await ctx.db.insert("emails", { ...msg, userId });
        inserted++;
      }
    }

    return { inserted, updated };
  },
});

export const bulkUpdateLabels = mutation({
  args: {
    updates: v.array(
      v.object({
        gmailMessageId: v.string(),
        labelIds: v.array(v.string()),
        isUnread: v.boolean(),
        isStarred: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    for (const update of args.updates) {
      const existing = await ctx.db
        .query("emails")
        .withIndex("by_userId_and_messageId", (q) =>
          q.eq("userId", userId).eq("gmailMessageId", update.gmailMessageId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          labelIds: update.labelIds,
          isUnread: update.isUnread,
          isStarred: update.isStarred,
        });
      }
    }
  },
});

export const bulkDelete = mutation({
  args: { gmailMessageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    for (const msgId of args.gmailMessageIds) {
      const existing = await ctx.db
        .query("emails")
        .withIndex("by_userId_and_messageId", (q) =>
          q.eq("userId", userId).eq("gmailMessageId", msgId)
        )
        .first();

      if (existing) {
        await ctx.db.delete(existing._id);
      }
    }
  },
});

export const updateLabels = mutation({
  args: {
    gmailMessageId: v.string(),
    addLabelIds: v.optional(v.array(v.string())),
    removeLabelIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("emails")
      .withIndex("by_userId_and_messageId", (q) =>
        q.eq("userId", userId).eq("gmailMessageId", args.gmailMessageId)
      )
      .first();

    if (!existing) return;

    let labelIds = [...existing.labelIds];
    if (args.removeLabelIds) {
      labelIds = labelIds.filter((l) => !args.removeLabelIds!.includes(l));
    }
    if (args.addLabelIds) {
      for (const l of args.addLabelIds) {
        if (!labelIds.includes(l)) labelIds.push(l);
      }
    }

    await ctx.db.patch(existing._id, {
      labelIds,
      isUnread: labelIds.includes("UNREAD"),
      isStarred: labelIds.includes("STARRED"),
    });
  },
});
