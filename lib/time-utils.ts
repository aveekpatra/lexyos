/**
 * Pure date/time string helpers shared by the board, the Google sync layer and
 * the server actions. No timezone conversions happen here: every function works
 * on the "YYYY-MM-DD" / "HH:MM" wall-clock strings the task schema stores, so
 * the result is the same on the client (user tz) and the server (UTC).
 */

/** Default length of a timed block when a task has a start but no end. */
export const DEFAULT_EVENT_MINUTES = 60;
/** Smallest block the grid allows (resize floor). */
export const MIN_EVENT_MINUTES = 15;
/** Last representable minute of a day ("23:59"). */
export const END_OF_DAY_MIN = 23 * 60 + 59;

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" -> minutes since midnight. Returns null for malformed input. */
export function timeToMinutes(time: string | undefined | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** minutes since midnight -> "HH:MM", clamped to [00:00, 23:59]. */
export function minutesToTime(totalMin: number): string {
  const clamped = Math.max(0, Math.min(END_OF_DAY_MIN, Math.round(totalMin)));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/**
 * Duration in minutes between two "HH:MM" strings, or null when either is
 * missing or the end is not after the start (a midnight-crossing event stored
 * on a single date reads as end <= start).
 */
export function durationMinutes(start?: string | null, end?: string | null): number | null {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null || e <= s) return null;
  return e - s;
}

/**
 * Given a new start and a desired duration, return the end time on the SAME
 * day, clamped to 23:59. This is the one rule every write path uses so Convex,
 * the grid and Google always agree on an event that would cross midnight.
 */
export function endTimeFor(start: string, minutes: number): string {
  const s = timeToMinutes(start) ?? 0;
  return minutesToTime(Math.min(END_OF_DAY_MIN, s + Math.max(1, minutes)));
}

/**
 * Resolve the block a task occupies on the time grid.
 * - explicit scheduled start/end wins;
 * - a bare dueTime (or start without end) gets DEFAULT_EVENT_MINUTES;
 * - an end at or before the start (midnight-crossing) is clamped to 23:59;
 * - returns null when the task has no time at all (all-day / undated).
 */
export function resolveTaskBlock(task: {
  dueTime?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
}): { startMin: number; endMin: number } | null {
  const start = timeToMinutes(task.scheduledStartTime) ?? timeToMinutes(task.dueTime);
  if (start === null) return null;
  const explicitEnd = timeToMinutes(task.scheduledEndTime);
  let end: number;
  if (explicitEnd === null) end = start + DEFAULT_EVENT_MINUTES;
  else if (explicitEnd <= start) end = END_OF_DAY_MIN;
  else end = explicitEnd;
  return { startMin: start, endMin: Math.min(END_OF_DAY_MIN + 1, end) };
}

/** "YYYY-MM-DD" + n days, computed in UTC so the host timezone never leaks in. */
export function addDaysToDateStr(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  const out = new Date(t);
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`;
}

/** Local calendar date of a Date as "YYYY-MM-DD" (never toISOString, which is UTC). */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
