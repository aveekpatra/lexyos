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
