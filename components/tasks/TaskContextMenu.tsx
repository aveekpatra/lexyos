"use client";

/**
 * Unified right-click context menu for tasks/events.
 * Used by KanbanCard, sidebar items, and month view.
 * Wraps children with ContextMenu + provides all task actions.
 */

import React, { useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup } from "@/components/ui/context-menu";
import {
  MenuItem, MenuSub, MenuSubTrigger, MenuSubPopup, MenuSeparator,
} from "@/components/ui/menu";
import { format, addDays, startOfWeek, endOfWeek, addWeeks, endOfMonth } from "date-fns";
import { syncTaskUpdateToGoogle, syncCompletionResultToGoogle, syncTaskDeletionToGoogle } from "@/lib/google-sync";
import { RECURRENCE_PRESETS, normalizeRecurrence, matchPreset, shortRecurrenceLabel } from "@/convex/lib/recurrence";
import { startFocus } from "@/lib/focus-store";
import { useSettings } from "@/lib/settings";
import { useRouter } from "next/navigation";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";
import {
  IoCalendar,
  IoCheckmark,
  IoCreate,
  IoFolder,
  IoRepeat,
  IoTrash,
  IoTimer,
} from "react-icons/io5";
import { Folder } from "@/components/ui/folder";

const itemClass = "";
const subPopupClass = "w-[220px]";

