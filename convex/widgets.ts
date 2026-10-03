import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { sha256 } from "./lib/hash";

/*
 * Home-screen widgets fetch data in the background, where no Clerk session is
 * at hand. The phone makes a random token once, signed in, and registers its
 * hash here; the widget then presents the token to the HTTP routes in
 * convex/http.ts, which act as that user. Convex never sees the plain token
 * outside the request that uses it.
 */

/** Signed in: register this device's widget token. Re-registering a device replaces its old token. */
export const register = mutation({
  args: { token: v.string(), device: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (args.token.length < 32) throw new Error("Token too short");
    const userId = identity.subject;
    if (args.device) {
      const rows = await ctx.db.query("widgetTokens").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
      for (const r of rows) if (r.device === args.device) await ctx.db.delete("widgetTokens", r._id);
    }
    await ctx.db.insert("widgetTokens", { hash: await sha256(args.token), userId, device: args.device, createdAt: Date.now() });
  },
});

export const resolve = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("widgetTokens").withIndex("by_hash", (q) => q.eq("hash", args.hash)).first();
    return row ? { id: row._id, userId: row.userId, lastUsedAt: row.lastUsedAt ?? 0 } : null;
  },
});

export const touch = internalMutation({
  args: { id: v.id("widgetTokens") },
  handler: async (ctx, args) => { await ctx.db.patch("widgetTokens", args.id, { lastUsedAt: Date.now() }); },
});

/** Completion times for the heatmap: every done task finished since `since`. */
export const completions = internalQuery({
  args: { userId: v.string(), since: v.number() },
  handler: async (ctx, args) => {
    const done = await ctx.db.query("tasks")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", args.userId).eq("status", "done"))
      .collect();
    return done
      .filter((t) => !t.parentTaskId && t.outcome !== "missed" && t.source !== "google_calendar" && (t.completedAt ?? 0) >= args.since)
      .map((t) => t.completedAt as number);
  },
});

/** Signed out (or a stale device): forget this device's token. */
export const revoke = mutation({
  args: { device: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const rows = await ctx.db.query("widgetTokens").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    for (const r of rows) if (r.device === args.device) await ctx.db.delete("widgetTokens", r._id);
  },
});
