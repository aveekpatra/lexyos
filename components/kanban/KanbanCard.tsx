"use client";

import React, { useState, useCallback } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuPopup,
} from "@/components/ui/context-menu";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import {
  Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import { format, parseISO, isPast, isToday } from "date-fns";

interface KanbanCardProps {
  task: Doc<"tasks">;
  isOverdue?: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  p1: "#f87171", p2: "#fb923c", p3: "#a78bfa", p4: "#a1a1aa",
};
const PRIORITY_LABELS: Record<string, string> = {
  p1: "Urgent", p2: "High", p3: "Medium", p4: "Low",
};

const KanbanCard = React.memo(function KanbanCard({ task, isOverdue }: KanbanCardProps) {
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);
  const projects = useQuery(api.projects.list, { status: "active" });
  const project = useQuery(
    api.projects.getById,
    task.projectId ? { id: task.projectId } : "skip"
  );
  const [editOpen, setEditOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const isDone = task.status === "done";
  const color = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.p4;
  const dateStr = task.dueDate || task.scheduledDate;

  let dateColor = "#a1a1aa";
  if (task.dueDate) {
    const d = parseISO(task.dueDate);
    if (isPast(d) && !isToday(d)) dateColor = "#f87171";
    else if (isToday(d)) dateColor = "#fb923c";
  }

  const duration =
    task.scheduledStartTime && task.scheduledEndTime
      ? fmtDuration(task.scheduledStartTime, task.scheduledEndTime)
      : null;

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task._id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  }, [task._id]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className={`group flex w-full cursor-grab items-center gap-3 rounded-[10px] px-3.5 py-2.5 transition-all active:cursor-grabbing ${
            isDragging ? "opacity-40" : ""
          } ${
            isOverdue
              ? "border border-[#4a2040] bg-[#1e1020] shadow-[0_2px_0_0_rgba(60,20,40,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:bg-[#281428]"
              : "border border-[#333340] bg-[#1a1a22] shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:bg-[#222230]"
          }`}
        >
          {/* Priority circle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleComplete({ id: task._id }); }}
            onContextMenu={(e) => e.stopPropagation()}
            className="flex size-[16px] shrink-0 items-center justify-center rounded-full transition-colors"
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

          {/* Title — click to edit */}
          <span
            onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
            className={`flex-1 cursor-pointer truncate text-sm font-medium ${isDone ? "text-[#71717a] line-through" : "text-white"}`}
          >
            {task.title}
          </span>

          {/* Meta */}
          <div className="flex shrink-0 items-center gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            {typeof (task as Record<string, unknown>).dueTime === "string" && (
              <span className="rounded-[5px] border border-[#2a2a36] bg-[#131318] px-1.5 py-0.5 font-medium text-[#a1a1aa] shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                {fmtTime((task as Record<string, unknown>).dueTime as string)}
              </span>
            )}
            <TaskDateChip
              taskId={task._id}
              dueDate={task.dueDate}
              dateColor={dateColor}
            />
            {duration && (
              <span className="rounded-[5px] border border-[#2a2a36] bg-[#131318] px-1.5 py-0.5 font-medium text-[#a1a1aa] shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                {duration}
              </span>
            )}
            {project && (
              <span className="max-w-[60px] truncate rounded-[5px] border border-[#2a2a36] bg-[#131318] px-1.5 py-0.5 font-semibold shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]" style={{ color: project.color }}>
                {project.name}
              </span>
            )}
          </div>
        </ContextMenuTrigger>

        {/* Right-click menu */}
        <ContextMenuPopup>
          <MenuItem onClick={() => setEditOpen(true)}>Edit</MenuItem>
          <MenuSeparator />
          {(["p1", "p2", "p3", "p4"] as const).map((p) => (
            <MenuItem key={p} onClick={() => updateTask({ id: task._id, priority: p })}>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
              {PRIORITY_LABELS[p]}
              {task.priority === p && <span className="ml-auto text-[10px] text-[#71717a]">✓</span>}
            </MenuItem>
          ))}
          <MenuSeparator />
          {projects && projects.length > 0 && (
            <>
              <MenuItem onClick={() => updateTask({ id: task._id, clearProjectId: true })}>
                No project
                {!task.projectId && <span className="ml-auto text-[10px] text-[#71717a]">✓</span>}
              </MenuItem>
              {projects.map((p) => (
                <MenuItem key={p._id} onClick={() => updateTask({ id: task._id, projectId: p._id })}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
                  {task.projectId === p._id && <span className="ml-auto text-[10px] text-[#71717a]">✓</span>}
                </MenuItem>
              ))}
              <MenuSeparator />
            </>
          )}
          <MenuItem onClick={() => toggleComplete({ id: task._id })}>
            {isDone ? "Mark incomplete" : "Mark done"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => removeTask({ id: task._id })}>
            <HugeiconsIcon icon={Delete01Icon} size={14} />
            Delete
          </MenuItem>
        </ContextMenuPopup>
      </ContextMenu>

      {/* Edit dialog */}
      <TaskEditDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
});

export default KanbanCard;

