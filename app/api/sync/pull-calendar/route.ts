import { auth } from "@clerk/nextjs/server";
import { isGoogleNotConnected } from "@/lib/google-oauth";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  getCalendarList,
  getCalendarEventsIncremental,
  getCalendarEventsWithSyncToken,
} from "@/lib/calendar-api";
import { collapseGoogleEvents } from "@/lib/calendar-series";
import { localDateStr } from "@/lib/time-utils";

export const maxDuration = 60;

/**
 * Incremental calendar pull using Google Calendar syncTokens.
 * Falls back to full sync if no syncToken exists or it expired (410 Gone).
 */
export async function POST() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const token = await getToken({ template: "convex" });
    if (!token) return Response.json({ error: "No Convex token" }, { status: 401 });

    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(token);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = localDateStr(new Date());
    const prefsRow = await convex.query(api.userPreferences.get, {});
    const showDeclined = !!(prefsRow?.prefs as { calendar?: { showDeclinedEvents?: boolean } } | undefined)?.calendar?.showDeclinedEvents;

    // Get existing sync states
    const syncStates = await convex.query(api.calendarEvents.getSyncState, {});
    const syncStateMap = new Map(
      syncStates.map((s) => [s.googleCalendarId, s])
    );

    // Get selected calendars
    const calendars = await getCalendarList();
    const selectedCalendars = calendars.filter((c) => c.selected !== false);

    let totalEvents = 0;
    let method = "none";

    const failed: string[] = [];
    for (const calendar of selectedCalendars) {
      const syncState = syncStateMap.get(calendar.id);
      try {

      if (syncState?.syncToken) {
        // Incremental sync using syncToken
        method = "incremental";
        const result = await getCalendarEventsIncremental(
          calendar.id,
          syncState.syncToken,
        );

        if (result.fullSyncRequired) {
          // syncToken expired — fall back to full sync for this calendar
          await fullSyncCalendar(convex, calendar.id, tz, today, showDeclined);
          method = "full (token expired)";
        } else {
          // Process incremental changes: upserts for live events, deletes for
          // cancelled ones (the whole point of an incremental feed).
          if (result.events.length > 0) {
            const fetchedAt = Date.now();
            // A cancelled instance of a series is not a deletion of the task; the
            // series refetch inside collapse decides what the live task looks like.
            const cancelledIds = result.events
              .filter((e) => e.status === "cancelled" && !e.recurringEventId)
              .map((e) => e.id);
            const { rows } = await collapseGoogleEvents(result.events, { tz, today, showDeclined, refetchSeries: true });
            if (rows.length > 0) {
              await convex.mutation(api.tasks.bulkUpsertFromGoogle, { events: rows, fetchedAt });
            }
            if (cancelledIds.length > 0) {
              await convex.mutation(api.tasks.removeGoogleEventsByIds, { googleEventIds: cancelledIds });
            }
            totalEvents += rows.length + cancelledIds.length;
          }

          // Save new syncToken
          if (result.nextSyncToken) {
            await convex.mutation(api.calendarEvents.updateSyncState, {
              googleCalendarId: calendar.id,
              calendarName: calendar.summary,
              calendarColor: calendar.backgroundColor,
              syncToken: result.nextSyncToken,
            });
          }
        }
      } else {
        // No syncToken — do a full sync for this calendar
        method = "full (first sync)";
        await fullSyncCalendar(convex, calendar.id, tz, today, showDeclined);
      }
      } catch (err) {
        // Keep going: the other calendars still get their pull and cursor.
        console.error(`[PullCalendar] calendar ${calendar.id} failed:`, err instanceof Error ? err.message : err);
        failed.push(calendar.id);
      }
    }

    return Response.json({
      method,
      calendars: selectedCalendars.length,
      totalEvents,
      failed,
      message: `Calendar sync complete (${method})${failed.length ? `, ${failed.length} calendar(s) failed` : ""}`,
    });
  } catch (err) {
    if (isGoogleNotConnected(err)) return Response.json({ error: "google_not_connected" }, { status: 409 });
    console.error("[PullCalendar] Error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

/** Full sync for a single calendar — fetches 30d past to 60d future, saves syncToken. */
async function fullSyncCalendar(
  convex: ConvexHttpClient,
  calendarId: string,
  tz: string,
  today: string,
  showDeclined = false,
) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - 30 * 86400000).toISOString();
  const timeMax = new Date(now.getTime() + 60 * 86400000).toISOString();

  const fetchedAt = Date.now();
  const result = await getCalendarEventsWithSyncToken(
    calendarId,
    timeMin,
    timeMax,
    tz,
  );

  if (result.events.length > 0) {
    const { rows } = await collapseGoogleEvents(result.events, { tz, today, showDeclined });
    if (rows.length > 0) {
      await convex.mutation(api.tasks.bulkUpsertFromGoogle, { events: rows, fetchedAt });
    }
  }

  // Save syncToken for future incremental syncs
  if (result.nextSyncToken) {
    const calendars = await getCalendarList();
    const cal = calendars.find((c) => c.id === calendarId);
    await convex.mutation(api.calendarEvents.updateSyncState, {
      googleCalendarId: calendarId,
      calendarName: cal?.summary,
      calendarColor: cal?.backgroundColor,
      syncToken: result.nextSyncToken,
    });
  }
}
