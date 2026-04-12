/**
 * Core Google Calendar API functions — plain server-side module (NOT "use server").
 * Import this directly from other server-side code (e.g., ai.ts, calendarSync.ts).
 * For client-callable server actions, use app/actions/calendar.ts instead.
 */
import "server-only";
import { getGoogleAccessToken } from "@/app/actions/google-auth";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

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
  timeMax: string,
  timeZone?: string,
): Promise<GoogleEvent[]> {
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
        // Ask Google to return dateTime values pre-converted to the user's
        // timezone (with DST applied). Avoids any client/server-side conversion
        // ambiguity.
        if (timeZone) params.set("timeZone", timeZone);
        const res = await googleFetch(
          `/calendars/${encodeURIComponent(calendar.id)}/events?${params}`
        );
        const data = await res.json();
        const events = (data.items ?? []).map((event: GoogleEvent) => ({
          ...event,
          calendarId: calendar.id,
          calendarColor: event.colorId
            ? (eventColorMap[event.colorId] || calendar.backgroundColor)
            : calendar.backgroundColor,
        }));
        allEvents.push(...events);
      } catch {
        // Skip calendars that fail
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

/**
 * Fetch events incrementally using a syncToken.
 * Returns { events, nextSyncToken, fullSyncRequired }.
 * If syncToken is expired (410 Gone), returns fullSyncRequired: true.
 */
export async function getCalendarEventsIncremental(
  calendarId: string,
  syncToken: string,
): Promise<{ events: GoogleEvent[]; nextSyncToken?: string; fullSyncRequired: boolean }> {
  const token = await getGoogleAccessToken();
  const params = new URLSearchParams({
    syncToken,
    maxResults: "250",
  });

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (res.status === 410) {
    // syncToken expired — caller must do a full sync
    return { events: [], fullSyncRequired: true };
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const events: GoogleEvent[] = (data.items ?? []).map((event: GoogleEvent) => ({
    ...event,
    calendarId,
  }));

  return {
    events,
    nextSyncToken: data.nextSyncToken,
    fullSyncRequired: false,
  };
}

/**
 * Fetch events with full sync and return the syncToken for future incremental syncs.
 */
export async function getCalendarEventsWithSyncToken(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  timeZone?: string,
): Promise<{ events: GoogleEvent[]; nextSyncToken?: string }> {
  const token = await getGoogleAccessToken();
  const eventColorMap = await getEventColorMap();

  // Get calendar info for color
  const calendars = await getCalendarList();
  const calendar = calendars.find((c) => c.id === calendarId);
  const bgColor = calendar?.backgroundColor || "#039be5";

  const allEvents: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      maxResults: "250",
    });
    if (timeZone) params.set("timeZone", timeZone);
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const events = (data.items ?? []).map((event: GoogleEvent) => ({
      ...event,
      calendarId,
      calendarColor: event.colorId
        ? (eventColorMap[event.colorId] || bgColor)
        : bgColor,
    }));
    allEvents.push(...events);

    pageToken = data.nextPageToken;
    if (!pageToken) {
      nextSyncToken = data.nextSyncToken;
    }
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
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