export function TaskContextMenu({ task, children, className, style }: {
  task: Doc<"tasks">;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const updateTask = useMutation(api.tasks.update);
  const toggleCompleteMut = useMutation(api.tasks.toggleComplete);
  const removeTaskMut = useMutation(api.tasks.remove);
  const projects = useQuery(api.projects.list, { status: "active" });
  const router = useRouter();
  const { settings } = useSettings();

  const syncUpdate = useCallback(async (args: Parameters<typeof updateTask>[0]) => {
    await updateTask(args);
    try {
      const result = await syncTaskUpdateToGoogle(task, args as Record<string, unknown>);
      if (result) {
        await updateTask({ id: task._id, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
      }
    } catch (err) { console.warn("Google sync failed:", err); }
  }, [updateTask, task]);

  const toggleComplete = useCallback(async () => {
    const wasDone = task.status === "done";
    const result = await toggleCompleteMut({ id: task._id, userDate: format(new Date(), "yyyy-MM-dd") });
    try { await syncCompletionResultToGoogle(task, result, wasDone); } catch (err) { console.warn("Google sync failed:", err); }
  }, [toggleCompleteMut, task]);

  const removeTask = useCallback(async () => {
    await removeTaskMut({ id: task._id });
    try { await syncTaskDeletionToGoogle(task); } catch (err) { console.warn("Google sync failed:", err); }
  }, [removeTaskMut, task]);

  const isDone = task.status === "done";
  const color = PRIORITY_COLORS[task.priority] || "#a1a1aa";
  const now = new Date();
  const anchorDate = task.dueDate || task.scheduledDate || format(now, "yyyy-MM-dd");
  const recurrence = normalizeRecurrence(task.recurrence, anchorDate);
  const activePreset = recurrence ? matchPreset(recurrence, anchorDate) : undefined;

  const datePresets = [
    { label: "Today", date: format(now, "yyyy-MM-dd") },
    { label: "Tomorrow", date: format(addDays(now, 1), "yyyy-MM-dd") },
    { label: "This week", date: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd") },
    { label: "Next week", date: format(addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1), "yyyy-MM-dd") },
    { label: "This month", date: format(endOfMonth(now), "yyyy-MM-dd") },
  ];

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className={className} style={style}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuPopup className="w-[220px]">
          {/* Open detail */}
          <MenuItem onClick={() => router.push(`/task/${task._id}`)} className={itemClass}>
            <span className="flex items-center gap-2.5">
              <IoCreate size={14} className="text-text-muted" />
              Edit
            </span>
          </MenuItem>

          <MenuSeparator />

          {/* Priority submenu */}
          <MenuSub>
            <MenuSubTrigger className={itemClass}>
              <span className="flex items-center gap-2.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                Priority
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className={subPopupClass}>
              {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                <MenuItem
                  key={p}
                  onClick={() => syncUpdate({ id: task._id, priority: p })}
                  className={`${itemClass} ${task.priority === p ? "!text-brand-strong" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                    {PRIORITY_LABELS[p]}
                  </span>
                  {task.priority === p && <IoCheckmark className="ml-auto size-3.5 !text-brand-strong" />}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>

          {/* Date submenu */}
          <MenuSub>
            <MenuSubTrigger className={itemClass}>
              <span className="flex items-center gap-2.5">
                <IoCalendar size={14} className="text-text-muted" />
                {task.dueDate ? format(new Date(task.dueDate + "T00:00:00"), "MMM d") : "Date"}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className={subPopupClass}>
              {datePresets.map((d) => (
                <MenuItem
                  key={d.label}
                  onClick={() => syncUpdate({ id: task._id, dueDate: d.date })}
                  className={`${itemClass} ${task.dueDate === d.date ? "!text-brand-strong" : ""}`}
                >
                  {d.label}
                  {task.dueDate === d.date && <IoCheckmark className="ml-auto size-3.5 !text-brand-strong" />}
                </MenuItem>
              ))}
              {task.dueDate && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    onClick={() => syncUpdate({ id: task._id, clearDueDate: true } as Parameters<typeof updateTask>[0])}
                    className={`${itemClass} text-[#ef4444]`}
                  >
                    Remove date
                  </MenuItem>
                </>
              )}
            </MenuSubPopup>
          </MenuSub>

          {/* Project submenu */}
          <MenuSub>
            <MenuSubTrigger className={itemClass}>
              <span className="flex items-center gap-2.5">
                <IoFolder size={14} className="text-text-muted" />
                Project
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className={subPopupClass}>
              <MenuItem
                onClick={() => syncUpdate({ id: task._id, clearProjectId: true } as Parameters<typeof updateTask>[0])}
                className={`${itemClass} ${!task.projectId ? "!text-brand-strong" : ""}`}
              >
                No project
                {!task.projectId && <IoCheckmark className="ml-auto size-3.5 !text-brand-strong" />}
              </MenuItem>
              {projects?.map((p) => (
                <MenuItem
                  key={p._id}
                  onClick={() => syncUpdate({ id: task._id, projectId: p._id })}
                  className={`${itemClass} ${task.projectId === p._id ? "!text-brand-strong" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <Folder className="size-4" style={{ color: p.color }} />
                    {p.name}
                  </span>
                  {task.projectId === p._id && <IoCheckmark className="ml-auto size-3.5 !text-brand-strong" />}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>

          <MenuItem
              onClick={() => startFocus({ taskId: task._id, taskTitle: task.title, lengths: { focus: settings.pomodoro.workMin, short: settings.pomodoro.shortBreakMin, long: settings.pomodoro.longBreakMin, rounds: settings.pomodoro.roundsBeforeLongBreak } })}
              className={itemClass}
            >
              <span className="flex items-center gap-2.5">
                <IoTimer size={14} className="text-text-muted" />
                Start focus
              </span>
            </MenuItem>

          {/* Repeat submenu: presets only; the task page holds the custom editor */}
          <MenuSub>
            <MenuSubTrigger className={itemClass}>
              <span className="flex items-center gap-2.5">
                <IoRepeat size={14} className="text-text-muted" />
                {recurrence ? shortRecurrenceLabel(recurrence) : "Repeat"}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className={subPopupClass}>
              {RECURRENCE_PRESETS.map((p) => (
                <MenuItem
                  key={p.id}
                  onClick={() => syncUpdate({ id: task._id, recurrence: p.build(anchorDate) })}
                  className={`${itemClass} ${activePreset === p.id ? "!text-brand-strong" : ""}`}
                >
                  {p.label}
                  {activePreset === p.id && <IoCheckmark className="ml-auto size-3.5 !text-brand-strong" />}
                </MenuItem>
              ))}
              <MenuItem onClick={() => router.push(`/task/${task._id}`)} className={itemClass}>
                Custom...
              </MenuItem>
              {recurrence && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    onClick={() => syncUpdate({ id: task._id, clearRecurrence: true } as Parameters<typeof updateTask>[0])}
                    className={`${itemClass} text-[#ef4444]`}
                  >
                    Stop repeating
                  </MenuItem>
                </>
              )}
            </MenuSubPopup>
          </MenuSub>

          <MenuSeparator />

          {/* Mark done */}
          <MenuItem onClick={toggleComplete} className={itemClass}>
            <span className="flex items-center gap-2.5">
              <IoCheckmark size={14} className="text-text-muted" />
              {isDone ? "Mark undone" : "Mark done"}
            </span>
          </MenuItem>

          {/* Delete */}
          <MenuItem onClick={removeTask} className={`${itemClass} text-[#ef4444]`}>
            <span className="flex items-center gap-2.5">
              <IoTrash size={14} />
              Delete
            </span>
          </MenuItem>
        </ContextMenuPopup>
      </ContextMenu>
    </>
  );
}
