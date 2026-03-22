"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import KanbanCard from "@/components/kanban/KanbanCard";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import {
  Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator,
} from "@/components/ui/menu";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuPopup,
} from "@/components/ui/context-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon, FolderLibraryIcon, HashtagIcon, MoreHorizontalIcon,
  Delete01Icon, Calendar01Icon, Copy01Icon, Settings01Icon,
  ArrowRight01Icon, ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { format, parseISO } from "date-fns";

const GTD_COLUMNS = [
  { id: "planned" as const, label: "Planned", shortcut: "P" },
  { id: "in_progress" as const, label: "In Progress", shortcut: "I" },
  { id: "review" as const, label: "Review", shortcut: "R" },
  { id: "done" as const, label: "Done", shortcut: "D" },
];

const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#71717a",
];

const PRIORITY_LABELS: Record<string, string> = { p1: "Urgent", p2: "High", p3: "Medium", p4: "Low" };
const PRIORITY_COLORS: Record<string, string> = { p1: "#f87171", p2: "#fb923c", p3: "#a78bfa", p4: "#a1a1aa" };

export default function ProjectsView() {
  const [showArchived, setShowArchived] = useState(false);
  const activeProjects = useQuery(api.projects.list, { status: "active" });
  const archivedProjects = useQuery(api.projects.list, { status: "archived" });
  const projects = showArchived ? archivedProjects : activeProjects;

  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { width: sidebarWidth, onMouseDown: handleResize } = useResizablePanel("projects-sidebar", 220);

  useEffect(() => {
    if (activeProjects && activeProjects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(activeProjects[0]._id);
    }
  }, [activeProjects, selectedProjectId]);

  if (projects === undefined) {
    return (
      <div className="flex flex-1">
        <div className="w-56 border-r border-dashed border-[#3a3a48] p-4">
          <Skeleton className="mb-4 h-6 w-32" />
          {[1, 2, 3].map((i) => <Skeleton key={i} className="mb-2 h-8 w-full" />)}
        </div>
        <div className="flex-1 p-6"><Skeleton className="h-80 w-full" /></div>
      </div>
    );
  }

  const selectedProject = projects?.find((p) => p._id === selectedProjectId) ?? null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Resizable sidebar */}
      <div
        className="flex shrink-0 flex-col border-r border-dashed border-[#3a3a48]"
        style={{ width: sidebarWidth }}
      >
        <ProjectSidebar
          projects={projects ?? []}
          selectedId={selectedProjectId}
          onSelect={setSelectedProjectId}
          onCreate={() => setShowCreate(true)}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived(!showArchived)}
        />
      </div>

      <ResizeHandle onMouseDown={handleResize} />

      {/* Main pane */}
      {selectedProject ? (
        showArchived ? (
          <ArchivedProjectView project={selectedProject} />
        ) : (
          <ProjectBoard project={selectedProject} />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <HugeiconsIcon icon={FolderLibraryIcon} size={28} className="text-[#52525b]" />
            <span className="text-[13px] text-[#52525b]">
              {(projects?.length ?? 0) === 0 ? "Create your first project" : "Select a project"}
            </span>
            {!showArchived && (projects?.length ?? 0) === 0 && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <HugeiconsIcon icon={Add01Icon} size={14} /> New Project
              </Button>
            )}
          </div>
        </div>
      )}

      <CreateProjectDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

