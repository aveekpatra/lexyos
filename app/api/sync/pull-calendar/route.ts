import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  getCalendarList,
  getCalendarEventsIncremental,
  getCalendarEventsWithSyncToken,
} from "@/lib/calendar-api";

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

    for (const calendar of selectedCalendars) {
      const syncState = syncStateMap.get(calendar.id);

      if (syncState?.syncToken) {
        // Incremental sync using syncToken
        method = "incremental";
        const result = await getCalendarEventsIncremental(
          calendar.id,
          syncState.syncToken,
        );

        if (result.fullSyncRequired) {
          // syncToken expired — fall back to full sync for this calendar
          await fullSyncCalendar(convex, calendar.id, tz);
          method = "full (token expired)";
        } else {
          // Process incremental changes: upserts for live events, deletes for
          // cancelled ones (the whole point of an incremental feed).
          if (result.events.length > 0) {
            const fetchedAt = Date.now();
            const cancelledIds = result.events
              .filter((e) => e.status === "cancelled")
              .map((e) => e.id);
            const mapped = mapEventsToTaskFormat(result.events, tz);
            if (mapped.length > 0) {
              await convex.mutation(api.tasks.bulkUpsertFromGoogle, { events: mapped, fetchedAt });
            }
            if (cancelledIds.length > 0) {
              await convex.mutation(api.tasks.removeGoogleEventsByIds, { googleEventIds: cancelledIds });
            }
            totalEvents += mapped.length + cancelledIds.length;
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
        await fullSyncCalendar(convex, calendar.id, tz);
      }
    }

    return Response.json({
      method,
      calendars: selectedCalendars.length,
      totalEvents,
      message: `Calendar sync complete (${method})`,
    });
  } catch (err) {
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
    const mapped = mapEventsToTaskFormat(result.events, tz);
    if (mapped.length > 0) {
      await convex.mutation(api.tasks.bulkUpsertFromGoogle, { events: mapped, fetchedAt });
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

/** Map raw Google Calendar events to the format expected by bulkUpsertFromGoogle. */
function mapEventsToTaskFormat(
  events: Array<{
    id: string;
    calendarId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    status?: string;
    htmlLink?: string;
    calendarColor?: string;
    colorId?: string;
    updated?: string;
    extendedProperties?: { private?: Record<string, string> };
  }>,
  tz: string,
) {
  return events
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
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
    }));
}
