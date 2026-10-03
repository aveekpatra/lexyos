import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { sha256 } from "./lib/hash";

/*
 * Home-screen widgets (lexyos-mobile/src/widgets). They present the device's
 * widget token (convex/widgets.ts) and get back everything the four widgets
 * draw, or perform one tap. Work is done by the same functions the apps call,
 * as that user, through the agent identity (convex/lib/actor.ts).
 */

type Item = { id: string; title: string; number?: number; priority: string; start?: string; end?: string; event: boolean; color?: string };
type Task = {
  _id: string; title: string; number?: number; priority: string; status: string; source?: string; parentTaskId?: string;
  dueDate?: string; scheduledDate?: string; dueTime?: string; scheduledStartTime?: string; scheduledEndTime?: string;
  projectId?: string; calendarColor?: string; sortOrder: number; isAllDay?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function who(ctx: ActionCtx, req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token.length < 32) return null;
  const row = await ctx.runQuery(internal.widgets.resolve, { hash: await sha256(token) });
  if (!row) return null;
  // Note use at most hourly; a widget refresh should not be a write each time.
  if (Date.now() - row.lastUsedAt > 3_600_000) await ctx.runMutation(internal.widgets.touch, { id: row.id });
  const secret = process.env.AGENT_SECRET;
  if (!secret) throw new Error("AGENT_SECRET is not set");
  return { userId: row.userId, agent: { secret, userId: row.userId } };
}

/** "YYYY-MM-DD" and minutes since midnight, in the phone's time zone. */
function clockIn(tz: string, at = Date.now()) {
  let zone = tz;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); } catch { zone = "UTC"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), zone };
}

const dayOf = (t: Task) => t.dueDate ?? t.scheduledDate;
const startOf = (t: Task) => t.scheduledStartTime ?? t.dueTime;
const mins = (hhmm?: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const http = httpRouter();

http.route({
  path: "/widget/summary",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const user = await who(ctx, req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { day: today, minutes: nowMin, zone } = clockIn(new URL(req.url).searchParams.get("tz") ?? "UTC");
    const agent = user.agent;

    const [open, doneToday, projects, prefsDoc] = await Promise.all([
      ctx.runQuery(api.tasks.listOpen, { agent }) as Promise<Task[]>,
      ctx.runQuery(api.tasks.doneOnDay, { agent, day: today }) as Promise<Task[]>,
      ctx.runQuery(api.projects.list, { agent }) as Promise<Array<{ _id: string; color: string }>>,
      ctx.runQuery(api.userPreferences.get, { agent }) as Promise<{ prefs?: Record<string, any> } | null>,
    ]);
    const color = new Map(projects.map((p) => [p._id, p.color]));
    const item = (t: Task): Item => ({
      id: t._id, title: t.title, number: t.number, priority: t.priority, start: startOf(t), end: t.scheduledEndTime,
      event: t.source === "google_calendar", color: t.source === "google_calendar" ? t.calendarColor : t.projectId ? color.get(t.projectId) : undefined,
    });

    // Today: what the app's day view lists, timed first.
    const todays = open.filter((t) => !t.parentTaskId && dayOf(t) === today)
      .sort((a, b) => (mins(startOf(a)) ?? 1e9) - (mins(startOf(b)) ?? 1e9) || a.sortOrder - b.sortOrder);
    const overdue = open.filter((t) => !t.parentTaskId && t.source !== "google_calendar" && (dayOf(t) ?? "9") < today).length;

    // Up next: what is on now, and what comes after, among today's timed items.
    const timed = todays.filter((t) => !t.isAllDay && mins(startOf(t)) !== null).map((t) => {
      const s = mins(startOf(t))!;
      const e = Math.max(mins(t.scheduledEndTime) ?? s + 30, s + 1);
      return { t, s, e };
    });
    const current = timed.find((x) => x.s <= nowMin && nowMin < x.e);
    const next = timed.filter((x) => x.s > nowMin).sort((a, b) => a.s - b.s)[0];

    // Heatmap: 20 weeks ending this week, Monday first.
    const weeks = 20;
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const first = addDays(today, -(weeks - 1) * 7 - weekday);
    const since = Date.now() - (weeks * 7 + 2) * 86_400_000;
    const stamps = await ctx.runQuery(internal.widgets.completions, { userId: user.userId, since });
    const counts = new Map<string, number>();
    for (const at of stamps) { const d = clockIn(zone, at).day; counts.set(d, (counts.get(d) ?? 0) + 1); }
    const days: number[] = [];
    for (let d = first; d <= today; d = addDays(d, 1)) days.push(counts.get(d) ?? 0);
    let streak = 0;
    for (let i = days.length - 1 - (days[days.length - 1] ? 0 : 1); i >= 0 && days[i] > 0; i--) streak++;
    let best = 0, run = 0;
    for (const c of days) { run = c > 0 ? run + 1 : 0; best = Math.max(best, run); }

    return json({
      at: Date.now(), today, nowMin,
      todayList: { items: todays.slice(0, 8).map(item), open: todays.length, done: doneToday.filter((t) => !t.parentTaskId).length, overdue },
      upNext: { current: current ? item(current.t) : null, next: next ? item(next.t) : null, nextInMin: next ? next.s - nowMin : null, currentLeftMin: current ? current.e - nowMin : null },
      heatmap: { first, days, streak, best, total: days.reduce((a, b) => a + b, 0) },
      focus: prefsDoc?.prefs?.ui?.focusSession ?? null,
      nextFocusable: todays.find((t) => t.source !== "google_calendar") ? item(todays.find((t) => t.source !== "google_calendar")!) : null,
    });
  }),
});

