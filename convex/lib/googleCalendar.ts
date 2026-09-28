/**
 * Google Calendar reads for the server-side pull (convex/calendarPull.ts).
 *
 * Ported from lib/calendar-api.ts, lib/calendar-series.ts and
 * lib/google-rrule.ts, which the web routes still use. The difference is only
 * plumbing: every call takes the access token instead of reading the Clerk
 * session, so it runs without a browser. Keep the collapse rules identical.
 *
 * No app imports: the Convex bundle must be able to load this file.
 */
import type { Recurrence, Weekday } from "./recurrence";

const API = "https://www.googleapis.com/calendar/v3";

export type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
  status?: string;
  htmlLink?: string;
  calendarId?: string;
  calendarColor?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  recurringEventId?: string;
  recurrence?: string[];
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

export type GCalendar = { id: string; summary?: string; backgroundColor?: string; selected?: boolean; timeZone?: string; primary?: boolean };

/** Rows tasks.bulkUpsertFromGoogle takes. */
export type SyncRow = {
  googleEventId: string;
  googleCalendarId: string;
  googleRecurringEventId?: string;
  recurrence?: Recurrence;
  title: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  startDate?: string;
  endDateTime?: string;
  endDate?: string;
  timeZone?: string;
  googleStatus?: string;
  htmlLink?: string;
  calendarColor?: string;
  isAllDay: boolean;
  googleUpdatedAt?: string;
  unifocusTaskId?: string;
};

export class GoogleError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function get(token: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GoogleError(res.status, `Google Calendar ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function listCalendars(token: string): Promise<GCalendar[]> {
  return ((await get(token, "/users/me/calendarList")).items as GCalendar[] | undefined) ?? [];
}

export async function eventColors(token: string): Promise<Record<string, string>> {
  try {
    const data = await get(token, "/colors");
    const map: Record<string, string> = {};
    for (const [id, val] of Object.entries((data.event as Record<string, { background: string }>) ?? {})) map[id] = val.background;
    return map;
  } catch {
    return {};
  }
}

/** Changes since `syncToken`, all pages. null means the token expired (410): do a full sync. */
export async function incrementalEvents(
  token: string, calendarId: string, syncToken: string,
): Promise<{ events: GEvent[]; nextSyncToken?: string } | null> {
  const events: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "2500" });
    if (pageToken) params.set("pageToken", pageToken); else params.set("syncToken", syncToken);
    let data: Record<string, unknown>;
    try {
      data = await get(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    } catch (err) {
      if (err instanceof GoogleError && err.status === 410) return null;
      throw err;
    }
    for (const e of (data.items as GEvent[] | undefined) ?? []) events.push({ ...e, calendarId });
    pageToken = (data.nextPageToken as string | undefined) || undefined;
    if (!pageToken) nextSyncToken = data.nextSyncToken as string | undefined;
  } while (pageToken);
  return { events, nextSyncToken };
}

/**
 * Every event in the window, expanded, with a sync token for next time.
 * No timeZone parameter: Google then returns times with the calendar's own
 * offset, which parseGoogleDateTime reads as local wall-clock time.
 */
export async function windowEvents(
  token: string, calendarId: string, timeMin: string, timeMax: string, calendarColor: string, colors: Record<string, string>,
): Promise<{ events: GEvent[]; nextSyncToken?: string }> {
  const events: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await get(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    for (const e of (data.items as GEvent[] | undefined) ?? []) {
      events.push({ ...e, calendarId, calendarColor: e.colorId ? colors[e.colorId] || calendarColor : calendarColor });
    }
    pageToken = (data.nextPageToken as string | undefined) || undefined;
    if (!pageToken) nextSyncToken = data.nextSyncToken as string | undefined;
  } while (pageToken);
  return { events, nextSyncToken };
}

async function getEvent(token: string, calendarId: string, eventId: string): Promise<GEvent> {
  const e = (await get(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)) as unknown as GEvent;
  return { ...e, calendarId };
}

async function seriesInstances(token: string, calendarId: string, masterId: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await get(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(masterId)}/instances?${params}`);
    for (const e of (data.items as GEvent[] | undefined) ?? []) out.push({ ...e, calendarId });
    pageToken = (data.nextPageToken as string | undefined) || undefined;
  } while (pageToken);
  return out;
}

