/**
 * Google Calendar to Convex, on the server. The same pull the web app runs
 * from the browser (app/api/sync/pull-calendar), but scheduled by
 * convex/crons.ts, so changes made in Google arrive with no app open.
 *
 * Writes go through the existing public mutations (bulkUpsertFromGoogle,
 * removeGoogleEventsByIds, updateSyncState) acting as the user via
 * AGENT_SECRET, exactly as the MCP server does, so there is one upsert path.
 *
 * Both pullers may run at once; that is safe. Upserts are idempotent, and an
 * older cursor saved last only re-reads changes already applied.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  collapseEvents, eventColors, googleAccessToken, incrementalEvents, listCalendars, todayIn, windowEvents,
  type GCalendar,
} from "./lib/googleCalendar";

/** Users who have pulled at least once: they have a Google account connected. */
export const usersToPull = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const users = new Set<string>();
    for await (const row of ctx.db.query("calendarSyncState")) users.add(row.userId);
    return [...users];
  },
});

/** Cron entry point: one scheduled pull per user, spread out a little. */
export const pullAll = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const users: string[] = await ctx.runQuery(internal.calendarPull.usersToPull, {});
    for (const [i, userId] of users.entries()) {
      await ctx.scheduler.runAfter(i * 2000, internal.calendarPull.pullUser, { userId });
    }
  },
});

export const pullUser = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<{ calendars: number; changes: number; failed: string[] } | null> => {
    const secret = process.env.AGENT_SECRET;
    const token = await googleAccessToken(userId);
    if (!secret || !token) return null;
    const agent = { secret, userId };

    const prefs = await ctx.runQuery(api.userPreferences.get, { agent });
    const showDeclined = !!(prefs?.prefs as { calendar?: { showDeclinedEvents?: boolean } } | undefined)?.calendar?.showDeclinedEvents;
    const states = await ctx.runQuery(api.calendarEvents.getSyncState, { agent });
    const cursor = new Map(states.map((s) => [s.googleCalendarId, s.syncToken]));

    const calendars = (await listCalendars(token)).filter((c) => c.selected !== false);
    // The user's zone, for "today": the primary calendar's, else the first one's.
    const userTz = calendars.find((c) => c.primary)?.timeZone ?? calendars[0]?.timeZone;
    const today = todayIn(userTz);
    let colors: Record<string, string> | null = null;
    let changes = 0;
    const failed: string[] = [];

    for (const calendar of calendars) {
      try {
        const tz = calendar.timeZone || userTz || "UTC";
        const syncToken = cursor.get(calendar.id);
        const delta = syncToken ? await incrementalEvents(token, calendar.id, syncToken) : null;
        if (delta) {
          if (delta.events.length > 0) {
            const fetchedAt = Date.now();
            // A cancelled instance is not a deleted series; the series refetch decides.
            const cancelled = delta.events.filter((e) => e.status === "cancelled" && !e.recurringEventId).map((e) => e.id);
            const rows = await collapseEvents(token, delta.events, { tz, today, showDeclined, refetchSeries: true });
            if (rows.length) await ctx.runMutation(api.tasks.bulkUpsertFromGoogle, { agent, events: rows, fetchedAt });
            if (cancelled.length) await ctx.runMutation(api.tasks.removeGoogleEventsByIds, { agent, googleEventIds: cancelled });
            changes += rows.length + cancelled.length;
          }
          if (delta.nextSyncToken) await saveCursor(ctx, agent, calendar, delta.nextSyncToken);
        } else {
          // First pull, or the cursor expired: the window the web uses, 30 days back to 60 ahead.
          colors ??= await eventColors(token);
          const now = Date.now();
          const fetchedAt = now;
          const full = await windowEvents(token, calendar.id, new Date(now - 30 * 86400000).toISOString(),
            new Date(now + 60 * 86400000).toISOString(), calendar.backgroundColor || "#039be5", colors);
          const rows = await collapseEvents(token, full.events, { tz, today, showDeclined });
          if (rows.length) await ctx.runMutation(api.tasks.bulkUpsertFromGoogle, { agent, events: rows, fetchedAt });
          changes += rows.length;
          if (full.nextSyncToken) await saveCursor(ctx, agent, calendar, full.nextSyncToken);
        }
      } catch (err) {
        // Keep going: the other calendars still get their pull and cursor.
        console.error(`[calendarPull] ${calendar.id}:`, err instanceof Error ? err.message : err);
        failed.push(calendar.id);
      }
    }
    return { calendars: calendars.length, changes, failed };
  },
});

async function saveCursor(
  ctx: ActionCtx,
  agent: { secret: string; userId: string },
  calendar: GCalendar,
  syncToken: string,
): Promise<void> {
  await ctx.runMutation(api.calendarEvents.updateSyncState, {
    agent,
    googleCalendarId: calendar.id,
    calendarName: calendar.summary,
    calendarColor: calendar.backgroundColor,
    syncToken,
  });
}
