import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Storage for the OAuth 2.1 authorization server in app/api/oauth. Every
 * server-side function takes the shared AGENT_SECRET; only the two
 * user-facing ones (grants, revoke) use the signed-in identity.
 */
function gate(secret: string) {
  if (!process.env.AGENT_SECRET || secret !== process.env.AGENT_SECRET) throw new Error("Agent secret rejected");
}

export const registerClient = mutation({
  args: { secret: v.string(), clientId: v.string(), clientSecretHash: v.optional(v.string()), name: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, a) => {
    gate(a.secret);
    await ctx.db.insert("oauthClients", { clientId: a.clientId, clientSecretHash: a.clientSecretHash, name: a.name, redirectUris: a.redirectUris, createdAt: Date.now() });
  },
});

export const getClient = query({
  args: { secret: v.string(), clientId: v.string() },
  handler: async (ctx, a) => {
    gate(a.secret);
    const c = await ctx.db.query("oauthClients").withIndex("by_clientId", (q) => q.eq("clientId", a.clientId)).first();
    return c ? { clientId: c.clientId, name: c.name, redirectUris: c.redirectUris, clientSecretHash: c.clientSecretHash ?? null } : null;
  },
});

export const createCode = mutation({
  args: {
    secret: v.string(), codeHash: v.string(), clientId: v.string(), clientName: v.string(), userId: v.string(),
    redirectUri: v.string(), codeChallenge: v.string(), scope: v.string(), resource: v.optional(v.string()), expiresAt: v.number(),
  },
  handler: async (ctx, a) => {
    gate(a.secret);
    const { secret: _s, ...row } = a;
    void _s;
    await ctx.db.insert("oauthCodes", row);
  },
});

/** Single use: returns the code row and marks it consumed atomically. */
export const consumeCode = mutation({
  args: { secret: v.string(), codeHash: v.string() },
  handler: async (ctx, a) => {
    gate(a.secret);
    const row = await ctx.db.query("oauthCodes").withIndex("by_codeHash", (q) => q.eq("codeHash", a.codeHash)).first();
    if (!row || row.usedAt || row.expiresAt < Date.now()) return null;
    await ctx.db.patch("oauthCodes", row._id, { usedAt: Date.now() });
    return { clientId: row.clientId, clientName: row.clientName, userId: row.userId, redirectUri: row.redirectUri, codeChallenge: row.codeChallenge, scope: row.scope, resource: row.resource ?? null };
  },
});

export const createTokens = mutation({
  args: {
    secret: v.string(), accessHash: v.string(), refreshHash: v.string(), clientId: v.string(), clientName: v.string(),
    userId: v.string(), scope: v.string(), accessExpiresAt: v.number(), refreshExpiresAt: v.number(),
  },
  handler: async (ctx, a) => {
    gate(a.secret);
    const { secret: _s, ...row } = a;
    void _s;
    await ctx.db.insert("oauthTokens", { ...row, createdAt: Date.now() });
  },
});

/** Access token lookup for the MCP server. */
export const verifyAccess = query({
  args: { secret: v.string(), accessHash: v.string() },
  handler: async (ctx, a) => {
    gate(a.secret);
    const row = await ctx.db.query("oauthTokens").withIndex("by_accessHash", (q) => q.eq("accessHash", a.accessHash)).first();
    if (!row || row.revokedAt || row.accessExpiresAt < Date.now()) return null;
    return { id: row._id, userId: row.userId, scope: row.scope, clientId: row.clientId };
  },
});

export const touch = mutation({
  args: { secret: v.string(), id: v.id("oauthTokens") },
  handler: async (ctx, a) => { gate(a.secret); await ctx.db.patch("oauthTokens", a.id, { lastUsedAt: Date.now() }); },
});

/** Refresh rotation: invalidates the presented refresh token and returns its grant for reissue. */
export const rotateRefresh = mutation({
  args: { secret: v.string(), refreshHash: v.string(), clientId: v.string() },
  handler: async (ctx, a) => {
    gate(a.secret);
    const row = await ctx.db.query("oauthTokens").withIndex("by_refreshHash", (q) => q.eq("refreshHash", a.refreshHash)).first();
    if (!row || row.revokedAt || row.refreshExpiresAt < Date.now() || row.clientId !== a.clientId) return null;
    await ctx.db.patch("oauthTokens", row._id, { revokedAt: Date.now() });
    return { userId: row.userId, scope: row.scope, clientId: row.clientId, clientName: row.clientName };
  },
});

/** Settings UI: apps connected to the signed-in account. */
export const grants = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db.query("oauthTokens").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    const live = rows.filter((r) => !r.revokedAt && r.refreshExpiresAt > Date.now());
    // One entry per client, newest first.
    const byClient = new Map<string, typeof live[number]>();
    for (const r of live.sort((x, y) => y.createdAt - x.createdAt)) if (!byClient.has(r.clientId)) byClient.set(r.clientId, r);
    return [...byClient.values()].map((r) => ({ clientId: r.clientId, clientName: r.clientName, scope: r.scope, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt ?? null }));
  },
});

export const revoke = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, a) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const rows = await ctx.db.query("oauthTokens").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).collect();
    for (const r of rows) if (r.clientId === a.clientId && !r.revokedAt) await ctx.db.patch("oauthTokens", r._id, { revokedAt: Date.now() });
  },
});
