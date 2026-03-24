"use client";

import React, { useState, useCallback } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@/components/ui/menu";
import {
  DatePickerPopover, TimePickerPopover, DurationPickerPopover, ProjectPickerPopover,
  TaskChip, formatDuration, formatTime12, computeDuration,
} from "@/components/tasks/TaskPropertyPopovers";
import { TaskContextMenu } from "@/components/tasks/TaskContextMenu";

import {
  Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashedLineCircleIcon,
} from "@hugeicons/core-free-icons";
import { format, parseISO, isPast, isToday } from "date-fns";
import { isGoogleCalEvent } from "@/lib/task-utils";
import { syncTaskUpdateToGoogle, syncTaskCompletionToGoogle } from "@/lib/google-sync";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";

interface KanbanCardProps {
  task: Doc<"tasks">;
  isOverdue?: boolean;
  context?: "kanban" | "sidebar" | "project"; // sidebar = planner sidebar, project = inside project board (no project chip)
}

const KanbanCard = React.memo(function KanbanCard({ task, isOverdue, context = "kanban" }: KanbanCardProps) {
  const isSidebar = context === "sidebar";
  const toggleCompleteMut = useMutation(api.tasks.toggleComplete);
  const updateTask = useMutation(api.tasks.update);

  // Toggle complete + sync to Google Calendar
  const toggleComplete = useCallback(async (args: { id: typeof task._id }) => {
    const wasDone = task.status === "done";
    await toggleCompleteMut(args);
    try { await syncTaskCompletionToGoogle(task, !wasDone); } catch (err) { console.warn("Google sync failed:", err); }
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
  const [editOpen, setEditOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const isDone = task.status === "done";
  const isCalendarSource = isGoogleCalEvent(task);
  const calColor = (task as Record<string, unknown>).calendarColor as string | undefined;
  const color = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.p4;
  const dateStr = task.dueDate || task.scheduledDate;

  let dateColor = "#a1a1aa";
  if (task.dueDate) {
    const d = parseISO(task.dueDate);
    if (isPast(d) && !isToday(d)) dateColor = "#f87171";
    else if (isToday(d)) dateColor = "#fb923c";
  }

  const durationMins = computeDuration(task.scheduledStartTime, task.scheduledEndTime);
  const duration = durationMins ? formatDuration(durationMins) : null;

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task._id);
    e.dataTransfer.setData("application/source-date", dateStr || "");
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  }, [task._id, dateStr]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Determine if any chips should be shown (to render the second row)
  const hasDueTime = typeof (task as Record<string, unknown>).dueTime === "string";
  const hasChips = !!(
    (isSidebar && duration) ||
    hasDueTime ||
    !isSidebar || // date chip always shows in kanban
    project
  );

  return (
    <TaskContextMenu task={task}>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={`group flex w-full cursor-grab flex-col gap-1.5 rounded-[10px] px-3.5 py-2.5 transition-all active:cursor-grabbing ${
          isDragging ? "opacity-40" : ""
        } ${
          isOverdue
            ? "border border-[#4a2040] bg-[#1e1020] shadow-[0_2px_0_0_rgba(60,20,40,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:bg-[#281428]"
            : "border border-[#333340] bg-[#1a1a22] shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:bg-[#222230]"
        }`}
      >
        {/* Row 1: Priority circle + Title */}
        <div className="flex min-w-0 items-start gap-2.5">
          {/* Priority circle or calendar icon */}
          {isCalendarSource ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleComplete({ id: task._id }); }}
              onContextMenu={(e) => e.stopPropagation()}
              className="mt-0.5 flex shrink-0 items-center justify-center"
            >
              <HugeiconsIcon icon={DashedLineCircleIcon} size={16} style={{ color: isDone ? "#71717a" : calColor || "#059669" }} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); toggleComplete({ id: task._id }); }}
              onContextMenu={(e) => e.stopPropagation()}
              className="mt-0.5 flex size-[16px] shrink-0 items-center justify-center rounded-full transition-colors"
              style={{
                border: `2px solid ${isDone ? "#71717a" : color}`,
                backgroundColor: isDone ? "#71717a" : "transparent",
              }}
            >
              {isDone && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="#1a1a22" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}

          {/* Title — max 2 lines, click to edit */}
          <span
            onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
            className={`min-w-0 flex-1 cursor-pointer text-sm font-medium leading-snug ${isDone ? "text-[#71717a] line-through" : "text-white"}`}
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {task.title}
          </span>
        </div>

        {/* Row 2: Meta chips */}
        {hasChips && (
          <div className="flex flex-wrap items-center gap-1.5 pl-[26px]" draggable={false} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
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
            {isSidebar && typeof (task as Record<string, unknown>).dueTime === "string" && (
              <TimePickerPopover
                value={(task as Record<string, unknown>).dueTime as string}
                onChange={(time) => syncUpdateTask({ id: task._id, ...(time ? { dueTime: time } : { clearDueTime: true }) })}
              >
                <TaskChip active>
                  {formatTime12((task as Record<string, unknown>).dueTime as string)}
                  {task.scheduledEndTime && ` – ${formatTime12(task.scheduledEndTime)}`}
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
                  {formatTime12((task as Record<string, unknown>).dueTime as string)}
                </TaskChip>
              </TimePickerPopover>
            )}
            {/* Date chip — only in kanban view */}
            {!isSidebar && (
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
            {/* Project chip — all views except project board */}
            {project && context !== "project" && (
              <ProjectPickerPopover
                value={task.projectId}
                onChange={(pid) => syncUpdateTask({ id: task._id, ...(pid ? { projectId: pid } : { clearProjectId: true }) })}
              >
                <TaskChip active>
                  <span style={{ color: project.color }} className="max-w-[160px] truncate">{project.name}</span>
                </TaskChip>
              </ProjectPickerPopover>
            )}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <TaskEditDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
    </TaskContextMenu>
  );
});

export default KanbanCard;


/* ─── Unified Task Dialog (create + edit) ─── */
const RECURRENCE_OPTIONS = [
  { value: "", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export function TaskEditDialog({ task, open, onOpenChange, defaultDueDate }: {
  task?: Doc<"tasks"> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultDueDate?: string;
}) {
  const createTask = useMutation(api.tasks.create);
  const updateTaskMut = useMutation(api.tasks.update);
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const projects = useQuery(api.projects.list, { status: "active" });

  // Update task + sync to Google Calendar (uses centralized utility)
  const syncUpdateTask = useCallback(async (args: Parameters<typeof updateTaskMut>[0]) => {
    await updateTaskMut(args);
    if (task) {
      try {
        const result = await syncTaskUpdateToGoogle(task, args as Record<string, unknown>);
        if (result) {
          await updateTaskMut({ id: task._id, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
        }
      } catch (err) { console.warn("Google sync failed:", err); }
    }
  }, [updateTaskMut, task]);

  const isCreate = !task;

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"p1" | "p2" | "p3" | "p4">("p3");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [projectId, setProjectId] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [saving, setSaving] = useState(false);

  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.p4;
  const durationMinutes = computeDuration(startTime, endTime);
  const duration = durationMinutes ? formatDuration(durationMinutes) : null;
  const selectedProject = projects?.find((p) => p._id === projectId);
  const isDone = task?.status === "done";
  const recLabel = RECURRENCE_OPTIONS.find((r) => r.value === recurrence)?.label || "Repeat";

  // Sync state when dialog opens
  React.useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setNotes(task.description || "");
      setPriority(task.priority);
      setDueDate(task.dueDate || "");
      setDueTime((task as Record<string, unknown>).dueTime as string || "");
      setStartTime(task.scheduledStartTime || "");
      setEndTime(task.scheduledEndTime || "");
      setProjectId(task.projectId || "");
      setRecurrence((task as Record<string, unknown>).recurrence as string || "");
    } else {
      setTitle("");
      setNotes("");
      setPriority("p3");
      setDueDate(defaultDueDate || "");
      setDueTime("");
      setStartTime("");
      setEndTime("");
      setProjectId("");
      setRecurrence("");
    }
  }, [open, task, defaultDueDate]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (isCreate) {
        const newTaskId = await createTask({
          title: title.trim(),
          description: notes || undefined,
          priority,
          dueDate: dueDate || undefined,
          dueTime: dueTime || undefined,
          scheduledStartTime: startTime || undefined,
          scheduledEndTime: endTime || undefined,
          projectId: projectId ? (projectId as Id<"projects">) : undefined,
          recurrence: recurrence || undefined,
          userDate: format(new Date(), "yyyy-MM-dd"),
        });
        // Auto-push to Google Calendar if the task has a date
        if (dueDate && newTaskId) {
          try {
            const { pushLocalTaskToGoogle } = await import("@/lib/google-sync");
            const fakeTask = {
              _id: newTaskId, title: title.trim(), description: notes || undefined,
              dueDate, dueTime: dueTime || undefined, scheduledStartTime: startTime || undefined,
              scheduledEndTime: endTime || undefined,
            } as Doc<"tasks">;
            const result = await pushLocalTaskToGoogle(fakeTask);
            if (result) {
              await updateTaskMut({ id: newTaskId, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
            }
          } catch (err) { console.warn("Auto-push failed:", err); }
        }
      } else {
        await syncUpdateTask({
          id: task._id,
          title: title.trim(),
          priority,
          ...(notes ? { description: notes } : { clearDescription: true }),
          ...(dueDate ? { dueDate } : { clearDueDate: true, userDate: format(new Date(), "yyyy-MM-dd") }),
          ...(dueTime ? { dueTime } : { clearDueTime: true }),
          ...(startTime ? { scheduledStartTime: startTime } : { clearScheduledStartTime: true }),
          ...(endTime ? { scheduledEndTime: endTime } : { clearScheduledEndTime: true }),
          ...(projectId ? { projectId: projectId as Id<"projects"> } : { clearProjectId: true }),
          ...(recurrence ? { recurrence } : { clearRecurrence: true }),
        });
      }

      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const chipClass = "inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
  const chipEmptyClass = "inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="sr-only">{isCreate ? "New Task" : "Edit Task"}</DialogTitle>
        </DialogHeader>

        <DialogPanel>
          <div className="flex flex-col gap-4">
            {/* Chip bar */}
            <div className="flex flex-wrap items-center gap-2">
              <DatePickerPopover value={dueDate || undefined} onChange={(d) => setDueDate(d || "")}>
                <span className={dueDate ? chipClass : chipEmptyClass}>
                  {dueDate ? format(parseISO(dueDate), "MMM d, yyyy") : "Date"}
                </span>
              </DatePickerPopover>
              <TimePickerPopover value={dueTime || undefined} onChange={(t) => setDueTime(t || "")}>
                <span className={dueTime ? chipClass : chipEmptyClass}>
                  {dueTime ? formatTime12(dueTime) : "Time"}
                </span>
              </TimePickerPopover>
              {duration && <span className={chipClass}>{duration}</span>}

              {/* Priority */}
              <Menu>
                <MenuTrigger render={<button className={chipClass} style={{ borderColor: color + "30" }} />}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                  <span style={{ color }}>{PRIORITY_LABELS[priority]}</span>
                </MenuTrigger>
                <MenuPopup>
                  {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                    <MenuItem key={p} onClick={() => setPriority(p)}>
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                      {PRIORITY_LABELS[p]}
                      {priority === p && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>

              {/* Recurrence */}
              <Menu>
                <MenuTrigger render={<button className={recurrence ? chipClass : chipEmptyClass} />}>
                  {recurrence ? recLabel : "Repeat"}
                </MenuTrigger>
                <MenuPopup>
                  {RECURRENCE_OPTIONS.map((r) => (
                    <MenuItem key={r.value} onClick={() => setRecurrence(r.value)}>
                      {r.label}
                      {recurrence === r.value && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>

            {/* Title with checkbox */}
            <div className="flex items-start gap-3">
              {!isCreate && (
                <button
                  onClick={async () => {
                    const wasDone = task?.status === "done";
                    await toggleComplete({ id: task!._id });
                    if (task) {
                      try { await syncTaskCompletionToGoogle(task, !wasDone); } catch (err) { console.warn("Google sync failed:", err); }
                    }
                  }}
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    border: `2px solid ${isDone ? "var(--muted-foreground)" : color}`,
                    backgroundColor: isDone ? "var(--muted-foreground)" : "transparent",
                  }}
                >
                  {isDone && (
                    <svg width="10" height="10" viewBox="0 0 8 8" fill="none">
                      <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="var(--popover)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); } }}
                placeholder="Task name"
                autoFocus
                className="flex-1 bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            {/* Description */}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Description"
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />

            {/* Schedule */}
            <div className="flex items-center gap-2">
              <TimePickerPopover value={startTime || undefined} onChange={(t) => setStartTime(t || "")}>
                <button className={startTime ? chipClass : chipEmptyClass}>
                  {startTime ? formatTime12(startTime) : "Start"}
                </button>
              </TimePickerPopover>
              {startTime && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <TimePickerPopover value={endTime || undefined} onChange={(t) => setEndTime(t || "")}>
                    <button className={endTime ? chipClass : chipEmptyClass}>
                      {endTime ? formatTime12(endTime) : "End"}
                    </button>
                  </TimePickerPopover>
                </>
              )}
            </div>

            {/* Project */}
            <div className="flex items-center gap-2">
              <ProjectPickerPopover
                value={projectId ? (projectId as Id<"projects">) : undefined}
                onChange={(pid) => setProjectId(pid || "")}
              >
                {selectedProject ? (
                  <button className={chipClass}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: selectedProject.color }} />
                    {selectedProject.name}
                  </button>
                ) : (
                  <button className={chipEmptyClass}>Project</button>
                )}
              </ProjectPickerPopover>
            </div>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim() || saving} loading={saving}>
            {isCreate ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

