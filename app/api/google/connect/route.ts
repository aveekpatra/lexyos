import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { buildAuthUrl, isGoogleOAuthConfigured, newState } from "@/lib/google-oauth";

const STATE_COOKIE = "unifocus_google_oauth_state";

/** Starts the Google consent flow. Opened as a normal navigation, not fetch. */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.redirect(new URL("/", req.url), 302);
  if (!isGoogleOAuthConfigured()) {
    return Response.json(
      { error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      { status: 500 },
    );
  }
  const origin = new URL(req.url).origin;
  const state = newState();
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  return Response.redirect(buildAuthUrl(origin, state), 302);
}