/* ─── Sidebar ─── */
function ProjectSidebar({ projects, selectedId, onSelect, onCreate, showArchived, onToggleArchived }: {
  projects: Doc<"projects">[]; selectedId: Id<"projects"> | null;
  onSelect: (id: Id<"projects">) => void; onCreate: () => void;
  showArchived: boolean; onToggleArchived: () => void;
}) {
  const removeProject = useMutation(api.projects.remove);
  const updateProject = useMutation(api.projects.update);
  const duplicateProject = useMutation(api.projects.duplicate);
  const [editingId, setEditingId] = useState<Id<"projects"> | null>(null);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  function startRename(project: Doc<"projects">) {
    setEditingId(project._id);
    setEditName(project.name);
    requestAnimationFrame(() => editRef.current?.focus());
  }

  async function commitRename() {
    if (editingId && editName.trim()) {
      await updateProject({ id: editingId, name: editName.trim() });
    }
    setEditingId(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <span className="text-[15px] font-bold text-white">
          {showArchived ? "Archived" : "Projects"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onToggleArchived}
            className={`flex size-7 items-center justify-center rounded-[6px] border transition-colors ${
              showArchived
                ? "border-[#3a3a48] bg-[#1f1f28] text-white shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                : "border-[#2a2a32] bg-[#16161e] text-[#71717a] shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-[#3a3a48] hover:text-[#a1a1aa]"
            }`}
            title={showArchived ? "Show active" : "Show archived"}
          >
            <HugeiconsIcon icon={showArchived ? ArrowLeft01Icon : FolderLibraryIcon} size={13} />
          </button>
          {!showArchived && (
            <button
              onClick={onCreate}
              className="flex size-7 items-center justify-center rounded-[6px] border border-[#2a2a32] bg-[#16161e] text-[#71717a] shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-colors hover:border-[#3a3a48] hover:text-[#a1a1aa]"
            >
              <HugeiconsIcon icon={Add01Icon} size={13} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4">
        {projects.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-2 py-8">
            <HugeiconsIcon icon={FolderLibraryIcon} size={20} className="text-[#52525b]" />
            <span className="text-[12px] text-[#52525b]">
              {showArchived ? "No archived projects" : "No projects yet"}
            </span>
          </div>
        )}
        {projects.map((project) => (
          <ContextMenu key={project._id}>
            <ContextMenuTrigger
              onClick={() => onSelect(project._id)}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left text-[14px] transition-all ${
                selectedId === project._id
                  ? "border-[#3a3a48] bg-[#1f1f28] text-white shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                  : "border-transparent text-[#a1a1aa] hover:border-[#2a2a32] hover:bg-[#18181d] hover:text-white hover:shadow-[0_2px_0_0_rgba(0,0,0,0.2),inset_0_1px_0_0_rgba(255,255,255,0.03)]"
              }`}
            >
              <HugeiconsIcon icon={HashtagIcon} size={14} color={project.color} />
              {editingId === project._id ? (
                <input
                  ref={editRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                    e.stopPropagation();
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                  className="flex-1 truncate bg-transparent text-[14px] text-white outline-none"
                />
              ) : (
                <span className="flex-1 truncate">{project.name}</span>
              )}
            </ContextMenuTrigger>
            <ContextMenuPopup>
              {!showArchived && (
                <>
                  <MenuItem onClick={() => startRename(project)}>Rename</MenuItem>
                  <MenuSeparator />
                  {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                    <MenuItem key={p} onClick={() => updateProject({ id: project._id, priority: p })}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                      {PRIORITY_LABELS[p]}
                      {project.priority === p && <span className="ml-auto text-[10px] text-[#71717a]">✓</span>}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <div className="flex flex-wrap gap-1.5 px-3 py-2">
                    {PROJECT_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateProject({ id: project._id, color: c })}
                        className={`size-5 rounded-full transition-transform ${project.color === c ? "ring-2 ring-white ring-offset-1 ring-offset-popover" : "hover:scale-110"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <MenuSeparator />
                  <MenuItem onClick={() => duplicateProject({ id: project._id })}>
                    <HugeiconsIcon icon={Copy01Icon} size={14} /> Duplicate
                  </MenuItem>
                  <MenuItem onClick={() => updateProject({ id: project._id, status: "archived" })}>
                    <HugeiconsIcon icon={ArrowRight01Icon} size={14} /> Archive
                  </MenuItem>
                </>
              )}
              {showArchived && (
                <MenuItem onClick={() => updateProject({ id: project._id, status: "active" })}>
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={14} /> Restore
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => removeProject({ id: project._id })}>
                <HugeiconsIcon icon={Delete01Icon} size={14} /> Delete
              </MenuItem>
            </ContextMenuPopup>
          </ContextMenu>
        ))}
      </nav>
    </div>
  );
}

/* ─── Archived view ─── */
function ArchivedProjectView({ project }: { project: Doc<"projects"> }) {
  const tasks = useQuery(api.tasks.list, { projectId: project._id });
  const updateProject = useMutation(api.projects.update);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#2a2a32] px-6 py-3">
        <div className="flex items-center gap-3">
          <HugeiconsIcon icon={HashtagIcon} size={18} color={project.color} />
          <h1 className="text-[15px] font-bold text-white">{project.name}</h1>
          <Badge variant="secondary" size="sm">Archived</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => updateProject({ id: project._id, status: "active" })}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} /> Restore
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tasks && tasks.length > 0 ? (
          <div className="flex max-w-lg flex-col gap-1.5">
            {tasks.map((t) => <KanbanCard key={t._id} task={t} />)}
          </div>
        ) : (
          <span className="text-[13px] text-[#52525b]">No tasks in this project.</span>
        )}
      </div>
    </div>
  );
}

