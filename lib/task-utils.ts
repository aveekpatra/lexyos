import type { Doc } from "@/convex/_generated/dataModel";
import { parseISO, isBefore, isToday, isSameDay, startOfDay } from "date-fns";
import { normalizeRecurrence, occurrencesBetween } from "@/convex/lib/recurrence";
import { durationMinutes, endTimeFor, DEFAULT_EVENT_MINUTES } from "@/lib/time-utils";

/**
 * A date a repeating task WILL occupy, ahead of the one it occupies now.
 * A recurring task is a single row that rolls forward when completed, so
 * without these the week ahead looks empty and you plan straight over it.
 * Not a task: it has no id of its own and nothing about it can be edited.
 */
export interface ProjectedOccurrence {
  key: string;
  task: Doc<"tasks">;
  date: string;
  /** Set when the rule itself dictates the time, as weekly slots do. */
  start?: string;
  end?: string;
}

/**
 * Every future occurrence of every repeating task in [fromDate, toDate].
 * Dates are "YYYY-MM-DD". The task's own date is never included: it is already
 * on the board as the real thing.
 */
export function projectedOccurrences(
  tasks: Doc<"tasks">[],
  fromDate: string,
  toDate: string,
): ProjectedOccurrence[] {
  const out: ProjectedOccurrence[] = [];
  for (const t of tasks) {
    if (t.status === "done" || t.parentTaskId) continue;
    const anchor = getTaskDate(t);
    if (!anchor) continue;
    const rec = normalizeRecurrence(t.recurrence, anchor);
    if (!rec) continue;
    // A weekly slot may move the time; when it gives a start but no end, keep
    // the task's own length rather than pairing a new start with an old end.
    const ownLength = durationMinutes(t.scheduledStartTime, t.scheduledEndTime) ?? DEFAULT_EVENT_MINUTES;
    for (const occ of occurrencesBetween(rec, anchor, fromDate, toDate)) {
      const start = occ.start ?? t.scheduledStartTime ?? t.dueTime ?? undefined;
      const end = occ.start
        ? occ.end ?? endTimeFor(occ.start, ownLength)
        : t.scheduledEndTime ?? undefined;
      out.push({ key: `${t._id}@${occ.date}`, task: t, date: occ.date, start, end });
    }
  }
  return out;
}

/** Check if a task originates from Google Calendar. source is the single source of truth. */
export function isGoogleCalEvent(t: Doc<"tasks">): boolean {
  return t.source === "google_calendar";
}

/** Get the effective date string from a task */
export function getTaskDate(t: Doc<"tasks">): string | undefined {
  return t.dueDate || t.scheduledDate || undefined;
}

/** Parse a task's date — returns null if no date */
export function parseTaskDate(t: Doc<"tasks">): Date | null {
  const ds = getTaskDate(t);
  return ds ? parseISO(ds) : null;
}

/**
 * Compute overdue tasks from a list.
 * Rules:
 * - Only local tasks (never Google Calendar events)
 * - Only tasks with dates before today
 * - Only active (non-done) tasks
 */
export function getOverdueTasks(tasks: Doc<"tasks">[]): Doc<"tasks">[] {
  const today = startOfDay(new Date());
  return tasks.filter((t) => {
    if (t.status === "done") return false;
    if (isGoogleCalEvent(t)) return false;
    const d = parseTaskDate(t);
    return d !== null && isBefore(d, today) && !isToday(d);
  });
}

/**
 * Get tasks that fall on a specific date (active only, excludes done).
 */
export function getTasksForDate(tasks: Doc<"tasks">[], date: Date): Doc<"tasks">[] {
  return tasks.filter((t) => {
    if (t.status === "done") return false;
    const d = parseTaskDate(t);
    return d !== null && isSameDay(d, date);
  });
}

/**
 * Get done tasks that fall on a specific date.
 */
export function getDoneTasksForDate(tasks: Doc<"tasks">[], date: Date): Doc<"tasks">[] {
  return tasks.filter((t) => {
    if (t.status !== "done") return false;
    const d = parseTaskDate(t);
    return d !== null && isSameDay(d, date);
  });
}
