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