/* ─── Date chip ─── */
function TaskDateChip({ taskId, dueDate, dateColor }: {
  taskId: Id<"tasks">; dueDate?: string; dateColor: string;
}) {
  const updateTask = useMutation(api.tasks.update);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={`flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
              dueDate
                ? "border-[#2a2a36] bg-[#131318] shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-[#3a3a48]"
                : "border-[#2a2a36] bg-[#131318] text-[#52525b] shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-[#3a3a48] hover:text-[#71717a]"
            }`}
            style={dueDate ? { color: dateColor } : undefined}
          />
        }
      >
        {dueDate ? format(parseISO(dueDate), "MMM d") : "Set date"}
      </PopoverTrigger>
      <PopoverPopup sideOffset={4} className="p-0">
        <Calendar
          mode="single"
          selected={dueDate ? parseISO(dueDate) : undefined}
          onSelect={(date) => {
            updateTask({
              id: taskId,
              dueDate: date ? format(date, "yyyy-MM-dd") : undefined,
            });
          }}
        />
        {dueDate && (
          <div className="border-t px-3 py-2">
            <button
              onClick={() => updateTask({ id: taskId, dueDate: undefined })}
              className="text-[11px] text-[#ef4444] hover:underline"
            >
              Clear date
            </button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

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
  const updateTask = useMutation(api.tasks.update);
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const projects = useQuery(api.projects.list, { status: "active" });

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
  const duration = startTime && endTime ? fmtDuration(startTime, endTime) : null;
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
        await createTask({
          title: title.trim(),
          description: notes || undefined,
          priority,
          dueDate: dueDate || undefined,
          dueTime: dueTime || undefined,
          scheduledStartTime: startTime || undefined,
          scheduledEndTime: endTime || undefined,
          projectId: projectId ? (projectId as Id<"projects">) : undefined,
          recurrence: recurrence || undefined,
        });
      } else {
        await updateTask({
          id: task._id,
          title: title.trim(),
          priority,
          // Set or clear each field explicitly
          ...(notes ? { description: notes } : { clearDescription: true }),
          ...(dueDate ? { dueDate } : { clearDueDate: true }),
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
              <DateButton value={dueDate} onChange={setDueDate} />
              <TimeButton value={dueTime} onChange={setDueTime} label="Time" />
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
                  onClick={() => toggleComplete({ id: task._id })}
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
              <TimeButton value={startTime} onChange={setStartTime} label="Start" />
              {startTime && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <TimeButton value={endTime} onChange={setEndTime} label="End" />
                </>
              )}
            </div>

            {/* Project */}
            <div className="flex items-center gap-2">
              <Menu>
                <MenuTrigger
                  render={
                    selectedProject
                      ? <button className={chipClass}><span className="size-2 rounded-full" style={{ backgroundColor: selectedProject.color }} />{selectedProject.name}</button>
                      : <button className={chipEmptyClass}>Project</button>
                  }
                />
                <MenuPopup>
                  <MenuItem onClick={() => setProjectId("")}>
                    None
                    {!projectId && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                  </MenuItem>
                  {projects?.map((p) => (
                    <MenuItem key={p._id} onClick={() => setProjectId(p._id)}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.name}
                      {projectId === p._id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
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

/* ─── Date button with calendar popover ─── */
function DateButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
  const chipEmpty = "inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground";

  return (
    <Popover>
      <PopoverTrigger render={<button className={value ? chip : chipEmpty} />}>
        {value ? format(parseISO(value), "MMM d, yyyy") : "Date"}
      </PopoverTrigger>
      <PopoverPopup sideOffset={4} className="p-0">
        <Calendar
          mode="single"
          selected={value ? parseISO(value) : undefined}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
        />
        {value && (
          <div className="border-t px-3 py-2">
            <button onClick={() => onChange("")} className="text-xs text-destructive-foreground hover:underline">Clear</button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

/* ─── Time picker — clickable grid of times ─── */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  const value = `${String(h).padStart(2, "0")}:${m}`;
  const ampm = h === 0 ? "12" : h > 12 ? String(h - 12) : String(h);
  const suffix = h < 12 ? "am" : "pm";
  const label = `${ampm}:${m} ${suffix}`;
  return { value, label };
});

function TimeButton({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
  const chipEmpty = "inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground";

  return (
    <Popover>
      <PopoverTrigger render={<button className={value ? chip : chipEmpty} />}>
        {value ? fmtTime(value) : label}
      </PopoverTrigger>
      <PopoverPopup sideOffset={4} className="w-36 p-0">
        <div className="max-h-56 overflow-y-auto py-1">
          {TIMES.map((t) => (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              className={`flex w-full px-3 py-1.5 text-left text-xs transition-colors ${
                value === t.value
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {value && (
          <div className="border-t px-3 py-2">
            <button onClick={() => onChange("")} className="text-xs text-destructive-foreground hover:underline">Clear</button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtDuration(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h > 0 && r > 0) return `${h}h ${r}m`;
  return h > 0 ? `${h}h` : `${r}m`;
}