http.route({
  path: "/widget/action",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const user = await who(ctx, req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = (await req.json()) as { type: string; id?: string; tz?: string };
    const { day: today, zone } = clockIn(body.tz ?? "UTC");
    const agent = user.agent;
    const setFocus = (s: unknown) => ctx.runMutation(api.userPreferences.update, { agent, prefs: { ui: { focusSession: s } } });
    const prefs = ((await ctx.runQuery(api.userPreferences.get, { agent })) as { prefs?: Record<string, any> } | null)?.prefs ?? {};
    const session = prefs.ui?.focusSession as
      | { phase: string; endsAt: number; remainingMs: number; running: boolean; round: number; lengths: { focus: number; short: number; long: number; rounds: number } }
      | undefined;
    const now = Date.now();

    switch (body.type) {
      case "complete": {
        if (!body.id) return json({ error: "id required" }, 400);
        await ctx.runMutation(api.tasks.toggleComplete, { agent, id: body.id as never, userDate: today, syncTimeZone: zone });
        break;
      }
      case "focus-start": {
        if (!body.id) return json({ error: "id required" }, 400);
        const task = (await ctx.runQuery(api.tasks.getById, { agent, id: body.id as never })) as Task | null;
        if (!task) return json({ error: "not found" }, 404);
        const p = prefs.pomodoro ?? {};
        const lengths = { focus: Number(p.workMin) || 25, short: Number(p.shortBreakMin) || 5, long: Number(p.longBreakMin) || 15, rounds: Number(p.roundsBeforeLongBreak) || 4 };
        const ms = lengths.focus * 60_000;
        await setFocus({ taskId: task._id, taskTitle: task.title, phase: "focus", endsAt: now + ms, remainingMs: ms, running: true, round: 1, lengths });
        break;
      }
      case "focus-pause":
        if (session?.running) await setFocus({ ...session, running: false, remainingMs: Math.max(0, session.endsAt - now) });
        break;
      case "focus-resume":
        if (session && !session.running) await setFocus({ ...session, running: true, endsAt: now + session.remainingMs });
        break;
      case "focus-next":
        if (session) {
          const rounds = Math.max(1, Math.round(session.lengths.rounds));
          const phase = session.phase === "focus" ? (session.round % rounds === 0 ? "long" : "short") : "focus";
          const round = session.phase === "focus" ? session.round : session.round + 1;
          const ms = session.lengths[phase as "focus" | "short" | "long"] * 60_000;
          await setFocus({ ...session, phase, round, running: true, endsAt: now + ms, remainingMs: ms });
        }
        break;
      case "focus-stop":
        await setFocus(null);
        break;
      default:
        return json({ error: "unknown action" }, 400);
    }
    return json({ ok: true });
  }),
});

export default http;
