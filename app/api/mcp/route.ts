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

const READ_TOOLS = new Set(["list_tasks", "get_task", "search_tasks", "list_projects", "get_project", "get_today_summary", "find_free_time"]);

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
    serverInfo: { name: "lexyos", version: "1.0.0" },
    instructions: [
      "Lexyos is the user's personal task, project, and time manager. Dates are YYYY-MM-DD, times HH:MM 24h.",
      "Where context lives: a PROJECT carries long-horizon context (its Context document, columns, and every task with subtasks); a TASK carries its own context in its description and subtasks; the INBOX is everything without a project.",
      "Working method: (1) before creating anything, search_tasks (scoped with projectId when the work belongs to a project) so you update or reuse instead of duplicating; (2) for anything inside a project, call get_project once and plan from it, do not page through list_tasks; (3) for quick inbox items, search_tasks or list_tasks is enough; (4) after a write, read it back with get_task or get_project and report what you read.",
      "Projects: create_project accepts description, context (markdown), and custom columns; set_project_columns renames, reorders, adds or removes columns. Tasks: create_task and update_task accept every property, including columnId, parentTaskId (subtasks), labels, schedule and recurrence.",
      "Ask before delete_task. Everything else may be done directly.",
    ].join(" "),
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
