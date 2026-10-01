import "server-only";
import { getEvent, getSeriesInstances, type GoogleEvent } from "@/lib/calendar-api";
import { parseRRule } from "@/lib/google-rrule";
import type { Recurrence } from "@/convex/lib/recurrence";

/**
 * Google events to the rows tasks.bulkUpsertFromGoogle takes. The one rule
 * that matters: a recurring SERIES becomes ONE task. Google (with
 * singleEvents=true) hands us every instance; we group them by their master,
 * pick the next upcoming instance for the date and time, read the master's
 * RRULE for the repeat rule, and point the task at the master id. Completing
 * it rolls forward locally; the series in Google (or Todoist behind it) is
 * never rewritten from here.
 */
export type SyncRow = {
  googleEventId: string;
  googleCalendarId: string;
  googleRecurringEventId?: string;
  recurrence?: Recurrence;
  /** Set only when Google manages the event itself (convex/lib/googleEvents.ts). */
  googleEventType?: string;
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

const SEP = "|";
const dateOf = (e: GoogleEvent) => (e.start.dateTime ?? e.start.date ?? "").slice(0, 10);
const timeOf = (iso?: string) => (iso && iso.includes("T") && iso.length >= 16 ? iso.slice(11, 16) : undefined);
const declinedBySelf = (e: GoogleEvent) => !!e.attendees?.some((a) => a.self && a.responseStatus === "declined");

function rowFromEvent(e: GoogleEvent, tz: string): SyncRow {
  return {
    googleEventId: e.id,
    googleCalendarId: e.calendarId || "primary",
    googleEventType: e.eventType && e.eventType !== "default" ? e.eventType : undefined,
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

/**
 * Collapse a batch of events. `today` is the user's local date. With
 * `refetchSeries` every series touched by the batch has its upcoming
 * instances re-read from Google, which the incremental feed needs because it
 * only carries the instances that changed.
 */
export async function collapseGoogleEvents(
  events: GoogleEvent[],
  opts: { tz: string; today: string; showDeclined: boolean; refetchSeries?: boolean; horizonDays?: number },
): Promise<{ rows: SyncRow[]; seriesIds: string[] }> {
  const rows: SyncRow[] = [];
  const series = new Map<string, { calendarId: string; instances: GoogleEvent[] }>();

  for (const e of events) {
    if (e.status === "cancelled" && !e.recurringEventId) continue;
    const cal = e.calendarId || "primary";
    if (e.recurringEventId) {
      const key = `${cal}${SEP}${e.recurringEventId}`;
      const s = series.get(key) ?? { calendarId: cal, instances: [] };
      s.instances.push(e);
      series.set(key, s);
    } else if (e.recurrence && e.recurrence.length) {
      // The master itself (the feed sends it when the rule changes).
      const key = `${cal}${SEP}${e.id}`;
      if (!series.has(key)) series.set(key, { calendarId: cal, instances: [] });
    } else {
      if (!opts.showDeclined && declinedBySelf(e)) continue;
      rows.push(rowFromEvent(e, opts.tz));
    }
  }

  const horizon = opts.horizonDays ?? 60;
  const timeMin = new Date(`${opts.today}T00:00:00`).toISOString();
  const timeMax = new Date(Date.parse(timeMin) + horizon * 86400000).toISOString();
  const seriesIds = [...series.keys()].map((k) => k.slice(k.indexOf(SEP) + 1));

  // Each series costs one master read (for the RRULE) and, when asked, one
  // instances read. Dozens of series must fit inside the route's time budget,
  // so they resolve concurrently, a few at a time.
  const entries = [...series.entries()];
  const resolved: Array<SyncRow | null> = new Array(entries.length).fill(null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const idx = cursor++;
      const [key, s] = entries[idx];
      const masterId = key.slice(key.indexOf(SEP) + 1);
      let instances = s.instances;
      const [fetchedInstances, master] = await Promise.all([
        opts.refetchSeries || instances.length === 0
          ? getSeriesInstances(s.calendarId, masterId, timeMin, timeMax, opts.tz).catch(() => null)
          : Promise.resolve(null),
        getEvent(s.calendarId, masterId).catch(() => null),
      ]);
      if (fetchedInstances) instances = fetchedInstances;
      const live = instances
        .filter((i) => i.status !== "cancelled" && (opts.showDeclined || !declinedBySelf(i)))
        .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
      const upcoming = live.find((i) => dateOf(i) >= opts.today);
      if (!upcoming) continue; // nothing ahead inside the horizon: no live task
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
  return { rows, seriesIds };
}
