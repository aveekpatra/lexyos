import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { sha256 } from "@/lib/crypto";

/** Unauthenticated self-check for the MCP server's dependencies. Leaks no secrets. */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  const secret = process.env.AGENT_SECRET;
  const out: Record<string, unknown> = { convexHost: url ? new URL(url).host : null, hasAgentSecret: Boolean(secret) };
  if (url && secret) {
    try {
      const convex = new ConvexHttpClient(url);
      out.verify = await convex.query(api.apiTokens.verify, { secret, hash: sha256("health") });
      out.ok = true;
    } catch (err) {
      out.ok = false;
      out.error = err instanceof Error ? err.message : String(err);
    }
  } else out.ok = false;
  return Response.json(out);
}
