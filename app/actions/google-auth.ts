/**
 * Access token for Google Calendar calls, from OUR OAuth connection (not Clerk).
 * Loads the encrypted row from Convex, refreshes when close to expiry, and
 * throws GoogleNotConnectedError when the user has not connected an account.
 */
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  GoogleNotConnectedError,
  decryptToken,
  encryptToken,
  refreshAccessToken,
} from "@/lib/google-oauth";

/** Refresh this long before the recorded expiry to absorb clock skew and slow requests. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export async function convexForCurrentUser(): Promise<ConvexHttpClient> {
  const { userId, getToken } = await auth();
  if (!userId) throw new Error("Not authenticated");
  const token = await getToken({ template: "convex" });
  if (!token) throw new Error("No Convex token");
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  return convex;
}

export async function getGoogleAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
  const convex = await convexForCurrentUser();
  const row = await convex.query(api.googleConnections.getEncrypted, {});
  if (!row) throw new GoogleNotConnectedError();

  const fresh = row.expiresAt - Date.now() > REFRESH_MARGIN_MS;
  if (fresh && !opts.forceRefresh) return decryptToken(row.accessTokenEnc);

  try {
    const next = await refreshAccessToken(decryptToken(row.refreshTokenEnc));
    await convex.mutation(api.googleConnections.setAccessToken, {
      accessTokenEnc: encryptToken(next.accessToken),
      expiresAt: next.expiresAt,
    });
    return next.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // invalid_grant means the refresh token was revoked or expired: needs a reconnect.
    await convex.mutation(api.googleConnections.setError, { message }).catch(() => {});
    throw new GoogleNotConnectedError(`Google connection needs to be renewed: ${message}`);
  }
}
