import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { pushTaskToGoogleCalendar } from "@/app/actions/calendarSync";

export const maxDuration = 60;

export async function POST() {
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

    let pushed = 0;
    let failed = 0;

    for (const task of unlinked) {
      try {
        const dateStr = task.dueDate || task.scheduledDate!;
        const dueTime = (task as Record<string, unknown>).dueTime as string | undefined || task.scheduledStartTime;
        let durationMinutes = 60;
        if (task.scheduledStartTime && task.scheduledEndTime) {
          const [sh, sm] = task.scheduledStartTime.split(":").map(Number);
          const [eh, em] = task.scheduledEndTime.split(":").map(Number);
          const dur = (eh * 60 + em) - (sh * 60 + sm);
          if (dur > 0) durationMinutes = dur;
        }

        const result = await pushTaskToGoogleCalendar({
          id: task._id,
          title: task.status === "done" ? `[Done] ${task.title}` : task.title,
          description: task.description,
          dueDate: dateStr,
          dueTime,
          durationMinutes,
        });

        if (result?.googleEventId) {
          await convex.mutation(api.tasks.update, {
            id: task._id as Id<"tasks">,
            googleEventId: result.googleEventId,
            googleCalendarId: result.googleCalendarId || "primary",
          });
          pushed++;
        }
      } catch (err) {
        console.warn(`Failed to push task "${task.title}":`, err);
        failed++;
      }
    }

    return Response.json({
      total: unlinked.length,
      pushed,
      failed,
      message: `Pushed ${pushed} task${pushed !== 1 ? "s" : ""} to Google Calendar${failed > 0 ? `, ${failed} failed` : ""}`,
    });
  } catch (err) {
    console.error("Push all error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
