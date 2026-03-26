import { auth, clerkClient } from "@clerk/nextjs/server";

export async function getGoogleAccessToken(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  let tokens;
  try {
    const client = await clerkClient();
    tokens = await client.users.getUserOauthAccessToken(
      userId,
      "oauth_google"
    );
  } catch (err) {
    console.error("[google-auth] OAuth token fetch failed:", err);
    throw new Error(
      "Google account not connected. Please sign in with Google OAuth."
    );
  }

  const token = tokens.data[0]?.token;
  if (!token)
    throw new Error(
      "No Google OAuth token found. Please reconnect your Google account."
    );
  return token;
}
