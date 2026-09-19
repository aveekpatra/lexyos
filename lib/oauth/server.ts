import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * OAuth 2.1 authorization server for MCP clients, per the MCP authorization
 * spec: PKCE S256 only, Dynamic Client Registration (RFC 7591), Client ID
 * Metadata Documents, RFC 8414 discovery, RFC 9207 issuer identification,
 * rotating refresh tokens. Tokens are opaque and stored hashed in Convex.
 */

export const SCOPES = ["tasks:read", "tasks:write"] as const;
export const ALL_SCOPES = [...SCOPES, "offline_access"];
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 5 * 60 * 1000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

export function secret(): string {
  const s = process.env.AGENT_SECRET;
  if (!s) throw new Error("AGENT_SECRET is not set");
  return s;
}
export function convex(): ConvexHttpClient {
  return new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
}

/** Public origin, honouring the proxy headers Vercel sets. */
export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
export const mcpUrl = (origin: string) => `${origin}/api/mcp`;

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Lexyos",
  };
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  "access-control-max-age": "86400",
};
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });
export const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

export type ResolvedClient = { clientId: string; name: string; redirectUris: string[]; confidential: boolean; secretHash: string | null; cimd: boolean };

/**
 * Resolve a client_id: an https URL is a Client ID Metadata Document and is
 * fetched and validated; anything else is a dynamically registered client.
 */
export async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  if (/^https:\/\//.test(clientId)) {
    const res = await fetch(clientId, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res || !res.ok) return null;
    const doc = (await res.json().catch(() => null)) as { client_id?: string; client_name?: string; redirect_uris?: string[] } | null;
    if (!doc || doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
    return { clientId, name: new URL(clientId).host, redirectUris: doc.redirect_uris, confidential: false, secretHash: null, cimd: true };
  }
  const row = await convex().query(api.oauth.getClient, { secret: secret(), clientId });
  if (!row) return null;
  return { clientId, name: row.name, redirectUris: row.redirectUris, confidential: !!row.clientSecretHash, secretHash: row.clientSecretHash, cimd: false };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Exact match, except loopback hosts compare with the port ignored (RFC 8252 7.3). */
export function redirectUriAllowed(requested: string, registered: string[], client: ResolvedClient): boolean {
  let r: URL;
  try { r = new URL(requested); } catch { return false; }
  for (const reg of registered) {
    let g: URL;
    try { g = new URL(reg); } catch { continue; }
    if (LOOPBACK.has(r.hostname) && LOOPBACK.has(g.hostname) && r.protocol === g.protocol && r.pathname === g.pathname) return true;
    if (reg === requested) {
      // Self-asserted CIMD documents may only redirect to their own origin (or loopback).
      if (client.cimd && !LOOPBACK.has(r.hostname) && r.origin !== new URL(client.clientId).origin) return false;
      return true;
    }
  }
  return false;
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export function normaliseScope(requested: string | null | undefined): string {
  const asked = (requested ?? "").split(/[\s+]+/).filter(Boolean);
  const granted = asked.filter((s) => (ALL_SCOPES as string[]).includes(s));
  const withoutOffline = granted.filter((s) => s !== "offline_access");
  return (withoutOffline.length ? granted : [...SCOPES, ...(granted.includes("offline_access") ? ["offline_access"] : [])]).join(" ");
}

/** Mint an access and refresh token pair for a grant. */
export async function issueTokens(grant: { userId: string; clientId: string; clientName: string; scope: string }) {
  const access = randomToken("mba_");
  const refresh = randomToken("mbr_");
  const now = Date.now();
  await convex().mutation(api.oauth.createTokens, {
    secret: secret(), accessHash: sha256(access), refreshHash: sha256(refresh),
    clientId: grant.clientId, clientName: grant.clientName, userId: grant.userId, scope: grant.scope,
    accessExpiresAt: now + ACCESS_TTL_MS, refreshExpiresAt: now + REFRESH_TTL_MS,
  });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh, scope: grant.scope };
}
