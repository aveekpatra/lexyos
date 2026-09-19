import { v } from "convex/values";

/**
 * Who is acting. Normally the signed-in Clerk user. Agents (the MCP server)
 * act on a user's behalf by presenting the shared AGENT_SECRET plus the user
 * id they were authorised for by a personal API key. Functions that accept
 * `agent` list it in their args and call getIdentity instead of ctx.auth.
 */
export const agentValidator = v.optional(v.object({ secret: v.string(), userId: v.string() }));

export type Agent = { secret: string; userId: string } | undefined;

export async function getIdentity(
  ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } },
  agent: Agent,
): Promise<{ subject: string } | null> {
  if (agent) {
    const expected = process.env.AGENT_SECRET;
    if (!expected || agent.secret !== expected) throw new Error("Agent secret rejected");
    return { subject: agent.userId };
  }
  return await ctx.auth.getUserIdentity();
}
