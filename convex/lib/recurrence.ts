/**
 * Recurrence model shared by Convex functions, the UI, and the AI tools.
 *
 * Design:
 * - A recurring task is ONE live task that rolls forward when completed.
 *   Completing it writes a done snapshot (for history) and moves the live
 *   task to the next occurrence. Google Calendar only ever sees the live one.
 * - Weekly rules carry per-day slots so "Monday morning, Tuesday evening"
 *   is a single rule. Daily, monthly and yearly rules keep the task's time.
 * - Dates are "YYYY-MM-DD" strings, times are "HH:MM" 24h strings. All date
 *   math is done in UTC on the string so the host timezone never leaks in.
 *
 * This file must stay free of app imports so the Convex bundle can use it.
 */

import { v, type Infer } from "convex/values";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const weekdayValidator = v.union(
  v.literal("mon"), v.literal("tue"), v.literal("wed"), v.literal("thu"),
  v.literal("fri"), v.literal("sat"), v.literal("sun"),
);

const slotValidator = v.object({
  day: weekdayValidator,
  /** "HH:MM". Absent means "keep the task's own time (or all-day)". */
  start: v.optional(v.string()),
  /** "HH:MM". Absent means "keep the task's own duration". */
  end: v.optional(v.string()),
});

export const recurrenceValidator = v.union(
  v.object({
    freq: v.literal("daily"),
    interval: v.optional(v.number()),
    until: v.optional(v.string()),
  }),
  v.object({
    freq: v.literal("weekly"),
    interval: v.optional(v.number()),
    slots: v.array(slotValidator),
    until: v.optional(v.string()),
  }),
  v.object({
    freq: v.literal("monthly"),
    interval: v.optional(v.number()),
    /** 1-31, or "last". Absent means the anchor date's day of month. */
    day: v.optional(v.union(v.number(), v.literal("last"))),
    until: v.optional(v.string()),
  }),
  v.object({
    freq: v.literal("yearly"),
    interval: v.optional(v.number()),
    /** 1-12. Absent means the anchor date's month. */
    month: v.optional(v.number()),
    /** 1-31. Absent means the anchor date's day. */
    day: v.optional(v.number()),
    until: v.optional(v.string()),
  }),
);

export type Recurrence = Infer<typeof recurrenceValidator>;
export type RecurrenceSlot = Infer<typeof slotValidator>;
export type WeeklyRecurrence = Extract<Recurrence, { freq: "weekly" }>;

/** Stored value: legacy plain strings still exist on old rows. */
export type StoredRecurrence = string | Recurrence;

export interface Occurrence {
  date: string;
  /** Present only when the rule itself dictates a time (weekly slots). */
  start?: string;
  end?: string;
}

// ─── date string helpers (UTC on purpose) ───

const pad2 = (n: number) => String(n).padStart(2, "0");

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function fromUTC(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return fromUTC(Date.UTC(y, m - 1, d + days));
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Monday ... 6 = Sunday */
function weekdayIndex(date: string): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[weekdayIndex(date)];
}

function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

export function isValidDate(date: string | undefined): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function isValidTime(time: string | undefined): time is string {
  if (!time) return false;
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

// ─── normalisation ───

/**
 * Turn whatever is stored into a structured rule. Legacy strings are mapped
 * using the task's date as the anchor. Returns undefined for "no repeat".
 */
export function normalizeRecurrence(
  raw: StoredRecurrence | undefined | null,
  anchorDate?: string,
): Recurrence | undefined {
  if (!raw) return undefined;
  if (typeof raw !== "string") return raw;
  const anchor = isValidDate(anchorDate) ? anchorDate : undefined;
  switch (raw) {
    case "daily":
      return { freq: "daily" };
    case "weekdays":
      return { freq: "weekly", slots: ["mon", "tue", "wed", "thu", "fri"].map((d) => ({ day: d as Weekday })) };
    case "weekly":
      return { freq: "weekly", slots: [{ day: anchor ? weekdayOf(anchor) : "mon" }] };
    case "biweekly":
      return { freq: "weekly", interval: 2, slots: [{ day: anchor ? weekdayOf(anchor) : "mon" }] };
    case "monthly":
      return { freq: "monthly" };
    case "yearly":
      return { freq: "yearly" };
    default:
      return undefined;
  }
}

/** Throws a readable error when a rule cannot produce occurrences. */
export function validateRecurrence(rec: Recurrence): void {
  const interval = rec.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    throw new Error("Recurrence interval must be a whole number from 1 to 52");
  }
  if (rec.until !== undefined && !isValidDate(rec.until)) {
    throw new Error("Recurrence until must be YYYY-MM-DD");
  }
  if (rec.freq === "weekly") {
    if (rec.slots.length === 0) throw new Error("Weekly recurrence needs at least one day");
    const seen = new Set<string>();
    for (const s of rec.slots) {
      if (seen.has(s.day)) throw new Error(`Weekly recurrence lists ${s.day} twice`);
      seen.add(s.day);
      if (s.start !== undefined && !isValidTime(s.start)) throw new Error(`Bad start time for ${s.day}`);
      if (s.end !== undefined && !isValidTime(s.end)) throw new Error(`Bad end time for ${s.day}`);
      if (s.end !== undefined && s.start === undefined) throw new Error(`${s.day} has an end time but no start`);
    }
  }
  if (rec.freq === "monthly" && typeof rec.day === "number" && (rec.day < 1 || rec.day > 31)) {
    throw new Error("Monthly day must be 1-31 or 'last'");
  }
  if (rec.freq === "yearly") {
    if (rec.month !== undefined && (rec.month < 1 || rec.month > 12)) throw new Error("Yearly month must be 1-12");
    if (rec.day !== undefined && (rec.day < 1 || rec.day > 31)) throw new Error("Yearly day must be 1-31");
  }
}

