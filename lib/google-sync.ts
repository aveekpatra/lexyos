/**
 * Centralized Google Calendar sync utilities.
 * ALL Google Calendar operations go through here — no inline API calls elsewhere.
 *
 * Rules:
 * 1. Any task with a date auto-syncs to Google Calendar (as all-day if no time)
 * 2. Tasks with googleEventId update the existing event
 * 3. Tasks without googleEventId auto-push on date set
 * 4. Deleting a task with googleEventId deletes the Google event
 * 5. Completing a task adds [Done] prefix on Google
 * 6. Clearing the date from a task deletes the Google event
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
 * - If the task already has a googleEventId, updates the event.
 * - If the task just got a date (no googleEventId), auto-pushes as a new event.
 * - Returns { googleEventId, googleCalendarId } if a new event was created.
 *
 * Call AFTER updating Convex, with the task state BEFORE the update.
 */
export async function syncTaskUpdateToGoogle(
  task: Doc<"tasks">,
  changes: Record<string, unknown>,
): Promise<{ googleEventId: string; googleCalendarId: string } | null> {
  const tz = getUserTz();

  // clearDueDate resets to today in Convex — update the Google event to today too
  if ("clearDueDate" in changes && changes.clearDueDate && task.googleEventId) {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    try {
      const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
      // Reset to all-day event on today
      await updateGoogleEvent(task.googleCalendarId || "primary", task.googleEventId, {
        start: { date: today },
        end: { date: tomorrow },
      });
    } catch (err) {
      console.warn("Failed to update Google event on date clear:", err);
    }
    return null;
  }

  // If task already has a Google event, update it
  if (task.googleEventId) {
    const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
    const calId = task.googleCalendarId || "primary";
    const updates: Record<string, unknown> = {};

    // Title change
    if ("title" in changes && changes.title) {
      updates.summary = changes.title;
    }

    // Description change
    if ("description" in changes && changes.description !== undefined) {
      updates.description = changes.description;
    }

    // Date or time change — rebuild start/end
    const dateChanged = "dueDate" in changes || "dueTime" in changes ||
      "scheduledStartTime" in changes || "scheduledEndTime" in changes;

    if (dateChanged) {
      const newDate = (changes.dueDate as string) || task.dueDate || task.scheduledDate;
      const newStartTime = (changes.dueTime as string) || (changes.scheduledStartTime as string) ||
        (task as Record<string, unknown>).dueTime as string || task.scheduledStartTime;
      const newEndTime = (changes.scheduledEndTime as string) || task.scheduledEndTime;

      if (newDate) {
        if (newStartTime) {
          // Timed event
          const startISO = toISO(newDate, newStartTime);
          let endTime = newEndTime;
          if (!endTime) {
            const origStart = task.scheduledStartTime;
            const origEnd = task.scheduledEndTime;
            if (origStart && origEnd) {
              const [osh, osm] = origStart.split(":").map(Number);
              const [oeh, oem] = origEnd.split(":").map(Number);
              const durationMin = (oeh * 60 + oem) - (osh * 60 + osm);
              if (durationMin > 0) {
                const [nsh, nsm] = newStartTime.split(":").map(Number);
                const endMin = nsh * 60 + nsm + durationMin;
                // NOTE: % 24 wraps the hour but does NOT advance the date.
                endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
              }
            }
          }
          if (!endTime) {
            const [hh, mm] = newStartTime.split(":").map(Number);
            const endMin = hh * 60 + mm + 60;
            // NOTE: % 24 wraps the hour but does NOT advance the date.
            endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
          }
          updates.start = { dateTime: startISO, timeZone: tz };
          updates.end = { dateTime: toISO(newDate, endTime), timeZone: tz };
        } else {
          // All-day event (date only, no time)
          const nextDay = new Date(newDate + "T00:00:00");
          nextDay.setDate(nextDay.getDate() + 1);
          const endDate = nextDay.toISOString().slice(0, 10);
          updates.start = { date: newDate };
          updates.end = { date: endDate };
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateGoogleEvent(calId, task.googleEventId, updates);
    }
    return null;
  }

  // No googleEventId — auto-push if the task now has a date
  const newDate = (changes.dueDate as string) || task.dueDate || task.scheduledDate;
  if (!newDate) return null;

  // Auto-push as a new Google Calendar event
  const result = await pushLocalTaskToGoogle({
    ...task,
    dueDate: newDate,
  } as Doc<"tasks">);
  return result;
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
 * Push a local task to Google Calendar.
 * Creates a new event — all-day if no time set, timed if time exists.
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
