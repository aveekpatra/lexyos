/**
 * Server-owned Google Calendar sync, worker side (queue side: lib/googleSync.ts).
 *
 * Every item is handled by one rule: make the Google event match the task as
 * it is now. That covers moves, edits and completions in one path:
 *   - done tasks carry a "[Done] " or "[Missed] " prefix, open ones none;
 *   - a repeating task keeps its event on the live row, so completing it
 *     moves the event to the next occurrence;
 *   - a task mirroring a Google series (googleRecurringEventId) is never
 *     written, because Google owns that rule;
 *   - a dated task with no event gets one; a deleted task loses its event.
 *
 * Google access comes from Clerk, which holds the refresh token from sign-in.
 * Needs CLERK_SECRET_KEY in this deployment's environment; without it items
 * stay pending and nothing is lost.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const GOOGLE = "https://www.googleapis.com/calendar/v3";
const DEFAULT_EVENT_MINUTES = 60;
const BATCH = 10;
const MAX_BATCHES = 5;

export const pendingFor = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("pendingSyncQueue")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .take(BATCH),
});

/** Claims pending items; returns the ones this run owns. */
export const claim = internalMutation({
  args: { ids: v.array(v.id("pendingSyncQueue")) },
  handler: async (ctx, { ids }) => {
    const owned: Id<"pendingSyncQueue">[] = [];
    const now = new Date().toISOString();
    for (const id of ids) {
      const item = await ctx.db.get("pendingSyncQueue", id);
      if (item?.status === "pending") {
        await ctx.db.patch("pendingSyncQueue", id, { status: "processing", lastAttemptAt: now });
        owned.push(id);
      }
    }
    return owned;
  },
});

export const task = internalQuery({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => await ctx.db.get("tasks", id),
});

export const finish = internalMutation({
  args: { id: v.id("pendingSyncQueue") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get("pendingSyncQueue", id)) await ctx.db.delete("pendingSyncQueue", id);
  },
});

export const fail = internalMutation({
  args: { id: v.id("pendingSyncQueue"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    const item = await ctx.db.get("pendingSyncQueue", id);
    if (!item) return;
    const retryCount = item.retryCount + 1;
    await ctx.db.patch("pendingSyncQueue", id, {
      retryCount,
      errorMessage: error.slice(0, 500),
      status: retryCount >= 5 ? "failed" : "pending",
      lastAttemptAt: new Date().toISOString(),
    });
  },
});

/** Puts claimed items back untouched (no Google access this run). */
export const release = internalMutation({
  args: { ids: v.array(v.id("pendingSyncQueue")) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) {
      const item = await ctx.db.get("pendingSyncQueue", id);
      if (item?.status === "processing") await ctx.db.patch("pendingSyncQueue", id, { status: "pending" });
    }
  },
});

/** Links a new event, written directly so it does not queue another sync. */
export const linkEvent = internalMutation({
  args: { id: v.id("tasks"), googleEventId: v.string(), googleCalendarId: v.string() },
  handler: async (ctx, { id, googleEventId, googleCalendarId }) => {
    const t = await ctx.db.get("tasks", id);
    if (!t) return;
    await ctx.db.patch("tasks", id, { googleEventId, googleCalendarId, lastSyncedAt: Date.now() });
  },
});

/** The event no longer exists on Google: forget it rather than retry forever. */
export const unlinkEvent = internalMutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const t = await ctx.db.get("tasks", id);
    if (t) await ctx.db.patch("tasks", id, { googleEventId: undefined, googleCalendarId: undefined });
  },
});

