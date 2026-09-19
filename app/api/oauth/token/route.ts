import { api } from "@/convex/_generated/api";
import { convex, issueTokens, json, oauthError, resolveClient, secret, sha256, verifyPkce, CORS } from "@/lib/oauth/server";

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

async function readParams(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)]));
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text).entries());
}

/** RFC 6749 token endpoint: authorization_code with PKCE, and rotating refresh_token. */
export async function POST(req: Request) {
  const p = await readParams(req);
  // Client authentication: Basic header or client_secret_post; public clients send client_id only.
  let clientId = p.client_id ?? "";
  let clientSecret = p.client_secret ?? "";
  const basic = req.headers.get("authorization");
  if (basic?.startsWith("Basic ")) {
    const [id, sec = ""] = Buffer.from(basic.slice(6), "base64").toString("utf8").split(":");
    clientId = decodeURIComponent(id ?? ""); clientSecret = decodeURIComponent(sec);
  }
  if (!clientId) return oauthError("invalid_client", "client_id is required", 401);
  const client = await resolveClient(clientId);
  if (!client) return oauthError("invalid_client", "Unknown client", 401);
  if (client.confidential && (!clientSecret || sha256(clientSecret) !== client.secretHash)) return oauthError("invalid_client", "Bad client secret", 401);

  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier) return oauthError("invalid_request", "code and code_verifier are required");
    const code = await convex().mutation(api.oauth.consumeCode, { secret: secret(), codeHash: sha256(p.code) });
    if (!code) return oauthError("invalid_grant", "Authorization code is invalid, expired, or already used");
    if (code.clientId !== clientId) return oauthError("invalid_grant", "Code was issued to another client");
    if (p.redirect_uri && p.redirect_uri !== code.redirectUri) return oauthError("invalid_grant", "redirect_uri mismatch");
    if (!verifyPkce(p.code_verifier, code.codeChallenge)) return oauthError("invalid_grant", "PKCE verification failed");
    return json(await issueTokens({ userId: code.userId, clientId, clientName: code.clientName, scope: code.scope }));
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token) return oauthError("invalid_request", "refresh_token is required");
    const grant = await convex().mutation(api.oauth.rotateRefresh, { secret: secret(), refreshHash: sha256(p.refresh_token), clientId });
    if (!grant) return oauthError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    return json(await issueTokens(grant));
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}
