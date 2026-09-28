import { auth } from "@clerk/nextjs/server";
import { isGoogleNotConnected } from "@/lib/google-oauth";
import { getGoogleAccessToken } from "@/app/actions/google-auth";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  pushTaskToGoogleCalendar,
  updateGoogleEvent,
  deleteGoogleEvent,
} from "@/app/actions/calendarSync";

export const maxDuration = 60;

export async function POST() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const token = await getToken({ template: "convex" });
    if (!token) return Response.json({ error: "No Convex token" }, { status: 401 });

    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(token);

    // Nothing to do without a Google account; also avoids marking queue items failed.
    try { await getGoogleAccessToken(); } catch (err) {
      if (isGoogleNotConnected(err)) return Response.json({ error: "google_not_connected" }, { status: 409 });
      throw err;
    }

    // Fetch pending queue items
    const pending = await convex.query(api.syncQueue.getPending, { limit: 10 });
    if (pending.length === 0) {
      return Response.json({ processed: 0, message: "Nothing to sync" });
    }

    // Claim items for processing
    const ids = pending.map((item) => item._id);
    await convex.mutation(api.syncQueue.markProcessing, { ids });

    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        switch (item.action) {
          case "push": {
            // Fetch the current task from Convex
            const task = await convex.query(api.tasks.getById, {
              id: item.taskId,
            });
            if (!task) {
              // Task was deleted before we could push — just remove the queue entry
              await convex.mutation(api.syncQueue.markDone, { id: item._id });
              processed++;
              continue;
            }
            if (task.googleEventId) {
              // Already has a Google event — skip push, mark done
              await convex.mutation(api.syncQueue.markDone, { id: item._id });
              processed++;
              continue;
            }

            const dueTime = task.dueTime || task.scheduledStartTime;
            let durationMinutes = 60;
            if (task.scheduledStartTime && task.scheduledEndTime) {
              const [sh, sm] = task.scheduledStartTime.split(":").map(Number);
              const [eh, em] = task.scheduledEndTime.split(":").map(Number);
              const dur = (eh * 60 + em) - (sh * 60 + sm);
              if (dur > 0) durationMinutes = dur;
            }

            const result = await pushTaskToGoogleCalendar({
              id: task._id,
              title: task.status === "done" ? `${task.outcome === "missed" ? "[Missed]" : "[Done]"} ${task.title}` : task.title,
              description: task.description,
              dueDate: task.dueDate || task.scheduledDate || new Date().toISOString().slice(0, 10),
              dueTime,
              durationMinutes,
              // Server runs in UTC; use the task's own zone when it has one so
              // the event lands at the right wall-clock time.
              timeZone: ((item.payload as { timeZone?: string } | undefined)?.timeZone) || task.timeZone || undefined,
            });

            if (result?.googleEventId) {
              await convex.mutation(api.tasks.update, {
                id: task._id as Id<"tasks">,
                googleEventId: result.googleEventId,
                googleCalendarId: result.googleCalendarId || "primary",
              });
            }
            await convex.mutation(api.syncQueue.markDone, { id: item._id });
            processed++;
            break;
          }

          case "update": {
            const task = await convex.query(api.tasks.getById, {
              id: item.taskId,
            });
            if (!task || !task.googleEventId || task.googleRecurringEventId) {
              // No Google event to update, or a series master we never rewrite: mark done
              await convex.mutation(api.syncQueue.markDone, { id: item._id });
              processed++;
              continue;
            }

            const payload = (item.payload || {}) as Record<string, unknown>;
            // The server runs in UTC, so its own zone would shift the event.
            // Use the task's zone, as the push path already does.
            const tz = (payload.timeZone as string | undefined) || task.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            const gUpdates: Record<string, unknown> = {};

            // Build Google Calendar update from current task state
            if (payload.title || task.title) {
              const titlePrefix = task.status === "done" ? (task.outcome === "missed" ? "[Missed] " : "[Done] ") : "";
              const rawTitle = task.title.replace(/^\[(Done|Missed)\]\s*/, "");
              gUpdates.summary = titlePrefix + rawTitle;
            }
            if (task.description !== undefined) {
              gUpdates.description = task.description;
            }

            const date = task.dueDate || task.scheduledDate;
            const time = task.dueTime || task.scheduledStartTime;
            if (date && time) {
              const endTime = task.scheduledEndTime || (() => {
                const [h, m] = time.split(":").map(Number);
                return `${String(Math.floor((h * 60 + m + 60) / 60) % 24).padStart(2, "0")}:${String((h * 60 + m + 60) % 60).padStart(2, "0")}`;
              })();
              gUpdates.start = { dateTime: `${date}T${time}:00`, timeZone: tz };
              gUpdates.end = { dateTime: `${date}T${endTime}:00`, timeZone: tz };
            } else if (date) {
              const next = new Date(date + "T00:00:00");
              next.setDate(next.getDate() + 1);
              gUpdates.start = { date };
              gUpdates.end = { date: next.toISOString().slice(0, 10) };
            }

            if (Object.keys(gUpdates).length > 0) {
              await updateGoogleEvent(
                task.googleCalendarId || "primary",
                task.googleEventId,
                gUpdates,
              );
            }
            await convex.mutation(api.syncQueue.markDone, { id: item._id });
            processed++;
            break;
          }

          case "delete": {
            const payload = (item.payload || {}) as Record<string, unknown>;
            const googleEventId = payload.googleEventId as string | undefined;
            const googleCalendarId = (payload.googleCalendarId as string) || "primary";

            if (googleEventId) {
              try {
                await deleteGoogleEvent(googleCalendarId, googleEventId);
              } catch (err) {
                // 404 = already deleted on Google — that's fine
                if (err instanceof Error && err.message.includes("404")) {
                  // no-op
                } else {
                  throw err;
                }
              }
            }
            await convex.mutation(api.syncQueue.markDone, { id: item._id });
            processed++;
            break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[SyncQueue] Failed to process ${item.action} for task ${item.taskId}:`, message);

        // Handle specific error codes
        if (message.includes("401")) {
          // Auth expired — mark failed permanently (don't retry)
          await convex.mutation(api.syncQueue.markFailed, {
            id: item._id,
            errorMessage: "Google auth expired. Please re-authenticate.",
          });
        } else {
          await convex.mutation(api.syncQueue.markFailed, {
            id: item._id,
            errorMessage: message,
          });
        }
        failed++;
      }
    }

    return Response.json({
      processed,
      failed,
      total: pending.length,
      message: `Processed ${processed} sync items${failed > 0 ? `, ${failed} failed` : ""}`,
    });
  } catch (err) {
    if (isGoogleNotConnected(err)) return Response.json({ error: "google_not_connected" }, { status: 409 });
    console.error("[SyncQueue] Process error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