/* ─── Project Board ─── */
function ProjectBoard({ project }: { project: Doc<"projects"> }) {
  const tasks = useQuery(api.tasks.list, { projectId: project._id });
  const counts = useQuery(api.projects.getTaskCounts, { id: project._id });
  const removeProject = useMutation(api.projects.remove);
  const updateProject = useMutation(api.projects.update);
  const duplicateProject = useMutation(api.projects.duplicate);
  const [activeAddColumn, setActiveAddColumn] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toUpperCase();
      if (key === "P") setActiveAddColumn("planned");
      else if (key === "I") setActiveAddColumn("in_progress");
      else if (key === "R") setActiveAddColumn("review");
      else if (key === "D") setActiveAddColumn("done");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, Doc<"tasks">[]>();
    for (const col of GTD_COLUMNS) map.set(col.id, []);
    if (tasks) {
      for (const t of tasks) {
        const status = t.status === "todo" ? "planned" : t.status;
        const list = map.get(status) ?? map.get("planned")!;
        list.push(t);
      }
    }
    return map;
  }, [tasks]);

  if (!tasks) {
    return (
      <div className="flex-1 p-6">
        <Skeleton className="mb-4 h-12 w-full" />
        <div className="flex gap-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64 flex-1" />)}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#2a2a32] px-6 py-3">
        {/* Left: name + priority */}
        <div className="flex items-center gap-3">
          <HugeiconsIcon icon={HashtagIcon} size={16} color={project.color} />
          <span className="text-sm font-semibold text-white">{project.name}</span>
          {project.priority && (
            <span
              className="rounded-[5px] px-2 py-0.5 text-[11px] font-bold tracking-wide"
              style={{
                color: PRIORITY_COLORS[project.priority],
                backgroundColor: PRIORITY_COLORS[project.priority] + "14",
                border: `1px solid ${PRIORITY_COLORS[project.priority]}25`,
                boxShadow: `0 1px 3px ${PRIORITY_COLORS[project.priority]}10, inset 0 1px 0 rgba(255,255,255,0.04)`,
              }}
            >
              {PRIORITY_LABELS[project.priority]}
            </span>
          )}
        </div>

        {/* Right: dates + menu */}
        <div className="flex items-center gap-2">
          <ProjectDatePicker
            projectId={project._id}
            startDate={project.startDate}
            dueDate={project.dueDate}
          />
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
              <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
            </MenuTrigger>
            <MenuPopup>
              <MenuItem onClick={() => duplicateProject({ id: project._id })}>
                <HugeiconsIcon icon={Copy01Icon} size={14} /> Duplicate
              </MenuItem>
              <MenuItem onClick={() => updateProject({ id: project._id, status: "archived" })}>
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} /> Archive
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => removeProject({ id: project._id })}>
                <HugeiconsIcon icon={Delete01Icon} size={14} /> Delete
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      {/* GTD columns */}
      <div className="flex flex-1 overflow-x-auto">
        {GTD_COLUMNS.map((col, idx) => (
          <GTDColumn
            key={col.id} column={col}
            tasks={(tasksByStatus.get(col.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)}
            projectId={project._id} isLast={idx === GTD_COLUMNS.length - 1}
            isAdding={activeAddColumn === col.id}
            onStartAdd={() => setActiveAddColumn(col.id)}
            onStopAdd={() => setActiveAddColumn(null)}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── GTD Column with drag-drop ─── */
function GTDColumn({ column, tasks, projectId, isLast, isAdding, onStartAdd, onStopAdd }: {
  column: (typeof GTD_COLUMNS)[number]; tasks: Doc<"tasks">[]; projectId: Id<"projects">;
  isLast: boolean; isAdding: boolean; onStartAdd: () => void; onStopAdd: () => void;
}) {
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const [newTitle, setNewTitle] = useState("");
  const [isOver, setIsOver] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) requestAnimationFrame(() => inputRef.current?.focus());
    else setNewTitle("");
  }, [isAdding]);

  async function handleAdd() {
    if (!newTitle.trim()) return;
    await createTask({ title: newTitle.trim(), projectId, status: column.id === "planned" ? "todo" : column.id });
    setNewTitle("");
    inputRef.current?.focus();
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    // Skip if task already in this column
    if (tasks.some((t) => t._id === taskId)) return;
    // Map column id to task status
    const newStatus = column.id === "planned" ? "todo" as const : column.id;
    await updateTask({
      id: taskId as Id<"tasks">,
      status: newStatus,
      ...(newStatus === "done" ? { completedAt: Date.now() } : {}),
    } as Parameters<typeof updateTask>[0]);
  }, [column.id, tasks, updateTask]);

  return (
    <div
      className={`relative flex min-w-[260px] flex-1 flex-col ${!isLast ? "border-r border-dashed border-[#3a3a48]" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleDrop}
    >
      {/* Drop indicator */}
      {isOver && (
        <div className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-[#a78bfa]/60 bg-[#a78bfa]/5" />
      )}

      <div className="flex items-center gap-2 px-5 pb-3 pt-4">
        <span className="text-[15px] font-bold text-[#f4f4f5]">{column.label}</span>
        <span className="text-[13px] font-medium text-[#71717a]">{tasks.length}</span>
      </div>
      <div
        onClick={() => { if (!isAdding) onStartAdd(); }}
        className={`mx-5 mb-3 flex items-center justify-between rounded-[10px] border px-3.5 py-2.5 transition-colors ${
          isAdding ? "border-[#4a4a58] bg-[#1a1a22]" : "cursor-pointer border-[#333340] bg-[#16161e] hover:border-[#4a4a58] hover:bg-[#1e1e28]"
        }`}
      >
        {isAdding ? (
          <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task name — Enter to add"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } if (e.key === "Escape") onStopAdd(); }}
            onBlur={() => { if (!newTitle.trim()) onStopAdd(); }}
            className="flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-[#71717a]" />
        ) : (
          <>
            <span className="flex items-center gap-2.5 text-[14px] text-[#a1a1aa]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>
              Add task
            </span>
            <Kbd>{column.shortcut}</Kbd>
          </>
        )}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-4">
        {tasks.length > 0 ? (
          <div className="flex flex-col gap-1.5">{tasks.map((t) => <KanbanCard key={t._id} task={t} />)}</div>
        ) : (
          <div className="mt-auto flex items-center gap-2 pb-2">
            <span className="text-[12px] tracking-wide text-[#52525b]">No tasks</span>
            <span className="flex size-[18px] items-center justify-center rounded-[5px] border border-[#3a3a48] bg-[#1a1a22] text-[10px] font-bold text-[#606068] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">0</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Project Date Picker ─── */
function ProjectDatePicker({ projectId, startDate, dueDate }: {
  projectId: Id<"projects">; startDate?: string; dueDate?: string;
}) {
  const updateProject = useMutation(api.projects.update);
  const hasAnyDate = startDate || dueDate;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all ${
            hasAnyDate
              ? "border border-[#2a2a32] bg-[#16161e] text-[#a1a1aa] hover:border-[#3a3a48] hover:bg-[#1e1e28]"
              : "text-[#52525b] hover:text-[#a1a1aa]"
          }`} />
        }
      >
        <HugeiconsIcon icon={Calendar01Icon} size={13} />
        {hasAnyDate ? (
          <span>
            {startDate && format(parseISO(startDate), "MMM d")}
            {startDate && dueDate && <span className="mx-1 text-[#52525b]">→</span>}
            {dueDate && format(parseISO(dueDate), "MMM d")}
          </span>
        ) : (
          <span>Set dates</span>
        )}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" sideOffset={8} className="p-0 w-auto">
        <div className="flex divide-x divide-[#2a2a32]">
          {/* Start date */}
          <div className="flex flex-col">
            <div className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#71717a]">
              Start
            </div>
            <Calendar
              mode="single"
              selected={startDate ? parseISO(startDate) : undefined}
              onSelect={(date) => {
                updateProject({
                  id: projectId,
                  startDate: date ? format(date, "yyyy-MM-dd") : undefined,
                });
              }}
            />
            {startDate && (
              <button
                onClick={() => updateProject({ id: projectId, startDate: undefined })}
                className="mx-4 mb-3 text-left text-[11px] text-[#ef4444] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {/* Due date */}
          <div className="flex flex-col">
            <div className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#71717a]">
              Due
            </div>
            <Calendar
              mode="single"
              selected={dueDate ? parseISO(dueDate) : undefined}
              onSelect={(date) => {
                updateProject({
                  id: projectId,
                  dueDate: date ? format(date, "yyyy-MM-dd") : undefined,
                });
              }}
            />
            {dueDate && (
              <button
                onClick={() => updateProject({ id: projectId, dueDate: undefined })}
                className="mx-4 mb-3 text-left text-[11px] text-[#ef4444] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/* ─── Create Project Dialog — minimal ─── */
function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createProject = useMutation(api.projects.create);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[6]);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createProject({ name: name.trim(), color });
      setName(""); setColor(PROJECT_COLORS[6]);
      onOpenChange(false);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }} />
            <div>
              <span className="mb-2 block text-xs text-muted-foreground">Color</span>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} className={`size-6 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-background" : "hover:scale-110"}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || saving} loading={saving}>Create</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
