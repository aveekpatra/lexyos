"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

async function getGoogleAccessToken(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  let tokens;
  try {
    const client = await clerkClient();
    tokens = await client.users.getUserOauthAccessToken(
      userId,
      "oauth_google"
    );
  } catch {
    throw new Error("Google account not connected. Please sign in with Google OAuth.");
  }

  const token = tokens.data[0]?.token;
  if (!token) throw new Error("No Google OAuth token found. Please reconnect your Google account.");
  return token;
}

async function googleFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API error (${res.status}): ${text}`);
  }
  return res;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  backgroundColor: string;
  foregroundColor: string;
  primary?: boolean;
  selected?: boolean;
}

export interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  colorId?: string;
  status?: string;
  htmlLink?: string;
  calendarId?: string;
  calendarColor?: string;
  updated?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export async function getCalendarList(): Promise<GoogleCalendar[]> {
  const res = await googleFetch("/users/me/calendarList");
  const data = await res.json();
  return data.items ?? [];
}

/**
 * Fetch the Google Calendar color palette.
 * Returns a map of colorId → hex color for both events and calendars.
 * The API returns { event: { "1": { background, foreground }, ... }, calendar: { ... } }
 */
let cachedEventColors: Record<string, string> | null = null;

async function getEventColorMap(): Promise<Record<string, string>> {
  if (cachedEventColors) return cachedEventColors;
  try {
    const res = await googleFetch("/colors");
    const data = await res.json();
    const map: Record<string, string> = {};
    if (data.event) {
      for (const [id, val] of Object.entries(data.event)) {
        map[id] = (val as { background: string }).background;
      }
    }
    cachedEventColors = map;
    return map;
  } catch {
    return {};
  }
}

export async function getCalendarEvents(
  timeMin: string,
  timeMax: string
): Promise<GoogleEvent[]> {
  // Fetch calendars and event color palette in parallel
  const [calendars, eventColorMap] = await Promise.all([
    getCalendarList(),
    getEventColorMap(),
  ]);
  const selectedCalendars = calendars.filter(
    (c) => c.selected !== false
  );

  const allEvents: GoogleEvent[] = [];

  await Promise.all(
    selectedCalendars.map(async (calendar) => {
      try {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
        });
        const res = await googleFetch(
          `/calendars/${encodeURIComponent(calendar.id)}/events?${params}`
        );
        const data = await res.json();
        const events = (data.items ?? []).map((event: GoogleEvent) => ({
          ...event,
          calendarId: calendar.id,
          // Event-level color overrides calendar color
          calendarColor: event.colorId
            ? (eventColorMap[event.colorId] || calendar.backgroundColor)
            : calendar.backgroundColor,
        }));
        allEvents.push(...events);
      } catch {
        // Skip calendars that fail (e.g., permissions)
      }
    })
  );

  return allEvents.sort((a, b) => {
    const aTime = a.start.dateTime || a.start.date || "";
    const bTime = b.start.dateTime || b.start.date || "";
    return aTime.localeCompare(bTime);
  });
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; timeZone?: string; date?: string };
  end: { dateTime?: string; timeZone?: string; date?: string };
  calendarId?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export async function createCalendarEvent(
  event: CreateEventInput
): Promise<GoogleEvent> {
  const calendarId = event.calendarId || "primary";
  const { calendarId: _, ...body } = event as CreateEventInput & {
    calendarId?: string;
  };
  const res = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

export async function updateCalendarEvent(
  calendarId: string,
  eventId: string,
  event: Partial<CreateEventInput>
): Promise<GoogleEvent> {
  const { calendarId: _, ...body } = event as Partial<CreateEventInput> & {
    calendarId?: string;
  };
  const res = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string
): Promise<void> {
  await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
    }
  );
}
