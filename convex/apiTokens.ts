import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * One personal API key per user. The Next server creates it, seals the plain
 * key (so Settings can show it again) and stores its hash (so the MCP server
 * can look it up). Convex never sees the plain key.
 */

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db.query("apiTokens").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    const live = rows.filter((r) => !r.revokedAt).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!live) return null;
    return { id: live._id, keyEnc: live.keyEnc ?? null, prefix: live.prefix, scope: live.scope, createdAt: live.createdAt, lastUsedAt: live.lastUsedAt };
  },
});

/** Replace the user's key: revoke every live one, insert the new one. */
export const replace = mutation({
  args: { prefix: v.string(), hash: v.string(), keyEnc: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const rows = await ctx.db.query("apiTokens").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    for (const r of rows) if (!r.revokedAt) await ctx.db.patch("apiTokens", r._id, { revokedAt: Date.now() });
    return await ctx.db.insert("apiTokens", {
      name: "Personal key", prefix: args.prefix, hash: args.hash, keyEnc: args.keyEnc,
      scope: "readwrite", createdAt: Date.now(), userId: identity.subject,
    });
  },
});

/** MCP server: resolve a bearer token hash to its owner. Gated by the agent secret. */
export const verify = query({
  args: { secret: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.AGENT_SECRET || args.secret !== process.env.AGENT_SECRET) throw new Error("Agent secret rejected");
    const row = await ctx.db.query("apiTokens").withIndex("by_hash", (q) => q.eq("hash", args.hash)).first();
    if (!row || row.revokedAt) return null;
    return { id: row._id, userId: row.userId, scope: row.scope };
  },
});

export const touch = mutation({
  args: { secret: v.string(), id: v.id("apiTokens") },
  handler: async (ctx, args) => {
    if (!process.env.AGENT_SECRET || args.secret !== process.env.AGENT_SECRET) throw new Error("Agent secret rejected");
    await ctx.db.patch("apiTokens", args.id, { lastUsedAt: Date.now() });
  },
});
