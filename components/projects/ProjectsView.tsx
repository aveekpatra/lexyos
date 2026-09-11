"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import KanbanCard, { TaskEditDialog } from "@/components/kanban/KanbanCard";
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
import { Segmented } from "@/components/ui/segmented";
import { glassAction, glassIconButton, bluePill } from "@/lib/ui/chrome";
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
  ArrowRight01Icon, ArrowLeft01Icon, SortingAZ01Icon,
} from "@hugeicons/core-free-icons";
import { format, parseISO } from "date-fns";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";

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

export default function ProjectsView() {
  const [showArchived, setShowArchivedRaw] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("unifocus:projects:showArchived") === "true";
  });
  const setShowArchived = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setShowArchivedRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try { localStorage.setItem("unifocus:projects:showArchived", String(next)); } catch {}
      return next;
    });
  }, []);
  const activeProjects = useQuery(api.projects.list, { status: "active" });
  const archivedProjects = useQuery(api.projects.list, { status: "archived" });
  const projects = showArchived ? archivedProjects : activeProjects;

  const [selectedProjectId, setSelectedProjectIdRaw] = useState<Id<"projects"> | null>(null);
  const setSelectedProjectId = useCallback((id: Id<"projects"> | null) => {
    setSelectedProjectIdRaw(id);
    try {
      if (id) localStorage.setItem("unifocus:projects:lastProject", id);
      else localStorage.removeItem("unifocus:projects:lastProject");
    } catch {}
  }, []);
  const [showCreate, setShowCreate] = useState(false);
  const { width: sidebarWidth, onMouseDown: handleResize } = useResizablePanel("projects-sidebar", 220);

  // Hydrate selected project from localStorage, or fall back to first project.
  // Reads localStorage (an external store) once project data has loaded, so it
  // belongs in an effect rather than render phase.
  useEffect(() => {
    if (!activeProjects || activeProjects.length === 0) return;
    if (selectedProjectId) return; // already selected
    const stored = localStorage.getItem("unifocus:projects:lastProject");
    const next =
      stored && activeProjects.some((p) => p._id === stored)
        ? (stored as Id<"projects">)
        : activeProjects[0]._id;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init from an external store (localStorage) after async data loads
    setSelectedProjectIdRaw(next);
  }, [activeProjects, selectedProjectId]);

  if (projects === undefined) {
    return (
      <div className="flex flex-1">
        <div className="w-56 border-r border-dashed border-line-strong p-4">
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
        className="flex shrink-0 flex-col border-r border-line"
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
            <HugeiconsIcon icon={FolderLibraryIcon} size={28} className="text-text-faint" />
            <span className="text-[13px] text-text-faint">
              {(projects?.length ?? 0) === 0 ? "Create your first project" : "Select a project"}
            </span>
            {!showArchived && (projects?.length ?? 0) === 0 && (
              <button className={bluePill} onClick={() => setShowCreate(true)}>
                <HugeiconsIcon icon={Add01Icon} size={14} /> New Project
              </button>
            )}
          </div>
        </div>
      )}

      <CreateProjectDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

/* ─── Sort options ─── */
type ProjectSort = "manual" | "name-asc" | "name-desc" | "date-newest" | "date-oldest" | "priority";

const SORT_LABELS: Record<ProjectSort, string> = {
  "manual": "Manual",
  "name-asc": "Name (A → Z)",
  "name-desc": "Name (Z → A)",
  "date-newest": "Newest first",
  "date-oldest": "Oldest first",
  "priority": "Priority",
};

const PRIORITY_ORDER: Record<string, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };

