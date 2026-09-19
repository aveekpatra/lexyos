import { api } from "@/convex/_generated/api";
import { convexForCurrentUser } from "@/app/actions/google-auth";
import { decryptToken, revokeToken } from "@/lib/google-oauth";

export async function POST() {
  try {
    const convex = await convexForCurrentUser();
    const row = await convex.query(api.googleConnections.getEncrypted, {});
    if (row) {
      // Best effort: revoking the refresh token also invalidates the access token.
      try { await revokeToken(decryptToken(row.refreshTokenEnc)); } catch { /* ignore */ }
    }
    await convex.mutation(api.googleConnections.remove, {});
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
