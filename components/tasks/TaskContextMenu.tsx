"use client";

/**
 * Unified right-click context menu for tasks/events.
 * Used by KanbanCard, ResizableTaskBlock, sidebar items, month view cells.
 * Wraps children with ContextMenu + provides all task actions.
 */

import React, { useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup } from "@/components/ui/context-menu";
import {
  MenuItem, MenuSub, MenuSubTrigger, MenuSubPopup, MenuSeparator,
} from "@/components/ui/menu";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Edit01Icon, Delete01Icon, Tick01Icon,
  Calendar03Icon, Folder01Icon,
} from "@hugeicons/core-free-icons";
import { format, addDays, startOfWeek, endOfWeek, addWeeks, endOfMonth } from "date-fns";
import { syncTaskUpdateToGoogle, syncTaskCompletionToGoogle, syncTaskDeletionToGoogle } from "@/lib/google-sync";
import { TaskEditDialog } from "@/components/kanban/KanbanCard";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";

const itemClass = "rounded-lg px-3 py-2 text-sm text-text-strong hover:bg-line";
const subPopupClass = "w-[220px] rounded-xl border border-line-strong bg-surface-0 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]";

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
  const [editOpen, setEditOpen] = useState(false);

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
    await toggleCompleteMut({ id: task._id });
    try { await syncTaskCompletionToGoogle(task, !wasDone); } catch (err) { console.warn("Google sync failed:", err); }
  }, [toggleCompleteMut, task]);

  const removeTask = useCallback(async () => {
    await removeTaskMut({ id: task._id });
    try { await syncTaskDeletionToGoogle(task); } catch (err) { console.warn("Google sync failed:", err); }
  }, [removeTaskMut, task]);

  const isDone = task.status === "done";
  const color = PRIORITY_COLORS[task.priority] || "#a1a1aa";
  const now = new Date();

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
        <ContextMenuPopup className="w-[220px] rounded-xl border border-line-strong bg-surface-0 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {/* Edit */}
          <MenuItem onClick={() => setEditOpen(true)} className={itemClass}>
            <span className="flex items-center gap-2.5">
              <HugeiconsIcon icon={Edit01Icon} size={14} className="text-text-muted" />
              Edit
            </span>
          </MenuItem>

          <MenuSeparator className="my-1 border-line" />

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
                  className={`${itemClass} ${task.priority === p ? "bg-brand-bg text-brand-strong" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                    {PRIORITY_LABELS[p]}
                  </span>
                  {task.priority === p && <span className="ml-auto text-[10px] text-text-muted">✓</span>}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>

          {/* Date submenu */}
          <MenuSub>
            <MenuSubTrigger className={itemClass}>
              <span className="flex items-center gap-2.5">
                <HugeiconsIcon icon={Calendar03Icon} size={14} className="text-text-muted" />
                {task.dueDate ? format(new Date(task.dueDate + "T00:00:00"), "MMM d") : "Date"}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className={subPopupClass}>
              {datePresets.map((d) => (
                <MenuItem
                  key={d.label}
                  onClick={() => syncUpdate({ id: task._id, dueDate: d.date })}
                  className={`${itemClass} ${task.dueDate === d.date ? "bg-brand-bg text-brand-strong" : ""}`}
                >
                  {d.label}
                  {task.dueDate === d.date && <span className="ml-auto text-[10px] text-text-muted">✓</span>}
                </MenuItem>
              ))}
              {task.dueDate && (
                <>
                  <MenuSeparator className="my-1 border-line" />
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
                <HugeiconsIcon icon={Folder01Icon} size={14} className="text-text-muted" />
                Project
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className={subPopupClass}>
              <MenuItem
                onClick={() => syncUpdate({ id: task._id, clearProjectId: true } as Parameters<typeof updateTask>[0])}
                className={`${itemClass} ${!task.projectId ? "bg-brand-bg text-brand-strong" : ""}`}
              >
                No project
                {!task.projectId && <span className="ml-auto text-[10px] text-text-muted">✓</span>}
              </MenuItem>
              {projects?.map((p) => (
                <MenuItem
                  key={p._id}
                  onClick={() => syncUpdate({ id: task._id, projectId: p._id })}
                  className={`${itemClass} ${task.projectId === p._id ? "bg-brand-bg text-brand-strong" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </span>
                  {task.projectId === p._id && <span className="ml-auto text-[10px] text-text-muted">✓</span>}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>

          <MenuSeparator className="my-1 border-line" />

          {/* Mark done */}
          <MenuItem onClick={toggleComplete} className={itemClass}>
            <span className="flex items-center gap-2.5">
              <HugeiconsIcon icon={Tick01Icon} size={14} className="text-text-muted" />
              {isDone ? "Mark undone" : "Mark done"}
            </span>
          </MenuItem>

          {/* Delete */}
          <MenuItem onClick={removeTask} className={`${itemClass} text-[#ef4444]`}>
            <span className="flex items-center gap-2.5">
              <HugeiconsIcon icon={Delete01Icon} size={14} />
              Delete
            </span>
          </MenuItem>
        </ContextMenuPopup>
      </ContextMenu>

      {/* Edit dialog */}
      <TaskEditDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