function sortProjects(projects: Doc<"projects">[], sort: ProjectSort): Doc<"projects">[] {
  const sorted = [...projects];
  switch (sort) {
    case "manual":
      return sorted.sort((a, b) => a.sortOrder - b.sortOrder);
    case "name-asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "name-desc":
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "date-newest":
      return sorted.sort((a, b) => b._creationTime - a._creationTime);
    case "date-oldest":
      return sorted.sort((a, b) => a._creationTime - b._creationTime);
    case "priority":
      return sorted.sort((a, b) => (PRIORITY_ORDER[a.priority ?? "p4"] ?? 3) - (PRIORITY_ORDER[b.priority ?? "p4"] ?? 3));
    default:
      return sorted;
  }
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
  const reorderProjects = useMutation(api.projects.reorder);
  const prefs = useQuery(api.userPreferences.get);
  const setPrefs = useMutation(api.userPreferences.set);
  const [editingId, setEditingId] = useState<Id<"projects"> | null>(null);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [dragOverId, setDragOverId] = useState<Id<"projects"> | null>(null);
  const [draggedId, setDraggedId] = useState<Id<"projects"> | null>(null);
  const [sort, setSortRaw] = useState<ProjectSort>(() => {
    if (typeof window === "undefined") return "manual";
    return (localStorage.getItem("unifocus:projects:sort") as ProjectSort) || "manual";
  });

  // Hydrate sort from Convex once loaded: sync state during render
  // (prev-tracking), and persist to localStorage in an effect (side-effect).
  const [prevPrefsSort, setPrevPrefsSort] = useState(prefs?.projectSort);
  if (prefs?.projectSort && prefs.projectSort !== prevPrefsSort) {
    setPrevPrefsSort(prefs.projectSort);
    setSortRaw(prefs.projectSort as ProjectSort);
  }
  useEffect(() => {
    if (prefs?.projectSort) {
      try { localStorage.setItem("unifocus:projects:sort", prefs.projectSort); } catch {}
    }
  }, [prefs?.projectSort]);

  const setSort = useCallback((s: ProjectSort) => {
    setSortRaw(s);
    try { localStorage.setItem("unifocus:projects:sort", s); } catch {}
    setPrefs({ projectSort: s }).catch(() => {});
  }, [setPrefs]);

  const sortedProjects = useMemo(() => sortProjects(projects, sort), [projects, sort]);

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
    <div className="flex h-full flex-col py-3">
      {/* Header: Active/Archived switcher, sort, create */}
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <Segmented
          layoutId="projects-scope"
          size="sm"
          value={showArchived ? "archived" : "active"}
          onChange={(v) => { if ((v === "archived") !== showArchived) onToggleArchived(); }}
          items={[
            { value: "active", label: "Active", title: "Active projects" },
            { value: "archived", label: "Archived", title: "Archived projects" },
          ]}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <Menu>
            <MenuTrigger render={<button className={glassIconButton} title="Sort projects" />}>
              <HugeiconsIcon icon={SortingAZ01Icon} size={13} />
            </MenuTrigger>
            <MenuPopup>
              {(Object.keys(SORT_LABELS) as ProjectSort[]).map((key) => (
                <MenuItem key={key} onClick={() => setSort(key)}>
                  {SORT_LABELS[key]}
                  {sort === key && <span className="ml-auto text-[10px] text-text-muted">✓</span>}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
          {!showArchived && (
            <button onClick={onCreate} className={bluePill} title="New project">
              <HugeiconsIcon icon={Add01Icon} size={14} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-1">
        {sortedProjects.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-2 py-8">
            <HugeiconsIcon icon={FolderLibraryIcon} size={20} className="text-text-faint" />
            <span className="text-[12px] text-text-faint">
              {showArchived ? "No archived projects" : "No projects yet"}
            </span>
          </div>
        )}
        {sortedProjects.map((project) => (
          <ContextMenu key={project._id}>
            <ContextMenuTrigger
              draggable={sort === "manual" && !editingId}
              onDragStart={(e) => {
                setDraggedId(project._id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggedId && draggedId !== project._id) setDragOverId(project._id);
              }}
              onDragLeave={() => { if (dragOverId === project._id) setDragOverId(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverId(null);
                if (!draggedId || draggedId === project._id) return;
                const fromIdx = sortedProjects.findIndex((p) => p._id === draggedId);
                const toIdx = sortedProjects.findIndex((p) => p._id === project._id);
                if (fromIdx === -1 || toIdx === -1) return;
                const reordered = [...sortedProjects];
                const [moved] = reordered.splice(fromIdx, 1);
                reordered.splice(toIdx, 0, moved);
                reorderProjects({ orderedIds: reordered.map((p) => p._id) }).catch(() => {});
              }}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
              onClick={() => onSelect(project._id)}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[13px] shadow-3d transition-all active:translate-y-[1px] active:shadow-3d-sm ${
                dragOverId === project._id
                  ? "border-brand bg-brand-bg text-brand"
                  : selectedId === project._id
                    ? "border-brand-border bg-brand-bg text-brand"
                    : "border-line bg-surface-1 text-text-secondary hover:border-line-strong hover:bg-hover hover:text-text-strong"
              } ${draggedId === project._id ? "opacity-40" : ""}`}
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
                  className="flex-1 truncate bg-transparent text-[13px] font-medium text-foreground outline-none"
                />
              ) : (
                <span className="flex-1 truncate font-medium">{project.name}</span>
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
                      {project.priority === p && <span className="ml-auto text-[10px] text-text-muted">✓</span>}
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
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <div className="flex items-center gap-3">
          <HugeiconsIcon icon={HashtagIcon} size={18} color={project.color} />
          <h1 className="text-[15px] font-bold tracking-tight text-text-strong">{project.name}</h1>
          <Badge variant="secondary" size="sm">Archived</Badge>
        </div>
        <button className={glassAction} onClick={() => updateProject({ id: project._id, status: "active" })}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} /> Restore
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tasks && tasks.length > 0 ? (
          <div className="flex max-w-lg flex-col gap-1.5">
            {tasks.map((t) => <KanbanCard key={t._id} task={t} context="project" />)}
          </div>
        ) : (
          <span className="text-[13px] text-text-faint">No tasks in this project.</span>
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
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        {/* Left: name */}
        <div className="flex items-center gap-2.5">
          <HugeiconsIcon icon={HashtagIcon} size={18} color={project.color} />
          <span className="text-[15px] font-bold tracking-tight text-text-strong">{project.name}</span>
        </div>

        {/* Right: dates + menu */}
        <div className="flex items-center gap-2">
          <ProjectDatePicker
            projectId={project._id}
            startDate={project.startDate}
            dueDate={project.dueDate}
          />
          <Menu>
            <MenuTrigger render={<button className={glassIconButton} title="Project options" />}>
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
            allTasks={tasks || []}
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
function GTDColumn({ column, tasks, allTasks, projectId, isLast, isAdding, onStartAdd, onStopAdd }: {
  column: (typeof GTD_COLUMNS)[number]; tasks: Doc<"tasks">[]; allTasks: Doc<"tasks">[];
  projectId: Id<"projects">; isLast: boolean; isAdding: boolean; onStartAdd: () => void; onStopAdd: () => void;
}) {
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const [newTitle, setNewTitle] = useState("");
  const [isOver, setIsOver] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
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
    } as Parameters<typeof updateTask>[0]);
    // Sync completion status to Google Calendar
    const task = allTasks?.find((t) => t._id === taskId);
    if (task?.googleEventId) {
      try {
        const { syncTaskCompletionToGoogle } = await import("@/lib/google-sync");
        if (newStatus === "done") {
          await syncTaskCompletionToGoogle(task, true);
        } else if (task.status === "done") {
          await syncTaskCompletionToGoogle(task, false);
        }
      } catch (err) {
        console.warn("Google sync failed:", err);
      }
    }
  }, [column.id, tasks, allTasks, updateTask]);

  return (
    <div
      className={`relative flex min-w-[260px] flex-1 flex-col ${!isLast ? "border-r border-line" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleDrop}
    >
      {/* Drop indicator */}
      {isOver && (
        <div className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand/60 bg-brand/5" />
      )}

      <div className="flex items-baseline gap-2 px-5 pb-3 pt-4">
        <span className="text-[15px] font-bold tracking-tight text-text-strong">{column.label}</span>
        <span className="text-[13px] font-medium text-text-muted">{tasks.length}</span>
      </div>
      <div
        onClick={() => { if (!isAdding) onStartAdd(); }}
        className={`mx-5 mb-3 flex items-center justify-between rounded-[13px] px-3.5 py-2.5 transition-colors ${
          isAdding
            ? "bg-brand-bg ring-1 ring-inset ring-brand-border"
            : "cursor-pointer bg-black/[0.03] hover:bg-black/[0.06] active:translate-y-px dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
        }`}
      >
        {isAdding ? (
          <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Enter = quick add, Tab = full editor, Esc = cancel"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } if (e.key === "Tab") { e.preventDefault(); onStopAdd(); setCreateDialogOpen(true); } if (e.key === "Escape") onStopAdd(); }}
            onBlur={() => { if (!newTitle.trim()) onStopAdd(); }}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-muted" />
        ) : (
          <>
            <span className="flex items-center gap-2.5 text-sm text-text-faint">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>
              Add new task
            </span>
            <Kbd>{column.shortcut}</Kbd>
          </>
        )}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-4">
        {tasks.length > 0 ? (
          <div className="flex flex-col gap-1.5">{tasks.map((t) => <KanbanCard key={t._id} task={t} context="project" />)}</div>
        ) : (
          <div className="mt-auto flex items-center gap-2 pb-2">
            <span className="text-[12px] tracking-wide text-text-faint">No tasks</span>
            <span className="flex size-[18px] items-center justify-center rounded-[6px] bg-black/[0.05] text-[10px] font-bold text-text-faint dark:bg-white/[0.08]">0</span>
          </div>
        )}
      </div>
      <TaskEditDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} defaultDueDate={undefined} />
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
        render={<button className={glassAction} />}
      >
        <HugeiconsIcon icon={Calendar01Icon} size={13} />
        {hasAnyDate ? (
          <span>
            {startDate && format(parseISO(startDate), "MMM d")}
            {startDate && dueDate && <span className="mx-1 text-text-faint">→</span>}
            {dueDate && format(parseISO(dueDate), "MMM d")}
          </span>
        ) : (
          <span>Set dates</span>
        )}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" sideOffset={8} className="p-0 w-auto">
        <div className="flex divide-x divide-line-strong">
          {/* Start date */}
          <div className="flex flex-col">
            <div className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
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
            <div className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
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
