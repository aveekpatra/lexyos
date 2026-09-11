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

export interface CalendarEventsResult {
  events: GoogleEvent[];
  /** Calendars whose fetch failed. When non-empty the event list is partial and
   *  MUST NOT be used to infer deletions. */
  failedCalendarIds: string[];
}

/**
 * Fetch every event in [timeMin, timeMax) across all selected calendars.
 * Follows `nextPageToken` so the result is complete, and reports per-calendar
 * failures instead of silently dropping them.
 */
export async function getCalendarEventsDetailed(
  timeMin: string,
  timeMax: string,
  timeZone?: string,
): Promise<CalendarEventsResult> {
  const [calendars, eventColorMap] = await Promise.all([
    getCalendarList(),
    getEventColorMap(),
  ]);
  const selectedCalendars = calendars.filter(
    (c) => c.selected !== false
  );

  const allEvents: GoogleEvent[] = [];
  const failedCalendarIds: string[] = [];

  await Promise.all(
    selectedCalendars.map(async (calendar) => {
      try {
        let pageToken: string | undefined;
        do {
          const params = new URLSearchParams({
            timeMin,
            timeMax,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "2500",
          });
          // Ask Google to return dateTime values pre-converted to the user's
          // timezone (with DST applied). Avoids any client/server-side conversion
          // ambiguity.
          if (timeZone) params.set("timeZone", timeZone);
          if (pageToken) params.set("pageToken", pageToken);
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
          pageToken = data.nextPageToken || undefined;
        } while (pageToken);
      } catch (err) {
        console.warn(`[calendar-api] fetch failed for calendar ${calendar.id}:`, err);
        failedCalendarIds.push(calendar.id);
      }
    })
  );

  allEvents.sort((a, b) => {
    const aTime = a.start.dateTime || a.start.date || "";
    const bTime = b.start.dateTime || b.start.date || "";
    return aTime.localeCompare(bTime);
  });
  return { events: allEvents, failedCalendarIds };
}

/** Convenience wrapper that returns only the events (partial on failure). */
export async function getCalendarEvents(
  timeMin: string,
  timeMax: string,
  timeZone?: string,
): Promise<GoogleEvent[]> {
  return (await getCalendarEventsDetailed(timeMin, timeMax, timeZone)).events;
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
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  // Google only returns nextSyncToken on the LAST page, so the whole change
  // set must be paged through or the token never advances.
  do {
    const params = new URLSearchParams({ maxResults: "2500" });
    if (pageToken) params.set("pageToken", pageToken);
    else params.set("syncToken", syncToken);

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
    for (const event of data.items ?? []) {
      events.push({ ...(event as GoogleEvent), calendarId });
    }
    pageToken = data.nextPageToken || undefined;
    if (!pageToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken, fullSyncRequired: false };
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
