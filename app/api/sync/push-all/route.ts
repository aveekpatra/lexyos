import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const maxDuration = 60;

/**
 * Enqueue all unlinked local tasks (have a date but no googleEventId) into the
 * sync queue, then trigger the queue processor to flush them to Google Calendar.
 */
export async function POST(req: Request) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const token = await getToken({ template: "convex" });
    if (!token) return Response.json({ error: "No Convex token" }, { status: 401 });

    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(token);

    // Get all tasks that have a date but no Google event
    const allTasks = await convex.query(api.tasks.list, {});
    const unlinked = allTasks.filter(
      (t) => !t.googleEventId && (t.dueDate || t.scheduledDate) && t.source !== "google_calendar"
    );

    let enqueued = 0;

    for (const task of unlinked) {
      try {
        await convex.mutation(api.syncQueue.enqueue, {
          taskId: task._id,
          action: "push",
        });
        enqueued++;
      } catch (err) {
        console.warn(`Failed to enqueue task "${task.title}":`, err);
      }
    }

    // Trigger queue processor to flush
    if (enqueued > 0) {
      try {
        const url = new URL("/api/sync/process-queue", req.url);
        fetch(url.toString(), {
          method: "POST",
          headers: { Cookie: req.headers.get("cookie") || "" },
        }).catch(() => {});
      } catch { /* ignore */ }
    }

    return Response.json({
      total: unlinked.length,
      enqueued,
      message: `Enqueued ${enqueued} task${enqueued !== 1 ? "s" : ""} for Google Calendar sync`,
    });
  } catch (err) {
    console.error("Push all error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
