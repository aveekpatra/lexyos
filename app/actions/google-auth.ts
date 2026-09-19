/**
 * Google access for the signed-in user, via Clerk. Clerk stores the Google
 * refresh token from sign-in and returns a live access token here.
 */
import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { GOOGLE_CALENDAR_SCOPE, GoogleNotConnectedError } from "@/lib/google-oauth";

export async function convexForCurrentUser(): Promise<ConvexHttpClient> {
  const { userId, getToken } = await auth();
  if (!userId) throw new Error("Not authenticated");
  const token = await getToken({ template: "convex" });
  if (!token) throw new Error("No Convex token");
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  return convex;
}

export type GoogleConnection =
  | { connected: false }
  | { connected: true; email?: string; connectedAt: number; needsReconnect: boolean; lastError?: string };

/** Connection state for the UI: is a Google account linked, and does it carry the calendar scope? */
export async function getGoogleConnection(): Promise<GoogleConnection> {
  const { userId } = await auth();
  if (!userId) return { connected: false };
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const google = user.externalAccounts.find((a) => a.provider === "oauth_google" && a.verification?.status === "verified");
  if (!google) return { connected: false };
  const scopes = (google.approvedScopes ?? "").split(/\s+/);
  const hasCalendar = scopes.includes(GOOGLE_CALENDAR_SCOPE);
  let lastError: string | undefined;
  if (hasCalendar) {
    try {
      const tokens = await client.users.getUserOauthAccessToken(userId, "google");
      if (!tokens.data[0]?.token) lastError = "Google returned no access token";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    connected: true,
    email: google.emailAddress,
    connectedAt: user.createdAt,
    needsReconnect: !hasCalendar || !!lastError,
    lastError: hasCalendar ? lastError : "Calendar access was not granted",
  };
}

/** Clerk refreshes the token itself, so `forceRefresh` is accepted for compatibility only. */
export async function getGoogleAccessToken(_opts: { forceRefresh?: boolean } = {}): Promise<string> {
  void _opts;
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  let token: string | undefined;
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "google");
    token = tokens.data[0]?.token;
  } catch (err) {
    throw new GoogleNotConnectedError(`Google token unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!token) throw new GoogleNotConnectedError();
  return token;
}
