/**
 * Google makes some calendar events itself, from Gmail (tickets, flights,
 * reservations: eventType "fromGmail"). Apps cannot change their title,
 * description or times, so Lexyos never writes to them. The task keeps its
 * own title and time; the calendar entry stays as Google made it.
 *
 * Kept free of server imports so the browser, the Next routes and Convex can all use it.
 */
export function googleOwnsEvent(task: { googleEventType?: string }): boolean {
  return task.googleEventType === "fromGmail";
}

/**
 * A completed task's event is titled "[Done] ..." (or "[Missed] ...") on the
 * calendar. That prefix belongs to the calendar only: a pull must never copy
 * it back into the task's own title.
 */
export function bareEventTitle(title: string): string {
  return title.replace(/^\[(Done|Missed)\]\s*/, "");
}

type EventTime = { date?: string | null; dateTime?: string | null; timeZone?: string | null };

/**
 * Google merges nested objects on PATCH. Sending { start: { dateTime } } to an
 * all-day event keeps its old start.date next to the new time, and Google
 * rejects the pair as "Invalid start time" (the same the other way round).
 * Null out the other shape so a patch can turn all-day into timed and back.
 */
export function replaceEventTimes<T extends { start?: EventTime; end?: EventTime }>(body: T): T {
  const swap = (t: EventTime | undefined): EventTime | undefined =>
    !t ? t : t.dateTime ? { ...t, date: null } : t.date ? { ...t, dateTime: null, timeZone: null } : t;
  return { ...body, start: swap(body.start), end: swap(body.end) };
}
