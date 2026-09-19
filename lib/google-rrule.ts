/**
 * RRULE (RFC 5545) to the app's recurrence model. Covers what Google and
 * Todoist emit for everyday habits: FREQ, INTERVAL, BYDAY (weekly), BYMONTHDAY,
 * UNTIL, COUNT. Anything richer degrades to the closest simple rule, and an
 * unreadable rule yields undefined so the task is still created, just without
 * a repeat.
 */
import type { Recurrence, Weekday } from "@/convex/lib/recurrence";

const DAY: Record<string, Weekday> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };

export function parseRRule(
  recurrence: string[] | undefined,
  opts: { anchorDate?: string; anchorStart?: string; anchorEnd?: string; lastInstanceDate?: string } = {},
): Recurrence | undefined {
  const line = recurrence?.find((r) => r.toUpperCase().startsWith("RRULE:"));
  if (!line) return undefined;
  const parts = Object.fromEntries(
    line.slice(6).split(";").map((kv) => { const [k, v] = kv.split("="); return [k.toUpperCase(), v ?? ""]; }),
  ) as Record<string, string>;
  const interval = parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10) || 1) : undefined;
  // UNTIL is a date or UTC datetime. COUNT has no closed form, so the caller
  // passes the last expanded instance it saw (Google already applied COUNT).
  const until = parts.UNTIL
    ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
    : parts.COUNT ? opts.lastInstanceDate : undefined;
  const base = { ...(interval && interval > 1 ? { interval } : {}), ...(until ? { until } : {}) };
  switch (parts.FREQ) {
    case "DAILY":
      return { freq: "daily", ...base };
    case "WEEKLY": {
      const days = (parts.BYDAY ? parts.BYDAY.split(",") : [])
        .map((d) => DAY[d.replace(/^[-+]?\d+/, "")])
        .filter((d): d is Weekday => !!d);
      const chosen = days.length ? days : opts.anchorDate ? [weekdayOfDate(opts.anchorDate)] : (["mon"] as Weekday[]);
      const slots = chosen.map((day) => ({
        day,
        ...(opts.anchorStart ? { start: opts.anchorStart } : {}),
        ...(opts.anchorEnd ? { end: opts.anchorEnd } : {}),
      }));
      return { freq: "weekly", slots, ...base };
    }
    case "MONTHLY": {
      const md = parts.BYMONTHDAY ? parseInt(parts.BYMONTHDAY.split(",")[0], 10) : undefined;
      return { freq: "monthly", ...(md ? { day: md === -1 ? ("last" as const) : md } : {}), ...base };
    }
    case "YEARLY": {
      const month = parts.BYMONTH ? parseInt(parts.BYMONTH.split(",")[0], 10) : undefined;
      const day = parts.BYMONTHDAY ? parseInt(parts.BYMONTHDAY.split(",")[0], 10) : undefined;
      return { freq: "yearly", ...(month ? { month } : {}), ...(day ? { day } : {}), ...base };
    }
    default:
      return undefined;
  }
}

function weekdayOfDate(date: string): Weekday {
  const idx = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as Weekday[])[idx];
}
