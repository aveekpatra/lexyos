/**
 * Centralized Google Calendar sync utilities.
 * ALL Google Calendar operations go through here — no inline API calls elsewhere.
 *
 * Rules:
 * 1. Only tasks with source === "google_calendar" are synced TO Google
 * 2. Local tasks with googleEventId were explicitly pushed — updates go to Google too
 * 3. Pushing a local task to Google is an explicit user action (right-click menu)
 * 4. Editing a Google-source task syncs changes back to Google automatically
 * 5. Deleting a Google-source task deletes the Google event
 * 6. Completing a Google-source task adds [Done] prefix on Google
 */

import type { Doc } from "@/convex/_generated/dataModel";

/** Should changes to this task be synced back to Google Calendar? */
export function shouldSyncToGoogle(task: Doc<"tasks">): boolean {
  return !!task.googleEventId;
}

/** Format time parts into ISO datetime string (no timezone suffix) */
function toISO(date: string, time: string): string {
  return `${date}T${time}:00`;
}

/** Get the user's IANA timezone */
function getUserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Sync a task update to Google Calendar.
 * Call this AFTER updating Convex, with the task's state BEFORE the update
 * and the fields that were changed.
 */
export async function syncTaskUpdateToGoogle(
  task: Doc<"tasks">,
  changes: Record<string, unknown>,
): Promise<void> {
  if (!shouldSyncToGoogle(task)) return;

  const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
  const calId = task.googleCalendarId || "primary";
  const tz = getUserTz();
  const updates: Record<string, unknown> = {};

  // Title change
  if ("title" in changes && changes.title) {
    updates.summary = changes.title;
  }

  // Description change
  if ("description" in changes && changes.description !== undefined) {
    updates.description = changes.description;
  }

  // Date or time change — always rebuild BOTH start and end from the merged state
  const dateChanged = "dueDate" in changes || "dueTime" in changes ||
    "scheduledStartTime" in changes || "scheduledEndTime" in changes;

  if (dateChanged) {
    // Merge changes with existing task state to get the full picture
    const newDate = (changes.dueDate as string) || task.dueDate || task.scheduledDate;
    const newStartTime = (changes.dueTime as string) || (changes.scheduledStartTime as string) ||
      (task as Record<string, unknown>).dueTime as string || task.scheduledStartTime;
    const newEndTime = (changes.scheduledEndTime as string) || task.scheduledEndTime;

    if (newDate && newStartTime) {
      const startISO = toISO(newDate, newStartTime);

      // Calculate end time — preserve the original duration if possible
      let endTime = newEndTime;
      if (!endTime) {
        // Try to preserve original duration
        const origStart = task.scheduledStartTime;
        const origEnd = task.scheduledEndTime;
        if (origStart && origEnd) {
          const [osh, osm] = origStart.split(":").map(Number);
          const [oeh, oem] = origEnd.split(":").map(Number);
          const durationMin = (oeh * 60 + oem) - (osh * 60 + osm);
          if (durationMin > 0) {
            const [nsh, nsm] = newStartTime.split(":").map(Number);
            const endMin = nsh * 60 + nsm + durationMin;
            endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
          }
        }
      }
      if (!endTime) {
        // Fallback: 1 hour after start
        const [h, m] = newStartTime.split(":").map(Number);
        const endMin = h * 60 + m + 60;
        endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      }
      const endISO = toISO(newDate, endTime);

      updates.start = { dateTime: startISO, timeZone: tz };
      updates.end = { dateTime: endISO, timeZone: tz };
    }
  }

  if (Object.keys(updates).length > 0) {
    await updateGoogleEvent(calId, task.googleEventId!, updates);
  }
}

/**
 * Sync task completion to Google Calendar.
 * Adds/removes [Done] prefix from the event title.
 */
export async function syncTaskCompletionToGoogle(
  task: Doc<"tasks">,
  isNowDone: boolean,
): Promise<void> {
  if (!shouldSyncToGoogle(task)) return;

  const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
  const calId = task.googleCalendarId || "primary";
  const newTitle = isNowDone
    ? `[Done] ${task.title}`
    : task.title.replace(/^\[Done\]\s*/, "");

  await updateGoogleEvent(calId, task.googleEventId!, { summary: newTitle });
}

/**
 * Delete a task's corresponding Google Calendar event.
 */
export async function syncTaskDeletionToGoogle(
  task: Doc<"tasks">,
): Promise<void> {
  if (!shouldSyncToGoogle(task)) return;

  const { deleteGoogleEvent } = await import("@/app/actions/calendarSync");
  const calId = task.googleCalendarId || "primary";
  await deleteGoogleEvent(calId, task.googleEventId!);
}

/**
 * Push a local task to Google Calendar (explicit user action).
 * Returns the Google event ID and calendar ID.
 */
export async function pushLocalTaskToGoogle(
  task: Doc<"tasks">,
): Promise<{ googleEventId: string; googleCalendarId: string } | null> {
  const dateStr = task.dueDate || task.scheduledDate;
  if (!dateStr) return null;

  const { pushTaskToGoogleCalendar } = await import("@/app/actions/calendarSync");
  const dueTime = (task as Record<string, unknown>).dueTime as string | undefined || task.scheduledStartTime;
  let durationMinutes = 60;
  if (task.scheduledStartTime && task.scheduledEndTime) {
    const [sh, sm] = task.scheduledStartTime.split(":").map(Number);
    const [eh, em] = task.scheduledEndTime.split(":").map(Number);
    const dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur > 0) durationMinutes = dur;
  }

  const result = await pushTaskToGoogleCalendar({
    id: task._id,
    title: task.title,
    description: task.description,
    dueDate: dateStr,
    dueTime: dueTime,
    durationMinutes,
  });

  return {
    googleEventId: result.googleEventId,
    googleCalendarId: result.googleCalendarId || "primary",
  };
}