/** Named `run`: an export called `process` would shadow the global and hide process.env. */
export const run = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<void> => {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const pending: Doc<"pendingSyncQueue">[] = await ctx.runQuery(internal.googleSync.pendingFor, { userId });
      if (pending.length === 0) return;
      const owned: Id<"pendingSyncQueue">[] = await ctx.runMutation(internal.googleSync.claim, { ids: pending.map((p) => p._id) });
      if (owned.length === 0) return;

      const token = await googleToken(userId);
      if (!token) {
        await ctx.runMutation(internal.googleSync.release, { ids: owned });
        return;
      }

      for (const item of pending.filter((p) => owned.includes(p._id))) {
        try {
          await handle(ctx, token, item);
          await ctx.runMutation(internal.googleSync.finish, { id: item._id });
        } catch (err) {
          await ctx.runMutation(internal.googleSync.fail, {
            id: item._id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  },
});

async function handle(ctx: ActionCtx, token: string, item: Doc<"pendingSyncQueue">): Promise<void> {
  const payload = (item.payload ?? {}) as { timeZone?: string; googleEventId?: string; googleCalendarId?: string };
  const tz = payload.timeZone || "UTC";

  if (item.action === "delete") {
    if (!payload.googleEventId) return;
    const res = await google(token, "DELETE", eventPath(payload.googleCalendarId, payload.googleEventId));
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(await failure(res));
    return;
  }

  const t: Doc<"tasks"> | null = await ctx.runQuery(internal.googleSync.task, { id: item.taskId });
  if (!t || t.googleRecurringEventId) return;

  if (!t.googleEventId) {
    // Only local tasks with a date become events; imported ones already are one.
    if (t.source === "google_calendar" || !(t.dueDate || t.scheduledDate)) return;
    const calendarId = t.googleCalendarId || "primary";
    const res = await google(token, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, eventBody(t, tz));
    if (!res.ok) throw new Error(await failure(res));
    const created = (await res.json()) as { id: string };
    await ctx.runMutation(internal.googleSync.linkEvent, { id: t._id, googleEventId: created.id, googleCalendarId: calendarId });
    return;
  }

  const res = await google(token, "PATCH", eventPath(t.googleCalendarId, t.googleEventId), eventBody(t, tz));
  if (res.status === 404 || res.status === 410) {
    await ctx.runMutation(internal.googleSync.unlinkEvent, { id: t._id });
    return;
  }
  if (!res.ok) throw new Error(await failure(res));
}

/** The event as the task says it should be. Same shapes the web push uses. */
function eventBody(t: Doc<"tasks">, tz: string): Record<string, unknown> {
  const bare = t.title.replace(/^\[(Done|Missed)\]\s*/, "");
  const prefix = t.status === "done" ? (t.outcome === "missed" ? "[Missed] " : "[Done] ") : "";
  const body: Record<string, unknown> = { summary: prefix + bare };
  if (t.description !== undefined) body.description = t.description;

  const date = t.dueDate || t.scheduledDate;
  if (!date) return body;
  const start = t.scheduledStartTime || t.dueTime;
  if (start) {
    const minutes = duration(start, t.scheduledEndTime) ?? DEFAULT_EVENT_MINUTES;
    body.start = { dateTime: `${date}T${start}:00`, timeZone: tz };
    body.end = { dateTime: `${date}T${addMinutes(start, minutes)}:00`, timeZone: tz };
  } else {
    body.start = { date };
    body.end = { date: nextDay(date) };
  }
  return body;
}

function toMin(t: string | undefined): number | null {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function duration(start: string, end: string | undefined): number | null {
  const s = toMin(start), e = toMin(end);
  return s !== null && e !== null && e > s ? e - s : null;
}

/** start + minutes, clamped to 23:59 on the same day, as Convex and the grid do. */
function addMinutes(start: string, minutes: number): string {
  const e = Math.min(23 * 60 + 59, (toMin(start) ?? 0) + Math.max(1, minutes));
  return `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" + 1 day in UTC; Google's all-day end date is exclusive. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventPath(calendarId: string | undefined, eventId: string): string {
  return `/calendars/${encodeURIComponent(calendarId || "primary")}/events/${encodeURIComponent(eventId)}`;
}

async function google(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return await fetch(GOOGLE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function failure(res: Response): Promise<string> {
  return `Google Calendar ${res.status}: ${(await res.text()).slice(0, 300)}`;
}

/** Live Google access token from Clerk, or null when there is none to use. */
async function googleToken(userId: string): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.warn("[googleSync] CLERK_SECRET_KEY is not set; leaving items queued");
    return null;
  }
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/oauth_access_tokens/oauth_google`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    console.warn(`[googleSync] Clerk token lookup ${res.status}`);
    return null;
  }
  const tokens = (await res.json()) as { token?: string }[];
  return tokens[0]?.token ?? null;
}
