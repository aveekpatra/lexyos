import type { Doc } from "@/convex/_generated/dataModel";
import { parseISO, isBefore, isToday, isSameDay, startOfDay } from "date-fns";

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