// ─── Series collapse (same rules as lib/calendar-series.ts) ───

const SEP = "|";
const dateOf = (e: GEvent) => (e.start.dateTime ?? e.start.date ?? "").slice(0, 10);
const timeOf = (iso?: string) => (iso && iso.includes("T") && iso.length >= 16 ? iso.slice(11, 16) : undefined);
const declinedBySelf = (e: GEvent) => !!e.attendees?.some((a) => a.self && a.responseStatus === "declined");

function rowFromEvent(e: GEvent, tz: string): SyncRow {
  return {
    googleEventId: e.id,
    googleCalendarId: e.calendarId || "primary",
    title: e.summary || "(No title)",
    description: e.description,
    location: e.location,
    startDateTime: e.start.dateTime,
    startDate: e.start.date,
    endDateTime: e.end.dateTime,
    endDate: e.end.date,
    timeZone: tz,
    googleStatus: e.status,
    htmlLink: e.htmlLink,
    calendarColor: e.calendarColor,
    isAllDay: !e.start.dateTime && !!e.start.date,
    googleUpdatedAt: e.updated || undefined,
    unifocusTaskId: e.extendedProperties?.private?.unifocus_id || undefined,
  };
}

/** A recurring series becomes one task pointing at its master; see lib/calendar-series.ts. */
export async function collapseEvents(
  token: string,
  events: GEvent[],
  opts: { tz: string; today: string; showDeclined: boolean; refetchSeries?: boolean; horizonDays?: number },
): Promise<SyncRow[]> {
  const rows: SyncRow[] = [];
  const series = new Map<string, { calendarId: string; instances: GEvent[] }>();

  for (const e of events) {
    if (e.status === "cancelled" && !e.recurringEventId) continue;
    const cal = e.calendarId || "primary";
    if (e.recurringEventId) {
      const key = `${cal}${SEP}${e.recurringEventId}`;
      const s = series.get(key) ?? { calendarId: cal, instances: [] };
      s.instances.push(e);
      series.set(key, s);
    } else if (e.recurrence && e.recurrence.length) {
      const key = `${cal}${SEP}${e.id}`;
      if (!series.has(key)) series.set(key, { calendarId: cal, instances: [] });
    } else {
      if (!opts.showDeclined && declinedBySelf(e)) continue;
      rows.push(rowFromEvent(e, opts.tz));
    }
  }

  const horizon = opts.horizonDays ?? 60;
  const timeMin = new Date(`${opts.today}T00:00:00Z`).toISOString();
  const timeMax = new Date(Date.parse(timeMin) + horizon * 86400000).toISOString();

  const entries = [...series.entries()];
  const resolved: Array<SyncRow | null> = new Array(entries.length).fill(null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const idx = cursor++;
      const [key, s] = entries[idx];
      const masterId = key.slice(key.indexOf(SEP) + 1);
      let instances = s.instances;
      const [fetched, master] = await Promise.all([
        opts.refetchSeries || instances.length === 0
          ? seriesInstances(token, s.calendarId, masterId, timeMin, timeMax).catch(() => null)
          : Promise.resolve(null),
        getEvent(token, s.calendarId, masterId).catch(() => null),
      ]);
      if (fetched) instances = fetched;
      const live = instances
        .filter((i) => i.status !== "cancelled" && (opts.showDeclined || !declinedBySelf(i)))
        .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
      const upcoming = live.find((i) => dateOf(i) >= opts.today);
      if (!upcoming) continue;
      const hasCount = (master?.recurrence ?? []).some((r) => /COUNT=/i.test(r));
      const recurrence = parseRRule(master?.recurrence, {
        anchorDate: dateOf(upcoming),
        anchorStart: timeOf(upcoming.start.dateTime),
        anchorEnd: timeOf(upcoming.end.dateTime),
        lastInstanceDate: hasCount ? dateOf(live[live.length - 1]) : undefined,
      });
      resolved[idx] = {
        ...rowFromEvent({ ...upcoming, calendarId: s.calendarId, calendarColor: upcoming.calendarColor ?? master?.calendarColor }, opts.tz),
        googleEventId: masterId,
        googleRecurringEventId: masterId,
        recurrence,
        htmlLink: master?.htmlLink ?? upcoming.htmlLink,
        googleUpdatedAt: master?.updated ?? upcoming.updated ?? undefined,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, worker));
  for (const r of resolved) if (r) rows.push(r);
  return rows;
}

