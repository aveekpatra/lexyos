import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import { CODE_TTL_MS, convex, normaliseScope, publicOrigin, randomToken, redirectUriAllowed, resolveClient, secret, sha256 } from "@/lib/oauth/server";

/**
 * Consent decision. The consent page posts here; on approval a single-use
 * code goes back to the client with `state` and `iss` (RFC 9207).
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in required", { status: 401 });
  const form = await req.formData();
  const get = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  const clientId = get("client_id"), redirectUri = get("redirect_uri"), state = get("state");
  const origin = publicOrigin(req);

  const client = await resolveClient(clientId);
  if (!client || !redirectUriAllowed(redirectUri, client.redirectUris, client)) {
    return new Response("Unknown client or redirect URI", { status: 400 });
  }
  const back = new URL(redirectUri);
  if (state) back.searchParams.set("state", state);
  back.searchParams.set("iss", origin);

  if (get("decision") !== "approve") {
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("error_description", "The user declined");
    return Response.redirect(back.toString(), 302);
  }
  const challenge = get("code_challenge");
  if (get("code_challenge_method") !== "S256" || !challenge) {
    back.searchParams.set("error", "invalid_request");
    back.searchParams.set("error_description", "PKCE S256 is required");
    return Response.redirect(back.toString(), 302);
  }
  const code = randomToken("mbcode_");
  await convex().mutation(api.oauth.createCode, {
    secret: secret(), codeHash: sha256(code), clientId, clientName: client.name, userId, redirectUri,
    codeChallenge: challenge, scope: normaliseScope(get("scope")), resource: get("resource") || undefined, expiresAt: Date.now() + CODE_TTL_MS,
  });
  back.searchParams.set("code", code);
  return Response.redirect(back.toString(), 302);
}
