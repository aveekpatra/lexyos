/**
 * Google Calendar access rides on the Clerk Google sign-in. Clerk holds the
 * refresh token and hands us a fresh access token on demand, so the app needs
 * no Google client credentials of its own. The one requirement is that the
 * Clerk Google connection requests the calendar scope below.
 */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

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
