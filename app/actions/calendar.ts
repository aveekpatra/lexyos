"use server";

/**
 * Server actions that wrap Calendar API functions for client-side use.
 * The actual implementation lives in lib/calendar-api.ts (plain module).
 * This file only re-exports as "use server" so clients can call them as RPCs.
 */
import * as api from "@/lib/calendar-api";

// Re-export types (types don't trigger server action wrapping)
export type { GoogleCalendar, GoogleEvent, CreateEventInput } from "@/lib/calendar-api";

export async function getCalendarList() {
  return api.getCalendarList();
}

export async function getCalendarEvents(timeMin: string, timeMax: string) {
  return api.getCalendarEvents(timeMin, timeMax);
}

export async function createCalendarEvent(event: api.CreateEventInput) {
  return api.createCalendarEvent(event);
}

export async function updateCalendarEvent(
  calendarId: string,
  eventId: string,
  event: Partial<api.CreateEventInput>
) {
  return api.updateCalendarEvent(calendarId, eventId, event);
}

export async function deleteCalendarEvent(calendarId: string, eventId: string) {
  return api.deleteCalendarEvent(calendarId, eventId);
}
