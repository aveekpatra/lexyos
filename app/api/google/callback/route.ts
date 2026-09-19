import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { convexForCurrentUser } from "@/app/actions/google-auth";
import { encryptToken, exchangeCode } from "@/lib/google-oauth";

const STATE_COOKIE = "unifocus_google_oauth_state";

function back(req: Request, result: "connected" | "error", detail?: string) {
  const url = new URL("/timeline", req.url);
  url.searchParams.set("google", result);
  if (detail) url.searchParams.set("reason", detail.slice(0, 200));
  return Response.redirect(url, 302);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (denied) return back(req, "error", denied);
  if (!code || !state || !expected || state !== expected) return back(req, "error", "state_mismatch");

  try {
    const convex = await convexForCurrentUser();
    const tok = await exchangeCode(code, url.origin);
    await convex.mutation(api.googleConnections.upsert, {
      email: tok.email,
      scope: tok.scope,
      accessTokenEnc: encryptToken(tok.accessToken),
      refreshTokenEnc: encryptToken(tok.refreshToken),
      expiresAt: tok.expiresAt,
    });
    return back(req, "connected");
  } catch (err) {
    console.error("[google/callback]", err);
    return back(req, "error", err instanceof Error ? err.message : "unknown");
  }
}