// ─── anchoring ───

/**
 * Does `date` sit on a day the rule can actually produce? A weekly rule owns
 * the weekday, a monthly rule the day of month, a yearly rule the month and
 * day; a date that disagrees with its own rule is a contradiction, not a
 * variation. Rules that take their day from the anchor always fit.
 */
export function dateFitsRecurrence(rec: Recurrence, date: string): boolean {
  if (!isValidDate(date)) return true;
  switch (rec.freq) {
    case "daily":
      return true;
    case "weekly":
      return rec.slots.some((s) => s.day === weekdayOf(date));
    case "monthly": {
      if (rec.day === undefined) return true;
      const [y, m, d] = parts(date);
      return rec.day === "last" ? d === daysInMonth(y, m) : d === Math.min(rec.day, daysInMonth(y, m));
    }
    case "yearly": {
      if (rec.month === undefined && rec.day === undefined) return true;
      const [y, m, d] = parts(date);
      const month = rec.month ?? m;
      const day = rec.day ?? d;
      return m === month && d === Math.min(day, daysInMonth(y, month));
    }
  }
}

/**
 * The first date on or after `date` that the rule can land on. Returns `date`
 * unchanged when it already fits, so callers can compare and report the move.
 * The result becomes the task's anchor, which is what sets an interval rule's
 * phase, so no interval arithmetic is needed here.
 */
export function alignDateToRecurrence(rec: Recurrence, date: string): string {
  if (!isValidDate(date) || dateFitsRecurrence(rec, date)) return date;
  // A weekly rule always matches inside one week; month and year rules need
  // at most a few steps, so a bounded scan is enough and stays exact.
  const limit = rec.freq === "weekly" ? 7 : 800;
  for (let i = 1; i <= limit; i++) {
    const candidate = addDays(date, i);
    if (dateFitsRecurrence(rec, candidate)) return candidate;
  }
  return date;
}

// ─── next occurrence ───

/**
 * First occurrence strictly after `from`, anchored on `anchor` (the task's
 * current date, used for interval phase and default month/day values).
 * Returns null when the rule has run out (`until` passed).
 */
export function nextOccurrence(rec: Recurrence, from: string, anchor: string = from): Occurrence | null {
  const interval = Math.max(1, rec.interval ?? 1);
  let next: Occurrence | null = null;

  switch (rec.freq) {
    case "daily": {
      // Keep phase with the anchor so "every 3 days" stays on its grid.
      const gap = diffDays(from, anchor);
      const steps = Math.floor(gap / interval) + 1;
      next = { date: addDays(anchor, steps * interval) };
      break;
    }
    case "weekly": {
      const anchorWeek = mondayOf(anchor);
      const byDay = new Map(rec.slots.map((s) => [s.day, s]));
      // Enough days to cover two full cycles.
      const limit = 7 * interval * 2 + 7;
      for (let i = 1; i <= limit; i++) {
        const date = addDays(from, i);
        const weekNo = Math.round(diffDays(mondayOf(date), anchorWeek) / 7);
        if (((weekNo % interval) + interval) % interval !== 0) continue;
        const slot = byDay.get(weekdayOf(date));
        if (!slot) continue;
        next = { date, ...(slot.start ? { start: slot.start, end: slot.end } : {}) };
        break;
      }
      break;
    }
    case "monthly": {
      const [ay, am, ad] = parts(anchor);
      const target = rec.day ?? ad;
      for (let k = 0; k < 24 * interval; k++) {
        const total = am - 1 + k * interval;
        const y = ay + Math.floor(total / 12);
        const m = (total % 12) + 1;
        const dim = daysInMonth(y, m);
        const d = target === "last" ? dim : Math.min(target, dim);
        const date = `${y}-${pad2(m)}-${pad2(d)}`;
        if (diffDays(date, from) > 0) { next = { date }; break; }
      }
      break;
    }
    case "yearly": {
      const [ay, am, ad] = parts(anchor);
      const month = rec.month ?? am;
      const day = rec.day ?? ad;
      for (let k = 0; k < 10; k++) {
        const y = ay + k * interval;
        const d = Math.min(day, daysInMonth(y, month));
        const date = `${y}-${pad2(month)}-${pad2(d)}`;
        if (diffDays(date, from) > 0) { next = { date }; break; }
      }
      break;
    }
  }

  if (next && rec.until && diffDays(next.date, rec.until) > 0) return null;
  return next;
}

