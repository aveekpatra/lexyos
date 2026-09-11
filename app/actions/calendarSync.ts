"use server";

import {
  getCalendarEventsDetailed,
  getCalendarList,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type CreateEventInput,
} from "@/lib/calendar-api";
import { addDaysToDateStr, endTimeFor, DEFAULT_EVENT_MINUTES } from "@/lib/time-utils";

/**
 * Fetch events from Google Calendar and return them in the format
 * expected by tasks.upsertFromGoogle / tasks.bulkUpsertFromGoogle.
 *
 * Maps Google Calendar fields to task fields:
 * - summary -> title
 * - startDateTime -> parsed into dueDate, dueTime, scheduledStartTime
 * - endDateTime -> parsed into scheduledEndTime
 */
export interface GoogleEventsForSync {
  events: ReturnType<typeof mapEventForSync>[];
  /** false when at least one calendar failed: the list is partial and must not
   *  be used to infer deletions. */
  complete: boolean;
  failedCalendarIds: string[];
}

export async function fetchGoogleEventsForSync(
  timeMin: string,
  timeMax: string,
  userTimeZone?: string,
): Promise<GoogleEventsForSync> {
  const tz = userTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Google returns dateTime values pre-converted to `tz` with DST applied.
  const { events, failedCalendarIds } = await getCalendarEventsDetailed(timeMin, timeMax, tz);
  return {
    events: events.map((e) => mapEventForSync(e, tz)),
    complete: failedCalendarIds.length === 0,
    failedCalendarIds,
  };
}

function mapEventForSync(
  e: Awaited<ReturnType<typeof getCalendarEventsDetailed>>["events"][number],
  tz: string,
) {
  return {
    googleEventId: e.id,
    googleCalendarId: e.calendarId || "primary",
    title: e.summary || "(No title)",
    description: e.description,
    location: e.location,
    // Pass through directly — Google already gave us local time in `tz`.
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
    // Pass through the Convex task ID if set via extendedProperties (round-trip identification)
    unifocusTaskId: e.extendedProperties?.private?.unifocus_id || undefined,
  };
}

/**
 * Fetch all calendars the user has access to.
 */
export async function fetchGoogleCalendars() {
  return getCalendarList();
}

/**
 * Push a new event to Google Calendar.
 * Returns the Google event data for upserting into Convex tasks.
 */
export async function pushEventToGoogle(event: CreateEventInput) {
  const created = await createCalendarEvent(event);
  return {
    googleEventId: created.id,
    googleCalendarId: event.calendarId || "primary",
    title: created.summary || "(No title)",
    description: created.description,
    location: created.location,
    startDateTime: created.start.dateTime,
    startDate: created.start.date,
    endDateTime: created.end.dateTime,
    endDate: created.end.date,
    timeZone: created.start.timeZone,
    googleStatus: created.status,
    htmlLink: created.htmlLink,
    calendarColor: created.colorId,
    isAllDay: !created.start.dateTime && !!created.start.date,
  };
}

/**
 * Update an existing Google Calendar event.
 */
export async function updateGoogleEvent(
  calendarId: string,
  eventId: string,
  updates: Partial<CreateEventInput>
) {
  const updated = await updateCalendarEvent(calendarId, eventId, updates);
  return {
    googleEventId: updated.id,
    googleCalendarId: calendarId,
    title: updated.summary || "(No title)",
    description: updated.description,
    location: updated.location,
    startDateTime: updated.start.dateTime,
    startDate: updated.start.date,
    endDateTime: updated.end.dateTime,
    endDate: updated.end.date,
    timeZone: updated.start.timeZone,
    googleStatus: updated.status,
    htmlLink: updated.htmlLink,
    calendarColor: updated.colorId,
    isAllDay: !updated.start.dateTime && !!updated.start.date,
  };
}

/**
 * Delete a Google Calendar event.
 */
export async function deleteGoogleEvent(calendarId: string, eventId: string) {
  await deleteCalendarEvent(calendarId, eventId);
}

/**
 * Push a task to Google Calendar as a time block.
 * Used when a task gets scheduled with a date + time.
 * Stores the Convex task ID in extendedProperties.private.unifocus_id.
 */
export async function pushTaskToGoogleCalendar(task: {
  id?: string;          // Convex task _id
  title: string;
  description?: string;
  dueDate: string;        // YYYY-MM-DD
  dueTime?: string;       // HH:MM
  durationMinutes?: number;
  calendarId?: string;
  timeZone?: string;
}) {
  const tz = task.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  let event: CreateEventInput;

  if (task.dueTime) {
    // Timed event. The end is clamped to 23:59 on the same day, matching the
    // rule Convex and the grid use, so the three never disagree.
    const time = task.dueTime;
    const duration = task.durationMinutes || DEFAULT_EVENT_MINUTES;
    const startISO = `${task.dueDate}T${time}:00`;
    const endISO = `${task.dueDate}T${endTimeFor(time, duration)}:00`;

    event = {
      summary: task.title,
      description: task.description,
      start: { dateTime: startISO, timeZone: tz },
      end: { dateTime: endISO, timeZone: tz },
      calendarId: task.calendarId || "primary",
    };
  } else {
    // All-day event (no time specified). Google's end date is exclusive.
    const endDate = addDaysToDateStr(task.dueDate, 1);

    event = {
      summary: task.title,
      description: task.description,
      start: { date: task.dueDate },
      end: { date: endDate },
      calendarId: task.calendarId || "primary",
    };
  }

  // Include Convex task ID in extended properties for round-trip identification
  if (task.id) {
    event.extendedProperties = {
      private: { unifocus_id: task.id },
    };
  }

  return pushEventToGoogle(event);
}
