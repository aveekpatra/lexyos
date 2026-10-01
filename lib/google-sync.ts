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
import {
  DEFAULT_EVENT_MINUTES,
  addDaysToDateStr,
  durationMinutes,
  endTimeFor,
  localDateStr,
} from "@/lib/time-utils";
import { googleOwnsEvent } from "@/convex/lib/googleEvents";

/** Should changes to this task be synced back to Google Calendar? */
export function shouldSyncToGoogle(task: Doc<"tasks">): boolean {
  // A task that mirrors a recurring series must never rewrite the master:
  // moving or renaming it would change every instance in Google (and Todoist).
  // Nor may it touch an event Google made itself (convex/lib/googleEvents.ts).
  return !!task.googleEventId && !task.googleRecurringEventId && !googleOwnsEvent(task);
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
  // A series mirror is never written back; Google (or Todoist) owns the rule.
  if (task.googleRecurringEventId) return null;
  // An event Google made from Gmail can't be changed; the task keeps its own values.
  if (googleOwnsEvent(task)) return null;

  // Clearing the date removes the event: tasks.update queues its deletion
  // server-side for every client, so there is nothing to write from here.
  if ("clearDueDate" in changes && changes.clearDueDate) return null;

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
    const timeCleared = !!changes.clearDueTime || !!changes.clearScheduledStartTime;
    const dateChanged = "dueDate" in changes || "dueTime" in changes ||
      "scheduledStartTime" in changes || "scheduledEndTime" in changes || timeCleared;

    if (dateChanged) {
      const newDate = (changes.dueDate as string) || task.dueDate || task.scheduledDate;
      const startChanged = "dueTime" in changes || "scheduledStartTime" in changes;
      const newStartTime = timeCleared ? undefined :
        (changes.scheduledStartTime as string) || (changes.dueTime as string) ||
        task.scheduledStartTime || (task as Record<string, unknown>).dueTime as string;
      // Only trust an end time that was sent explicitly, or the stored one when the
      // start did not move. A moved start must never be paired with the old end.
      const explicitEnd = changes.scheduledEndTime as string | undefined;
      const storedEnd = startChanged ? undefined : task.scheduledEndTime;

      if (newDate) {
        if (newStartTime) {
          // Timed event: keep the original duration (or the default), clamped to 23:59.
          const dur =
            durationMinutes(newStartTime, explicitEnd) ??
            durationMinutes(newStartTime, storedEnd) ??
            durationMinutes(task.scheduledStartTime, task.scheduledEndTime) ??
            DEFAULT_EVENT_MINUTES;
          updates.start = { dateTime: toISO(newDate, newStartTime), timeZone: tz };
          updates.end = { dateTime: toISO(newDate, endTimeFor(newStartTime, dur)), timeZone: tz };
        } else {
          // All-day event (date only, no time). Google's end date is exclusive.
          updates.start = { date: newDate };
          updates.end = { date: addDaysToDateStr(newDate, 1) };
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

  // Auto-push as a new Google Calendar event, using the post-update times so the
  // event reflects what the user just did (not the stale pre-update snapshot).
  const result = await pushLocalTaskToGoogle({
    ...task,
    dueDate: newDate,
    ...(typeof changes.dueTime === "string" ? { dueTime: changes.dueTime } : {}),
    ...(typeof changes.scheduledStartTime === "string" ? { scheduledStartTime: changes.scheduledStartTime } : {}),
    ...(typeof changes.scheduledEndTime === "string" ? { scheduledEndTime: changes.scheduledEndTime } : {}),
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
  missed = false,
): Promise<void> {
  if (!shouldSyncToGoogle(task)) return;

  const { updateGoogleEvent } = await import("@/app/actions/calendarSync");
  const calId = task.googleCalendarId || "primary";
  const bare = task.title.replace(/^\[(Done|Missed)\]\s*/, "");
  const newTitle = isNowDone ? `${missed ? "[Missed]" : "[Done]"} ${bare}` : bare;

  await updateGoogleEvent(calId, task.googleEventId!, { summary: newTitle });
}

/** Shape returned by tasks.toggleComplete / bulkUpdateStatus. */
export interface CompletionResult {
  googleEventId?: string;
  googleCalendarId?: string;
  rolled: boolean;
  next?: { date: string; start?: string; end?: string };
}

/**
 * Sync the outcome of completing a task.
 * - Repeating task (`rolled`): the live task moved to `next`, so move its Google
 *   event there and make sure the title has no [Done] prefix.
 * - Otherwise: toggle the [Done] (or [Missed]) prefix like before.
 *
 * Pass the task state from BEFORE the mutation and `wasDone` for that state.
 *
 * The event to move is the one the RESULT names, not the one the passed task
 * carries: retracting a completion hands back the live row's link, while the
 * snapshot it was called on has none.
 */
export async function syncCompletionResultToGoogle(
  task: Doc<"tasks">,
  result: CompletionResult,
  wasDone: boolean,
  missed = false,
): Promise<void> {
  const target = {
    ...task,
    googleEventId: result.googleEventId,
    googleCalendarId: result.googleCalendarId,
  } as Doc<"tasks">;
  if (!shouldSyncToGoogle(target)) return;
  if (!result.rolled || !result.next) {
    await syncTaskCompletionToGoogle(target, !wasDone, missed);
    return;
  }
  const { next } = result;
  const changes: Record<string, unknown> = {
    title: task.title.replace(/^\[(Done|Missed)\]\s*/, ""),
    dueDate: next.date,
  };
  if (next.start) {
    changes.dueTime = next.start;
    changes.scheduledStartTime = next.start;
    if (next.end) changes.scheduledEndTime = next.end;
  } else {
    changes.clearDueTime = true;
  }
  await syncTaskUpdateToGoogle(target, changes);
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
  const dueTime = task.scheduledStartTime || (task as Record<string, unknown>).dueTime as string | undefined;
  const minutes = durationMinutes(task.scheduledStartTime, task.scheduledEndTime) ?? DEFAULT_EVENT_MINUTES;

  const result = await pushTaskToGoogleCalendar({
    id: task._id,
    title: task.title,
    description: task.description,
    dueDate: dateStr,
    dueTime: dueTime,
    durationMinutes: minutes,
    // The server action runs in the server's timezone (UTC in production);
    // without this the event lands at the wrong wall-clock time.
    timeZone: getUserTz(),
  });

  return {
    googleEventId: result.googleEventId,
    googleCalendarId: result.googleCalendarId || "primary",
  };
}
