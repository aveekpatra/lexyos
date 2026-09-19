import { api } from "@/convex/_generated/api";
import { convex, json, oauthError, randomToken, secret, sha256, CORS } from "@/lib/oauth/server";

/** RFC 7591 Dynamic Client Registration. Open registration; clients are public unless they ask otherwise. */
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return oauthError("invalid_client_metadata", "Body must be JSON");
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (redirectUris.length === 0) return oauthError("invalid_redirect_uri", "redirect_uris is required");
  for (const u of redirectUris) {
    let url: URL;
    try { url = new URL(u); } catch { return oauthError("invalid_redirect_uri", `Not a URL: ${u}`); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return oauthError("invalid_redirect_uri", `Must be https or loopback: ${u}`);
  }
  const wantsSecret = body.token_endpoint_auth_method === "client_secret_post" || body.token_endpoint_auth_method === "client_secret_basic";
  const clientId = randomToken("mbc_");
  const clientSecret = wantsSecret ? randomToken("mbs_") : undefined;
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "MCP client";
  await convex().mutation(api.oauth.registerClient, { secret: secret(), clientId, clientSecretHash: clientSecret ? sha256(clientSecret) : undefined, name, redirectUris });
  return json({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: clientSecret ? body.token_endpoint_auth_method : "none",
  }, 201);
}
