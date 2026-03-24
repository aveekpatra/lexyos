"use server";

import {
  getCalendarEvents,
  getCalendarList,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type GoogleEvent,
  type CreateEventInput,
} from "./calendar";

/**
 * Fetch events from Google Calendar and return them in the format
 * expected by tasks.upsertFromGoogle / tasks.bulkUpsertFromGoogle.
 *
 * Maps Google Calendar fields to task fields:
 * - summary -> title
 * - startDateTime -> parsed into dueDate, dueTime, scheduledStartTime
 * - endDateTime -> parsed into scheduledEndTime
 */
/**
 * Convert an ISO datetime to a specific timezone.
 * Handles UTC ("Z"), offset ("+01:00"), and bare datetimes.
 * Returns an ISO string in the target timezone WITHOUT offset suffix
 * so the downstream regex parser extracts the correct local time.
 */
function toLocalISO(iso: string, tz: string): string {
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;
    // Format in the target timezone
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    return iso;
  }
}

export async function fetchGoogleEventsForSync(
  timeMin: string,
  timeMax: string,
  userTimeZone?: string,
) {
  const tz = userTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const events = await getCalendarEvents(timeMin, timeMax);

  return events.map((e) => ({
    googleEventId: e.id,
    googleCalendarId: e.calendarId || "primary",
    title: e.summary || "(No title)",
    description: e.description,
    location: e.location,
    // Convert to user's local timezone so the time parser gets correct hours
    startDateTime: e.start.dateTime ? toLocalISO(e.start.dateTime, tz) : undefined,
    startDate: e.start.date,
    endDateTime: e.end.dateTime ? toLocalISO(e.end.dateTime, tz) : undefined,
    endDate: e.end.date,
    timeZone: tz,
    googleStatus: e.status,
    htmlLink: e.htmlLink,
    calendarColor: e.calendarColor,
    isAllDay: !e.start.dateTime && !!e.start.date,
    googleUpdatedAt: e.updated || undefined,
    // Pass through the Convex task ID if set via extendedProperties (round-trip identification)
    unifocusTaskId: e.extendedProperties?.private?.unifocus_id || undefined,
  }));
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
    // Timed event
    const time = task.dueTime;
    const duration = task.durationMinutes || 60;
    const startISO = `${task.dueDate}T${time}:00`;
    const [h, m] = time.split(":").map(Number);
    const endTotalMin = h * 60 + m + duration;
    // NOTE: % 24 wraps the hour but does NOT advance the date.
    const endH = String(Math.floor(endTotalMin / 60) % 24).padStart(2, "0");
    const endM = String(endTotalMin % 60).padStart(2, "0");
    const endISO = `${task.dueDate}T${endH}:${endM}:00`;

    event = {
      summary: task.title,
      description: task.description,
      start: { dateTime: startISO, timeZone: tz },
      end: { dateTime: endISO, timeZone: tz },
      calendarId: task.calendarId || "primary",
    };
  } else {
    // All-day event (no time specified)
    const nextDay = new Date(task.dueDate + "T00:00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    const endDate = nextDay.toISOString().slice(0, 10);

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
