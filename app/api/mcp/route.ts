import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { createTools } from "@/lib/ai/tools";
import { sha256 } from "@/lib/crypto";

/**
 * The MCP server. Any client (Claude, ChatGPT, a script) authenticates with
 * a personal API key as a bearer token and gets the same tools the in-app
 * agent has, acting as the key's owner.
 */

export const maxDuration = 60;

const READ_TOOLS = new Set(["list_tasks", "get_task", "search_tasks", "list_projects", "get_today_summary", "find_free_time"]);

function agentSecret() {
  const s = process.env.AGENT_SECRET;
  if (!s) throw new Error("AGENT_SECRET is not set");
  return s;
}

const handler = createMcpHandler(
  (server) => {
    // Register with placeholder auth; the real owner is read from ctx.authInfo per call.
    const shapes = createTools({ agentFor: "" });
    for (const [name, def] of Object.entries(shapes)) {
      server.registerTool(
        name,
        { description: def.description as string, inputSchema: def.inputSchema },
        async (args, ctx) => {
          const auth = ctx.http?.authInfo;
          const userId = auth?.extra?.userId as string | undefined;
          if (!userId) return { isError: true, content: [{ type: "text" as const, text: "Unauthorised" }] };
          const scopes = auth?.scopes ?? [];
          const needs = READ_TOOLS.has(name) ? "read" : "write";
          if (!scopes.includes(needs)) return { isError: true, content: [{ type: "text" as const, text: `Key lacks ${needs} scope` }] };
          const tools = createTools({ agentFor: userId });
          const result = await tools[name].execute(args);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: typeof result === "object" && result !== null && !Array.isArray(result) ? result : { result } };
        },
      );
    }
  },
  {
    serverInfo: { name: "mindbook", version: "1.0.0" },
    instructions: "Mindbook is the user's task and time manager. Dates are YYYY-MM-DD, times HH:MM 24h. Ask before delete_task; everything else may be done directly.",
  },
);

const authed = withMcpAuth(
  handler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const secret = agentSecret();
    // OAuth access token (Claude, ChatGPT, Cursor... after consent).
    if (bearer.startsWith("mba_")) {
      const row = await convex.query(api.oauth.verifyAccess, { secret, accessHash: sha256(bearer) });
      if (!row) return undefined;
      void convex.mutation(api.oauth.touch, { secret, id: row.id }).catch(() => {});
      const scopes: string[] = [];
      if (row.scope.includes("tasks:read")) scopes.push("read");
      if (row.scope.includes("tasks:write")) scopes.push("write");
      return { token: bearer, clientId: row.clientId, scopes, extra: { userId: row.userId } };
    }
    // Personal API key (fallback for clients without OAuth).
    if (!bearer.startsWith("mb_")) return undefined;
    const row = await convex.query(api.apiTokens.verify, { secret, hash: sha256(bearer) });
    if (!row) return undefined;
    void convex.mutation(api.apiTokens.touch, { secret, id: row.id }).catch(() => {});
    const scopes = row.scope === "readwrite" ? ["read", "write"] : [row.scope];
    return { token: bearer, clientId: row.userId, scopes, extra: { userId: row.userId } };
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
