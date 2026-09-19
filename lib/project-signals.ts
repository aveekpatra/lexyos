import { differenceInCalendarDays, format, parseISO, startOfWeek, endOfWeek, isWithinInterval } from "date-fns";
import type { Doc } from "@/convex/_generated/dataModel";
import { getTaskDate, parseTaskDate, getOverdueTasks } from "@/lib/task-utils";
import { resolveTaskBlock, localDateStr } from "@/lib/time-utils";

export type Signal = { label: string; value: string; tone?: "warn" | "good" };

/**
 * Facts about a personal project, each derived from the tasks themselves:
 * what is open, what is late, what got finished lately, how much time is
 * already booked this week, and when the next deadline lands. Nothing here
 * is an estimate or a score.
 */
export function projectSignals(tasks: Doc<"tasks">[], now = new Date()): Signal[] {
  const top = tasks.filter((t) => !t.parentTaskId);
  const open = top.filter((t) => t.status !== "done");
  const overdue = getOverdueTasks(open);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const inWeek = (d: Date | null) => !!d && isWithinInterval(d, { start: weekStart, end: weekEnd });

  const doneLast7 = top.filter((t) => t.status === "done" && t.completedAt && now.getTime() - t.completedAt <= 7 * 86400000).length;
  const donePrev7 = top.filter((t) => t.status === "done" && t.completedAt && now.getTime() - t.completedAt > 7 * 86400000 && now.getTime() - t.completedAt <= 14 * 86400000).length;

  let bookedMin = 0;
  for (const t of open) {
    const d = parseTaskDate(t);
    if (!inWeek(d) || (d && localDateStr(d) < localDateStr(now))) continue;
    const block = resolveTaskBlock(t);
    if (block) bookedMin += block.endMin - block.startMin;
  }
  const hours = Math.round((bookedMin / 60) * 10) / 10;

  const upcoming = open.map((t) => getTaskDate(t)).filter((d): d is string => !!d && d >= localDateStr(now)).sort()[0];
  const nextDue = upcoming ? (() => { const days = differenceInCalendarDays(parseISO(upcoming), now); return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days <= 6 ? format(parseISO(upcoming), "EEEE") : format(parseISO(upcoming), "d MMM"); })() : "Nothing dated";

  const lastTouch = Math.max(0, ...top.map((t) => Math.max(t.completedAt ?? 0, t._creationTime)));
  const idleDays = lastTouch ? differenceInCalendarDays(now, new Date(lastTouch)) : null;

  const out: Signal[] = [
    { label: "Open", value: String(open.length) },
    { label: "Overdue", value: String(overdue.length), tone: overdue.length ? "warn" : undefined },
    { label: "Done, last 7 days", value: donePrev7 ? `${doneLast7} (${doneLast7 >= donePrev7 ? "+" : ""}${doneLast7 - donePrev7} vs prior week)` : String(doneLast7), tone: doneLast7 > 0 ? "good" : undefined },
    { label: "Booked this week", value: hours ? `${hours} h` : "Nothing scheduled" },
    { label: "Next deadline", value: nextDue },
  ];
  if (idleDays !== null && idleDays >= 14 && open.length > 0) out.push({ label: "Last activity", value: `${idleDays} days ago`, tone: "warn" });
  return out;
}
