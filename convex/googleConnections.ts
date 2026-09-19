/**
 * Google account connection per user. Token material is stored encrypted;
 * only the Next server (which holds GOOGLE_CLIENT_SECRET) can read it.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

async function requireUser(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

/** Safe for the client: no token material. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { connected: false as const };
    const row = await ctx.db
      .query("googleConnections")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (!row) return { connected: false as const };
    return {
      connected: true as const,
      email: row.email,
      connectedAt: row.connectedAt,
      needsReconnect: !!row.lastError,
      lastError: row.lastError,
    };
  },
});

/** Server-only in practice: returns ciphertext the Next server decrypts. */
export const getEncrypted = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("googleConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const upsert = mutation({
  args: {
    email: v.optional(v.string()),
    scope: v.string(),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("googleConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch("googleConnections", existing._id, { ...args, lastError: undefined, connectedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("googleConnections", { ...args, userId, connectedAt: Date.now() });
  },
});

export const setAccessToken = mutation({
  args: { accessTokenEnc: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("googleConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!existing) throw new Error("Google account not connected");
    await ctx.db.patch("googleConnections", existing._id, { ...args, lastError: undefined });
  },
});

export const setError = mutation({
  args: { message: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("googleConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) await ctx.db.patch("googleConnections", existing._id, { lastError: args.message });
  },
});

export const remove = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("googleConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) await ctx.db.delete("googleConnections", existing._id);
    // Sync cursors belong to the old account; drop them so a new account starts clean.
    const states = await ctx.db
      .query("calendarSyncState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of states) await ctx.db.delete("calendarSyncState", s._id);
  },
});