// ─── human labels ───

const DAY_LABEL: Record<Weekday, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};
const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatTimeShort(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${pad2(m)}${suffix}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const isWeekdaysOnly = (slots: RecurrenceSlot[]) =>
  slots.length === 5 && ["mon", "tue", "wed", "thu", "fri"].every((d) => slots.some((s) => s.day === d && !s.start));

/** Short label for chips: "Daily", "Weekdays", "Mon, Wed", "Monthly". */
export function shortRecurrenceLabel(rec: Recurrence): string {
  const every = (unit: string) => (rec.interval && rec.interval > 1 ? `Every ${rec.interval} ${unit}s` : null);
  switch (rec.freq) {
    case "daily": return every("day") ?? "Daily";
    case "weekly": {
      if (isWeekdaysOnly(rec.slots)) return every("week") ? `Weekdays, ${every("week")!.toLowerCase()}` : "Weekdays";
      if (rec.slots.length === 7 && rec.slots.every((s) => !s.start)) return every("week") ?? "Daily";
      const days = WEEKDAYS.filter((d) => rec.slots.some((s) => s.day === d)).map((d) => DAY_LABEL[d]).join(", ");
      return every("week") ? `${days} (${every("week")!.toLowerCase()})` : days;
    }
    case "monthly": return every("month") ?? "Monthly";
    case "yearly": return every("year") ?? "Yearly";
  }
}

/** Full sentence for detail views and AI read-back. */
export function describeRecurrence(rec: Recurrence, anchorDate?: string): string {
  const n = rec.interval ?? 1;
  const until = rec.until ? ` until ${rec.until}` : "";
  switch (rec.freq) {
    case "daily":
      return (n === 1 ? "Every day" : `Every ${n} days`) + until;
    case "weekly": {
      const prefix = n === 1 ? "Every week" : `Every ${n} weeks`;
      if (isWeekdaysOnly(rec.slots)) return `${prefix} on weekdays${until}`;
      const ordered = WEEKDAYS.map((d) => rec.slots.find((s) => s.day === d)).filter(Boolean) as RecurrenceSlot[];
      const list = ordered.map((s) => {
        if (!s.start) return DAY_LABEL[s.day];
        const t = s.end ? `${formatTimeShort(s.start)}-${formatTimeShort(s.end)}` : formatTimeShort(s.start);
        return `${DAY_LABEL[s.day]} ${t}`;
      });
      return `${prefix} on ${list.join(", ")}${until}`;
    }
    case "monthly": {
      const prefix = n === 1 ? "Every month" : `Every ${n} months`;
      const day = rec.day ?? (isValidDate(anchorDate) ? parts(anchorDate)[2] : undefined);
      if (day === "last") return `${prefix} on the last day${until}`;
      return day ? `${prefix} on the ${ordinal(day)}${until}` : `${prefix}${until}`;
    }
    case "yearly": {
      const prefix = n === 1 ? "Every year" : `Every ${n} years`;
      const month = rec.month ?? (isValidDate(anchorDate) ? parts(anchorDate)[1] : undefined);
      const day = rec.day ?? (isValidDate(anchorDate) ? parts(anchorDate)[2] : undefined);
      return month && day ? `${prefix} on ${MONTH_LABEL[month - 1]} ${day}${until}` : `${prefix}${until}`;
    }
  }
}

// ─── presets (used by UI menus and documented for the AI) ───

export interface RecurrencePreset {
  id: string;
  label: string;
  build: (anchorDate: string) => Recurrence;
}

export const RECURRENCE_PRESETS: RecurrencePreset[] = [
  { id: "daily", label: "Daily", build: () => ({ freq: "daily" }) },
  { id: "weekdays", label: "Weekdays", build: () => ({ freq: "weekly", slots: ["mon", "tue", "wed", "thu", "fri"].map((d) => ({ day: d as Weekday })) }) },
  { id: "weekly", label: "Weekly", build: (a) => ({ freq: "weekly", slots: [{ day: weekdayOf(a) }] }) },
  { id: "biweekly", label: "Every 2 weeks", build: (a) => ({ freq: "weekly", interval: 2, slots: [{ day: weekdayOf(a) }] }) },
  { id: "monthly", label: "Monthly", build: () => ({ freq: "monthly" }) },
  { id: "yearly", label: "Yearly", build: () => ({ freq: "yearly" }) },
];

/** Which preset (if any) a rule equals, for menu ticks. */
export function matchPreset(rec: Recurrence, anchorDate: string): string | undefined {
  const key = (r: Recurrence) => JSON.stringify(r);
  const target = key(rec);
  return RECURRENCE_PRESETS.find((p) => key(p.build(anchorDate)) === target)?.id;
}
