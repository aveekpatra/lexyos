/**
 * One code path for "pull a window of Google events into Convex" so the planner
 * and the rail sync button cannot interleave, and so neither can infer
 * deletions from a partial fetch.
 */
import { startOfDay, addDays, subDays } from "date-fns";
import type { ReactMutation } from "convex/react";
import type { api } from "@/convex/_generated/api";
import type { GoogleEventsForSync } from "@/app/actions/calendarSync";
import { localDateStr } from "@/lib/time-utils";

type BulkUpsert = ReactMutation<typeof api.tasks.bulkUpsertFromGoogle>;
type RemoveDeleted = ReactMutation<typeof api.tasks.removeDeletedGoogleEvents>;
type FetchEvents = (timeMin: string, timeMax: string, tz: string) => Promise<GoogleEventsForSync>;

// ReactMutation is callable, so a plain async function satisfies these in tests.
export interface CalendarSyncDeps {
  bulkUpsert: (args: Parameters<BulkUpsert>[0]) => Promise<{ upserted: number }>;
  removeDeleted: (args: Parameters<RemoveDeleted>[0]) => Promise<{ removed: number }>;
  /** Injectable for tests; defaults to the server action. */
  fetchEvents?: FetchEvents;
}

export interface CalendarSyncWindow {
  /** First local day to cover (inclusive). */
  from: Date;
  /** Last local day to cover (inclusive). */
  to: Date;
}

export interface CalendarSyncResult {
  upserted: number;
  removed: number;
  /** false when a calendar failed; the local copy was updated but nothing was deleted. */
  complete: boolean;
  failedCalendarIds: string[];
}

// Module-level chain: every sync waits for the previous one, regardless of
// which component started it.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Fetch [from, to] from Google, upsert into Convex and, only when every
 * calendar answered, remove local Google rows that Google no longer lists.
 */
export function runCalendarSync(
  window: CalendarSyncWindow,
  deps: CalendarSyncDeps,
): Promise<CalendarSyncResult> {
  const run = async (): Promise<CalendarSyncResult> => {
    const fetchEvents = deps.fetchEvents ?? (await import("@/app/actions/calendarSync")).fetchGoogleEventsForSync;
    // Google's window is [timeMin, timeMax): local midnight of the first day up
    // to local midnight after the last day. The delete window is expressed in
    // local calendar dates and shrunk by one day on each side so an event on the
    // boundary can never be treated as "missing" because of a timezone offset.
    const fromDay = startOfDay(window.from);
    const toDay = startOfDay(window.to);
    const timeMin = fromDay.toISOString();
    const timeMax = startOfDay(addDays(toDay, 1)).toISOString();
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const fetchStartedAt = Date.now();
    const { events, complete, failedCalendarIds } = await fetchEvents(timeMin, timeMax, userTz);

    let upserted = 0;
    if (events.length > 0) {
      const res = await deps.bulkUpsert({ events, fetchedAt: fetchStartedAt });
      upserted = res.upserted;
    }

    let removed = 0;
    if (complete) {
      const res = await deps.removeDeleted({
        knownGoogleEventIds: events.map((e) => e.googleEventId),
        syncRangeStart: localDateStr(addDays(fromDay, 1)),
        syncRangeEnd: localDateStr(subDays(toDay, 1)),
        fetchStartedAt,
      });
      removed = res.removed;
    }

    return { upserted, removed, complete, failedCalendarIds };
  };

  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}
