/**
 * Google OAuth for the calendar connection. Independent of Clerk: Clerk only
 * identifies the user; Google is connected explicitly from inside the app.
 *
 * Env required:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (Google Cloud OAuth "Web application" client)
 *   Authorised redirect URI on that client:  <origin>/api/google/callback
 *
 * Tokens at rest are AES-GCM encrypted with a key derived from the client
 * secret, so the Convex rows are useless without the server env.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export class GoogleNotConnectedError extends Error {
  code = "google_not_connected" as const;
  constructor(message = "Google Calendar is not connected") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export function isGoogleNotConnected(err: unknown): err is GoogleNotConnectedError {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "google_not_connected";
}

function env(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set. Add it to .env.local (see lib/google-oauth.ts).`);
  return val;
}

export function isGoogleOAuthConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

export function buildAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    // Force the consent screen so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      ...body,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token endpoint ${res.status}: ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string, origin: string) {
  const tok = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(origin),
  });
  if (!tok.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  }
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope ?? GOOGLE_SCOPES,
    email: tok.id_token ? emailFromIdToken(tok.id_token) : undefined,
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const tok = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return { accessToken: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => {});
}

/** Email claim from the id_token; no signature check needed, it came straight from Google over TLS. */
function emailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return (JSON.parse(json) as { email?: string }).email;
  } catch {
    return undefined;
  }
}

// ─── at-rest encryption ───

function key(): Buffer {
  return createHash("sha256").update(`unifocus-google-tokens:${env("GOOGLE_CLIENT_SECRET")}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptToken(blob: string): string {
  const [ver, ivB, tagB, encB] = blob.split(".");
  if (ver !== "v1" || !ivB || !tagB || !encB) throw new Error("Unrecognised token blob");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}
