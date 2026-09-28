"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  DatePickerPopover, TimePickerPopover, DurationPickerPopover, ProjectPickerPopover,
  PriorityPickerPopover, TaskChip, formatDuration, computeDuration,
} from "@/components/tasks/TaskPropertyPopovers";
import { TaskContextMenu } from "@/components/tasks/TaskContextMenu";
import { format, parseISO, isPast, isToday } from "date-fns";
import { isGoogleCalEvent } from "@/lib/task-utils";
import { syncTaskUpdateToGoogle, syncCompletionResultToGoogle } from "@/lib/google-sync";
import { normalizeRecurrence, shortRecurrenceLabel } from "@/convex/lib/recurrence";
import { RecurrencePopover } from "@/components/tasks/RecurrencePopover";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";
import { setDraggingTaskId } from "@/lib/drag-store";
import { startFocus, useFocusSession } from "@/lib/focus-store";
import { useSettings, formatClock } from "@/lib/settings";
import {
  IoCalendar,
  IoRepeat,
  IoTimer,
} from "react-icons/io5";

interface KanbanCardProps {
  task: Doc<"tasks">;
  isOverdue?: boolean;
  context?: "kanban" | "sidebar" | "project"; // sidebar = card in a list column, project = inside project board (no project chip)
  /**
   * A future occurrence of a repeating task, shown so a day that is already
   * spoken for does not look free. It is not a row: it cannot be completed,
   * dragged or edited, and its date and time come from the rule, not the task.
   */
  projection?: { date: string; start?: string; end?: string };
  /** The column already names the day, so the date chip would only repeat it. */
  hideDate?: boolean;
}