// ─── RRULE (same as lib/google-rrule.ts) ───

const DAY: Record<string, Weekday> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };

export function parseRRule(
  recurrence: string[] | undefined,
  opts: { anchorDate?: string; anchorStart?: string; anchorEnd?: string; lastInstanceDate?: string } = {},
): Recurrence | undefined {
  const line = recurrence?.find((r) => r.toUpperCase().startsWith("RRULE:"));
  if (!line) return undefined;
  const parts = Object.fromEntries(
    line.slice(6).split(";").map((kv) => { const [k, v] = kv.split("="); return [k.toUpperCase(), v ?? ""]; }),
  ) as Record<string, string>;
  const interval = parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10) || 1) : undefined;
  const until = parts.UNTIL
    ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
    : parts.COUNT ? opts.lastInstanceDate : undefined;
  const base = { ...(interval && interval > 1 ? { interval } : {}), ...(until ? { until } : {}) };
  switch (parts.FREQ) {
    case "DAILY":
      return { freq: "daily", ...base };
    case "WEEKLY": {
      const days = (parts.BYDAY ? parts.BYDAY.split(",") : [])
        .map((d) => DAY[d.replace(/^[-+]?\d+/, "")])
        .filter((d): d is Weekday => !!d);
      const chosen = days.length ? days : opts.anchorDate ? [weekdayOfDate(opts.anchorDate)] : (["mon"] as Weekday[]);
      const slots = chosen.map((day) => ({
        day,
        ...(opts.anchorStart ? { start: opts.anchorStart } : {}),
        ...(opts.anchorEnd ? { end: opts.anchorEnd } : {}),
      }));
      return { freq: "weekly", slots, ...base };
    }
    case "MONTHLY": {
      const md = parts.BYMONTHDAY ? parseInt(parts.BYMONTHDAY.split(",")[0], 10) : undefined;
      return { freq: "monthly", ...(md ? { day: md === -1 ? ("last" as const) : md } : {}), ...base };
    }
    case "YEARLY": {
      const month = parts.BYMONTH ? parseInt(parts.BYMONTH.split(",")[0], 10) : undefined;
      const day = parts.BYMONTHDAY ? parseInt(parts.BYMONTHDAY.split(",")[0], 10) : undefined;
      return { freq: "yearly", ...(month ? { month } : {}), ...(day ? { day } : {}), ...base };
    }
    default:
      return undefined;
  }
}

function weekdayOfDate(date: string): Weekday {
  const idx = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as Weekday[])[idx];
}

/** "YYYY-MM-DD" today in a time zone; UTC if the zone is unknown. */
export function todayIn(tz: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Live Google access token from Clerk (it holds the refresh token), or null. */
export async function googleAccessToken(userId: string): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.warn("[google] CLERK_SECRET_KEY is not set");
    return null;
  }
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/oauth_access_tokens/oauth_google`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    // 400/404: the user has no Google account linked. Nothing to do, and the
    // cron asks every 5 minutes, so stay quiet. Anything else (401 bad key,
    // 5xx) is a real problem worth a warning.
    if (res.status !== 400 && res.status !== 404) console.warn(`[google] Clerk token lookup ${res.status}`);
    return null;
  }
  const tokens = (await res.json()) as { token?: string }[];
  return tokens[0]?.token ?? null;
}