const KanbanCard = React.memo(function KanbanCard({ task, isOverdue, context = "kanban", projection, hideDate }: KanbanCardProps) {
  const isSidebar = context === "sidebar";
  const router = useRouter();
  const toggleCompleteMut = useMutation(api.tasks.toggleComplete);
  const updateTask = useMutation(api.tasks.update);

  // Toggle complete + sync to Google Calendar
  const toggleComplete = useCallback(async (args: { id: typeof task._id }) => {
    const wasDone = task.status === "done";
    const result = await toggleCompleteMut({ ...args, userDate: format(new Date(), "yyyy-MM-dd") });
    try { await syncCompletionResultToGoogle(task, result, wasDone); } catch (err) { console.warn("Google sync failed:", err); }
  }, [toggleCompleteMut, task]);

  // Update task + sync changes to Google Calendar (auto-pushes if task gets a date)
  const syncUpdateTask = useCallback(async (args: Parameters<typeof updateTask>[0]) => {
    await updateTask(args);
    try {
      const result = await syncTaskUpdateToGoogle(task, args as Record<string, unknown>);
      // If a new Google event was created (auto-push), store the IDs
      if (result) {
        await updateTask({ id: task._id, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
      }
    } catch (err) { console.warn("Google sync failed:", err); }
  }, [updateTask, task]);

  // TODO(perf): Every KanbanCard creates its own Convex subscription for projects.
  // With many cards this is redundant — consider lifting these queries to a parent
  // component and passing the data via props or context.
  const project = useQuery(
    api.projects.getById,
    task.projectId ? { id: task.projectId } : "skip"
  );
  const [isDragging, setIsDragging] = useState(false);

  const openDetail = useCallback(() => {
    router.push(`/task/${task._id}`);
  }, [router, task._id]);

  const isDone = task.status === "done";
  const isCalendarSource = isGoogleCalEvent(task);
  const calColor = (task as Record<string, unknown>).calendarColor as string | undefined;
  const dateStr = task.dueDate || task.scheduledDate;

  const { settings } = useSettings();
  const focusSession = useFocusSession();
  const focusingThis = focusSession?.taskId === task._id;
  const color = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.p4;
  const clock = settings.calendar.timeFormat;
  const fmtTime = (t: string) => formatClock(t, clock);
  let dateColor = "#a1a1aa";
  if (task.dueDate) {
    const d = parseISO(task.dueDate);
    const daysAway = Math.round((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
    if (isPast(d) && !isToday(d)) dateColor = "#f87171";
    else if (isToday(d) || daysAway <= settings.dueDates.indicatorWithinDays) dateColor = "#fb923c";
  }

  const durationMins = computeDuration(task.scheduledStartTime, task.scheduledEndTime);
  const duration = durationMins ? formatDuration(durationMins) : null;
  const recurrence = normalizeRecurrence(task.recurrence, dateStr);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task._id);
    e.dataTransfer.setData("application/task-status", task.status);
    e.dataTransfer.setData("application/source-date", dateStr || "");
    e.dataTransfer.effectAllowed = "move";
    setDraggingTaskId(task._id);
    setIsDragging(true);
  }, [task._id, dateStr]);

  const handleDragEnd = useCallback(() => {
    setDraggingTaskId(null);
    setIsDragging(false);
  }, []);

  // Determine if any chips should be shown (to render the second row)
  const hasDueTime = typeof (task as Record<string, unknown>).dueTime === "string";
  const effectiveTime = ((task as Record<string, unknown>).dueTime as string | undefined) || task.scheduledStartTime;
  const hasChips = !!(
    (isSidebar && duration) ||
    hasDueTime ||
    effectiveTime ||
    !isSidebar || // priority chip always shows in kanban
    project
  );

  // A projected occurrence previews a date the rule will claim. It is
  // deliberately inert: everything editable belongs to the one live task, so
  // this only shows the day it lands on, when, and why. Click opens the task.
  if (projection) {
    return (
      <div
        onClick={openDetail}
        title={recurrence ? `Repeats here: ${shortRecurrenceLabel(recurrence)}` : "Upcoming occurrence"}
        className="flex w-full cursor-pointer flex-col gap-1.5 rounded-[13px] border border-dashed border-line-strong px-3.5 py-2.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="mt-0.5 size-[16px] shrink-0 rounded-full"
            style={{ border: `2px solid ${color}` }}
          />
          <span
            className="min-w-0 flex-1 text-[13px] font-normal leading-[1.35] text-text-secondary"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {task.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-[26px]">
          {projection.start && (
            <TaskChip active>
              {fmtTime(projection.start)}
              {projection.end && ` to ${fmtTime(projection.end)}`}
            </TaskChip>
          )}
          {recurrence && (
            <TaskChip active>
              <span className="flex items-center gap-1 text-text-secondary">
                <IoRepeat size={11} />
                {shortRecurrenceLabel(recurrence)}
              </span>
            </TaskChip>
          )}
        </div>
      </div>
    );
  }

  return (
    <TaskContextMenu task={task}>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={openDetail}
        className={`group flex w-full cursor-grab flex-col gap-1.5 rounded-[13px] px-3.5 py-2.5 transition-colors active:cursor-grabbing active:translate-y-px ${
          isDragging ? "opacity-40" : ""
        } ${
          isOverdue
            ? "bg-rose-50 shadow-3d-sm hover:shadow-3d dark:bg-rose-950/25 dark:hover:bg-rose-950/35"
            : "bg-tile shadow-3d-sm hover:shadow-3d dark:hover:bg-tile-hover"
        }`}
      >
        {/* Row 1: Priority circle + Title */}
        <div className="flex min-w-0 items-start gap-2.5">
          {/* One circle for every task, always the priority colour: same
              geometry, same meaning, whether or not it came from a calendar.
              Which calendar it came from is a chip below, not this circle. */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleComplete({ id: task._id }); }}
            onContextMenu={(e) => e.stopPropagation()}
            className="mt-0.5 flex size-[16px] shrink-0 items-center justify-center rounded-full transition-colors"
            style={{
              border: `2px solid ${isDone ? "#93c5fd" : color}`,
              backgroundColor: isDone ? "#71717a" : "transparent",
            }}
          >
            {isDone && (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          {/* Title — max 2 lines, click to open detail */}
          <span
            className={`min-w-0 flex-1 cursor-pointer text-[13px] font-normal leading-[1.35] ${isDone ? "text-text-faint line-through decoration-text-faint" : "text-foreground"}`}
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {task.title}
          </span>
          {/* Start focus: appears on hover, or stays lit while this task is the one in focus */}
          {!isDone && (
            <button
              onClick={(e) => { e.stopPropagation(); if (focusingThis) return; startFocus({ taskId: task._id, taskTitle: task.title, lengths: { focus: settings.pomodoro.workMin, short: settings.pomodoro.shortBreakMin, long: settings.pomodoro.longBreakMin, rounds: settings.pomodoro.roundsBeforeLongBreak } }); }}
              onContextMenu={(e) => e.stopPropagation()}
              aria-label={focusingThis ? "In focus" : "Start focus"}
              title={focusingThis ? "In focus" : "Start focus"}
              className={`-my-1 -mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full transition-[opacity,background-color,color] ${focusingThis ? "bg-brand/10 text-brand opacity-100" : "text-text-faint opacity-0 hover:bg-black/[0.06] hover:text-text-strong group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/[0.08]"}`}
            >
              <IoTimer className="size-3.5" />
            </button>
          )}
        </div>

        {/* Row 2: Meta chips */}
        {hasChips && (
          <div className="flex flex-wrap items-center gap-1.5 pl-[26px]" draggable={false} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            {/* Priority chip, always shown: a task's priority is not worth
                hiding behind a hover, and a missing chip reads as no priority. */}
            <PriorityPickerPopover
              value={task.priority}
              onChange={(p) => syncUpdateTask({ id: task._id, priority: p })}
            >
              <TaskChip active>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-text-secondary">{PRIORITY_LABELS[task.priority]}</span>
                </span>
              </TaskChip>
            </PriorityPickerPopover>
            {/* Which calendar this came from, now that the circle shows priority */}
            {isCalendarSource && (
              <TaskChip active>
                <span className="flex items-center gap-1.5">
                  <IoCalendar size={11} style={{ color: calColor || "#059669" }} />
                  <span className="text-text-secondary">Calendar</span>
                </span>
              </TaskChip>
            )}
            {/* Sidebar: duration first */}
            {isSidebar && duration && (
              <DurationPickerPopover
                value={durationMins}
                onChange={(mins) => {
                  if (mins === undefined) {
                    syncUpdateTask({ id: task._id, clearScheduledStartTime: true, clearScheduledEndTime: true });
                  } else {
                    const start = task.scheduledStartTime || "09:00";
                    const [sh, sm] = start.split(":").map(Number);
                    const endMins = sh * 60 + sm + mins;
                    const eh = Math.floor(endMins / 60) % 24;
                    const em = endMins % 60;
                    syncUpdateTask({
                      id: task._id,
                      scheduledStartTime: start,
                      scheduledEndTime: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
                    });
                  }
                }}
              >
                <TaskChip active>{duration}</TaskChip>
              </DurationPickerPopover>
            )}
            {/* Sidebar: time with end time */}
            {isSidebar && effectiveTime && (
              <TimePickerPopover
                value={effectiveTime}
                onChange={(time) => syncUpdateTask({ id: task._id, ...(time ? { dueTime: time } : { clearDueTime: true }) })}
              >
                <TaskChip active>
                  {fmtTime(effectiveTime)}
                  {task.scheduledEndTime && ` to ${fmtTime(task.scheduledEndTime)}`}
                </TaskChip>
              </TimePickerPopover>
            )}
            {/* Kanban: start time only */}
            {!isSidebar && typeof (task as Record<string, unknown>).dueTime === "string" && (
              <TimePickerPopover
                value={(task as Record<string, unknown>).dueTime as string}
                onChange={(time) => syncUpdateTask({ id: task._id, ...(time ? { dueTime: time } : { clearDueTime: true }) })}
              >
                <TaskChip active>
                  {fmtTime((task as Record<string, unknown>).dueTime as string)}
                </TaskChip>
              </TimePickerPopover>
            )}
            {/* Date chip: kanban only, and not where the column is the day */}
            {!isSidebar && !hideDate && (
              <DatePickerPopover
                value={task.dueDate}
                onChange={(date) => syncUpdateTask({ id: task._id, ...(date ? { dueDate: date } : { clearDueDate: true, userDate: format(new Date(), "yyyy-MM-dd") }) })}
              >
                <TaskChip active={!!dateStr} className={dateStr ? "" : "opacity-0 group-hover:opacity-100"}>
                  <span style={dateStr ? { color: dateColor } : undefined}>
                    {dateStr ? format(parseISO(dateStr), "MMM d") : "Date"}
                  </span>
                </TaskChip>
              </DatePickerPopover>
            )}
            {/* Repeat chip — only when the task repeats */}
            {recurrence && dateStr && (
              <RecurrencePopover
                value={recurrence}
                anchorDate={dateStr}
                onChange={(rec) => syncUpdateTask({ id: task._id, ...(rec ? { recurrence: rec } : { clearRecurrence: true }) })}
              >
                <TaskChip active>
                  <span className="flex items-center gap-1 text-text-secondary">
                    <IoRepeat size={11} />
                    {shortRecurrenceLabel(recurrence)}
                  </span>
                </TaskChip>
              </RecurrencePopover>
            )}
            {/* Project chip — all views except project board */}
            {project && context !== "project" && (
              <ProjectPickerPopover
                value={task.projectId}
                onChange={(pid) => syncUpdateTask({ id: task._id, ...(pid ? { projectId: pid } : { clearProjectId: true }) })}
              >
                <TaskChip active>
                  <span className="max-w-[160px] truncate text-text-secondary">{project.name}</span>
                </TaskChip>
              </ProjectPickerPopover>
            )}
          </div>
        )}
      </div>
    </TaskContextMenu>
  );
});

export default KanbanCard;
