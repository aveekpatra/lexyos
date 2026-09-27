"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import KanbanCard from "@/components/kanban/KanbanCard";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { DatePickerPopover } from "@/components/tasks/TaskPropertyPopovers";
import { ProjectMenuItems, DeleteProjectDialog } from "@/components/projects/ProjectActions";
import { RailHeading, PropertyRow, Dot, RadialProgress } from "@/components/ui/property-rail";
import { projectSignals } from "@/lib/project-signals";
import { glassIconButton, glassAction, softPill as pill, emptyPill as pillEmpty, BOARD_COLUMN_WIDTH, pillEndCap } from "@/lib/ui/chrome";
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_OPTIONS, type TaskStatus } from "@/lib/constants";
import { projectColumns, columnForTask, statusForColumn, newColumnId, type BoardColumn } from "@/convex/lib/columns";
import { useSettings, matchesShortcut } from "@/lib/settings";
import { format, parseISO } from "date-fns";
import { useQuickAdd } from "@/lib/quick-add";
import {
  IoArrowDown,
  IoCheckmarkCircle,
  IoEllipsisHorizontal,
  IoAdd,
} from "react-icons/io5";
import { ProjectGlyph } from "@/components/ui/project-glyph";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { projectIcon } from "@/lib/ui/project-icons";

/*
 * A project is a place, not a filter. Clicking one in the sidebar lands here:
 * its tasks on a board grouped by status (the Linear model). The Overview tab
 * holds what the project is about: description, a context document for the
 * agent, dates, priority, colour.
 */

type Tab = "board" | "overview";
type SortBy = "priority" | "date" | "created" | "alpha";
const SORT_LABELS: Record<SortBy, string> = {
  priority: "Priority", date: "Due date", created: "Recently added", alpha: "Alphabetical",
};

export default function ProjectBoard({ projectId }: { projectId: Id<"projects"> }) {
  const router = useRouter();
  const project = useQuery(api.projects.getById, { id: projectId });
  const tasks = useQuery(api.tasks.list, { projectId });
  const [tab, setTab] = useState<Tab>("board");
  // Digits 1..5 focus a column's add field, same as the timeline; the quick-add shortcut takes the first.
  const [focusColumn, setFocusColumn] = useState<string | null>(null);
  const columns = useMemo(() => projectColumns(project), [project]);
  const setColumns = useMutation(api.projects.setColumns);
  const saveColumns = useCallback((next: BoardColumn[]) => setColumns({ id: projectId, columns: next }), [setColumns, projectId]);
  const [focusTick, setFocusTick] = useState(0);
  const { settings: boardSettings } = useSettings();
  useEffect(() => {
    if (tab !== "board") return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      let idx = -1;
      if (matchesShortcut(e, boardSettings.shortcuts.quickAdd) && !/^[0-9]$/.test(e.key)) idx = 0;
      else if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) idx = Number(e.key) - 1;
      const col = columns[idx];
      if (!col) return;
      e.preventDefault();
      setFocusColumn(col.id);
      setFocusTick((n) => n + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, boardSettings.shortcuts.quickAdd, columns]);
  const [sortBy, setSortBy] = useState<SortBy>("priority");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const updateProject = useMutation(api.projects.update);

  const sort = useCallback((list: Doc<"tasks">[]) => {
    const out = [...list];
    switch (sortBy) {
      case "priority": { const o = { p1: 0, p2: 1, p3: 2, p4: 3 }; out.sort((a, b) => o[a.priority] - o[b.priority]); break; }
      case "date": out.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")); break;
      case "created": out.sort((a, b) => b._creationTime - a._creationTime); break;
      case "alpha": out.sort((a, b) => a.title.localeCompare(b.title)); break;
    }
    return out;
  }, [sortBy]);

  const byColumn = new Map<string, Doc<"tasks">[]>();
  for (const c of columns) byColumn.set(c.id, []);
  for (const t of tasks ?? []) if (!t.parentTaskId) byColumn.get(columnForTask(t, columns).id)?.push(t);

  if (project === undefined || tasks === undefined) {
    return (
      <div className="flex-1 p-6">
        <Skeleton className="mb-6 h-8 w-48 rounded-lg" />
        <div className="flex gap-2.5">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-80 flex-1 rounded-[18px]" />)}</div>
      </div>
    );
  }
  if (project === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-faint">
        <p className="text-[15px]">Project not found</p>
        <button onClick={() => router.push("/timeline")} className={glassAction}>Back to Inbox</button>
      </div>
    );
  }

  const openCount = (tasks ?? []).filter((t) => t.status !== "done" && !t.parentTaskId).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header: same bar as the Inbox board */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-2">
        <div className="flex min-w-0 items-center gap-3.5">
          <h1 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-text-strong">
            <ProjectGlyph icon={project.icon} open className="size-[18px]" style={{ color: project.color }} />
            <span className="truncate">{project.name}</span>
            <span className="text-[13px] font-medium text-text-faint">{openCount}</span>
            {project.status === "archived" && <span className={`${pill} !h-6 !text-[11px]`}>Archived</span>}
          </h1>
          <Segmented
            layoutId="project-tab"
            value={tab}
            onChange={setTab}
            items={[{ value: "board", label: "Board" }, { value: "overview", label: "Overview" }]}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {tab === "board" && (
            <Menu>
              <MenuTrigger render={<button className={glassAction} />}>
                <IoArrowDown className="size-[15px]" />
                <span>Sort</span>
              </MenuTrigger>
              <MenuPopup align="end">
                {(Object.keys(SORT_LABELS) as SortBy[]).map((s) => (
                  <MenuItem key={s} onClick={() => setSortBy(s)}>
                    {SORT_LABELS[s]}
                    {sortBy === s && <IoCheckmarkCircle className="ml-auto size-3.5" />}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          )}
          <Menu>
            <MenuTrigger render={<button aria-label="Project options" className={glassIconButton} />}>
              <IoEllipsisHorizontal className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-[200px]">
              <ProjectMenuItems project={project} onRequestDelete={() => setDeleteOpen(true)} onRequestEdit={() => setEditOpen(true)} />
            </MenuPopup>
          </Menu>
        </div>
      </div>

      {tab === "board" ? (
        <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden scroll-px-3 px-3 pb-3 pt-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {columns.map((c, i) => (
            <StatusColumn
              key={c.id}
              column={c}
              index={i}
              columns={columns}
              onSaveColumns={saveColumns}
              tasks={sort(byColumn.get(c.id) ?? [])}
              projectId={project._id}
              defaultDueDate={project.dueDate}
              shortcut={i < 9 ? String(i + 1) : ""}
              focusToken={focusColumn === c.id ? focusTick : 0}
            />
          ))}
          <AddColumn columns={columns} onSave={saveColumns} />
        </div>
      ) : (
        <ProjectOverview project={project} tasks={tasks} onUpdate={(patch) => updateProject({ id: project._id, ...patch })} onRequestEdit={() => setEditOpen(true)} />
      )}

      <CreateProjectDialog project={project} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        afterDelete={() => router.push("/timeline")}
      />
    </div>
  );
}

/* ─── Status column: same shell as the Inbox columns, drop sets status ─── */

function StatusColumn({ column, index, columns, onSaveColumns, tasks, projectId, defaultDueDate, shortcut, focusToken }: {
  column: BoardColumn;
  index: number;
  columns: BoardColumn[];
  onSaveColumns: (next: BoardColumn[]) => Promise<unknown>;
  tasks: Doc<"tasks">[];
  projectId: Id<"projects">;
  defaultDueDate?: string;
  shortcut: string;
  /** Changes when a keyboard shortcut asks this column to take focus. */
  focusToken: number;
}) {
  const { id: columnId, name: label } = column;
  const status: TaskStatus = column.status ?? "todo";
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(label);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select(); }); }, [renaming]);
  const commitRename = () => {
    setRenaming(false);
    const n = nameDraft.trim();
    if (!n || n === label) { setNameDraft(label); return; }
    void onSaveColumns(columns.map((c) => (c.id === columnId ? { ...c, name: n } : c)));
  };
  const move = (dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns]; [next[index], next[j]] = [next[j], next[index]];
    void onSaveColumns(next);
  };
  const remove = () => {
    if (columns.length <= 1) return;
    if (tasks.length && !window.confirm(`Delete "${label}"? Its ${tasks.length} task(s) move to the first column.`)) return;
    void onSaveColumns(columns.filter((c) => c.id !== columnId));
  };
  const { create: quickCreate } = useQuickAdd();
  const updateTask = useMutation(api.tasks.update);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [isOver, setIsOver] = useState(false);
  const counter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusToken) return;
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [focusToken]);

  const add = useCallback(async (open: boolean) => {
    const t = title.trim();
    if (!t && !open) return;
    const id = await quickCreate({ title: t || "New task", status, projectId, dueDate: defaultDueDate, columnId });
    setTitle("");
    if (open && id) router.push(`/task/${id}`);
    else inputRef.current?.focus();
  }, [title, status, projectId, defaultDueDate, quickCreate, router, columnId]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    counter.current = 0;
    setIsOver(false);
    const id = e.dataTransfer.getData("text/plain") as Id<"tasks">;
    if (!id || tasks.some((t) => t._id === id)) return;
    const current = (e.dataTransfer.getData("application/task-status") || "todo") as TaskStatus;
    await updateTask({ id, columnId, status: statusForColumn(column, current), projectId });
  }, [tasks, column, columnId, projectId, updateTask]);

  return (
    <div
      data-column-id={columnId}
      className={`group/col relative flex flex-col overflow-hidden rounded-[18px] bg-column ${BOARD_COLUMN_WIDTH}`}
      onDragEnter={(e) => { e.preventDefault(); counter.current++; setIsOver(true); }}
      onDragLeave={() => { counter.current--; if (counter.current <= 0) { counter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={onDrop}
    >
      {isOver && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
          className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand/60 bg-brand/5"
        />
      )}
      <div className="flex h-11 items-center gap-2 pl-3 pr-1.5 pt-1">
        {renaming ? (
          <input
            ref={nameRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setNameDraft(label); setRenaming(false); } }}
            className="h-7 min-w-0 flex-1 rounded-full bg-surface-0 px-2 text-[14px] font-semibold tracking-tight text-text-strong outline-none ring-1 ring-inset ring-line-strong dark:bg-white/[0.06]"
          />
        ) : (
          <button onDoubleClick={() => { setNameDraft(label); setRenaming(true); }} className="min-w-0 truncate text-left text-[14px] font-semibold tracking-tight text-text-strong" title="Double-click to rename">{label}</button>
        )}
        <span className="text-[12px] font-medium text-text-muted">{tasks.length}</span>
        <span className="flex-1" />
        <Menu>
          <MenuTrigger render={<button aria-label={`${label} column options`} className="flex size-7 shrink-0 items-center justify-center rounded-full text-text-faint opacity-0 transition-[opacity,background-color,color] hover:bg-black/[0.06] hover:text-text-strong focus-visible:opacity-100 group-hover/col:opacity-100 data-popup-open:opacity-100 dark:hover:bg-white/[0.08]" />}>
            <IoEllipsisHorizontal className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" className="w-[200px]">
            <MenuItem onClick={() => { setNameDraft(label); setRenaming(true); }}>Rename</MenuItem>
            <MenuItem disabled={index === 0} onClick={() => move(-1)}>Move left</MenuItem>
            <MenuItem disabled={index === columns.length - 1} onClick={() => move(1)}>Move right</MenuItem>
            <MenuSeparator />
            <MenuItem disabled={columns.length <= 1} onClick={remove} className="text-rose-600 data-highlighted:text-rose-600">Delete column</MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <div className="mx-3 mb-2.5 flex h-9 items-center gap-2 overflow-hidden rounded-full bg-surface-0 px-1.5 transition-shadow focus-within:ring-1 focus-within:ring-inset focus-within:ring-line-strong dark:bg-white/[0.05] dark:focus-within:ring-white/[0.14]">
        <span className={pillEndCap} aria-hidden><IoAdd className="size-3.5" /></span>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add task"
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(false); }
            if (e.key === "Tab") { e.preventDefault(); add(true); }
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          className="w-0 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-faint"
        />
        <kbd className={pillEndCap}>
          {shortcut}
        </kbd>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {tasks.map((t) => <KanbanCard key={t._id} task={t} context="project" />)}
      </div>
    </div>
  );
}

/* ─── Overview: what the project is about, for you and the agent ─── */

function ProjectOverview({ project, tasks, onUpdate, onRequestEdit }: {
  project: Doc<"projects">;
  tasks: Doc<"tasks">[];
  onUpdate: (patch: Partial<Pick<Doc<"projects">, "name" | "description" | "notes" | "status" | "priority" | "startDate" | "dueDate" | "color" | "icon">>) => void;
  /** Opens the create/edit dialog on this project. */
  onRequestEdit: () => void;
}) {
  const [nameDraft, setNameDraft] = useState<{ id: string; v: string } | null>(null);
  const [descDraft, setDescDraft] = useState<{ id: string; v: string } | null>(null);
  const name = nameDraft?.id === project._id ? nameDraft.v : project.name;
  const description = descDraft?.id === project._id ? descDraft.v : project.description ?? "";
  const archived = project.status === "archived";
  const done = tasks.filter((t) => t.status === "done" && !t.parentTaskId).length;
  const total = tasks.filter((t) => !t.parentTaskId).length;
  const signals = useMemo(() => projectSignals(tasks), [tasks]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-8 pb-28 pt-6 lg:grid-cols-[minmax(0,1fr)_296px] lg:gap-14">
        <main className="flex min-w-0 flex-col">
          <AutoTextarea
            value={name}
            onChange={(v) => setNameDraft({ id: project._id, v })}
            onCommit={() => { const n = name.trim(); if (n && n !== project.name) onUpdate({ name: n }); }}
            placeholder="Project name"
            className="text-[26px] font-semibold leading-[1.3] tracking-[-0.015em] text-text-strong"
          />
          <AutoTextarea
            value={description}
            onChange={(v) => setDescDraft({ id: project._id, v })}
            onCommit={() => { const d = description.trim(); if (d !== (project.description ?? "")) onUpdate({ description: d || undefined }); }}
            placeholder="One line on what this project is for"
            minRows={1}
            className="mt-2 text-[15px] leading-6 text-text-secondary"
          />
          <section className="mt-8 px-2">
            <h2 className="mb-2 text-[13px] font-semibold text-text-strong">Context</h2>
            <MarkdownEditor
              docKey={project._id}
              value={project.notes ?? ""}
              onCommit={(md) => { if (md !== (project.notes ?? "")) onUpdate({ notes: md || undefined }); }}
              placeholder="Goals, links, decisions, constraints, people. Everything an agent or future you needs to pick this up."
            />
          </section>
        </main>

        <aside className="flex flex-col gap-3 lg:pt-2 [&>section:not(.meta)]:rounded-[16px] [&>section:not(.meta)]:bg-black/[0.03] [&>section:not(.meta)]:p-2 dark:[&>section:not(.meta)]:bg-white/[0.05]">
          <section>
            <RailHeading>Properties</RailHeading>
            <div className="flex flex-col gap-1">
              <PropertyRow label="Appearance">
                <button className={pill} onClick={onRequestEdit}>
                  <ProjectGlyph icon={project.icon} className="size-4" style={{ color: project.color }} />
                  {projectIcon(project.icon).label}
                </button>
              </PropertyRow>
              <PropertyRow label="Status">
                <Menu>
                  <MenuTrigger render={<button className={pill} />}>
                    <Dot color={archived ? "#71717a" : "#22c55e"} />
                    {archived ? "Archived" : "Active"}
                  </MenuTrigger>
                  <MenuPopup align="start">
                    {(["active", "archived"] as const).map((s) => (
                      <MenuItem key={s} onClick={() => onUpdate({ status: s })}>
                        <Dot color={s === "active" ? "#22c55e" : "#71717a"} />
                        {s === "active" ? "Active" : "Archived"}
                        {project.status === s && <IoCheckmarkCircle className="ml-auto size-3.5" />}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </PropertyRow>
              <PropertyRow label="Priority">
                <Menu>
                  <MenuTrigger render={<button className={project.priority ? pill : pillEmpty} />}>
                    {project.priority && <Dot color={PRIORITY_COLORS[project.priority]} />}
                    {project.priority ? PRIORITY_LABELS[project.priority] : "No priority"}
                  </MenuTrigger>
                  <MenuPopup align="start">
                    {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                      <MenuItem key={p} onClick={() => onUpdate({ priority: p })}>
                        <Dot color={PRIORITY_COLORS[p]} />
                        {PRIORITY_LABELS[p]}
                        {project.priority === p && <IoCheckmarkCircle className="ml-auto size-3.5" />}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </PropertyRow>
              <PropertyRow label="Start">
                <DatePickerPopover value={project.startDate} onChange={(d) => onUpdate({ startDate: d })}>
                  <button className={project.startDate ? pill : pillEmpty}>
                    {project.startDate ? format(parseISO(project.startDate), "EEE, MMM d") : "No start date"}
                  </button>
                </DatePickerPopover>
              </PropertyRow>
              <PropertyRow label="Due">
                <DatePickerPopover value={project.dueDate} onChange={(d) => onUpdate({ dueDate: d })}>
                  <button className={project.dueDate ? pill : pillEmpty}>
                    {project.dueDate ? format(parseISO(project.dueDate), "EEE, MMM d") : "No due date"}
                  </button>
                </DatePickerPopover>
              </PropertyRow>
            </div>
          </section>

          <section>
            <RailHeading>Progress</RailHeading>
            <div className="px-3 pb-1">
              <div className="flex items-center gap-4">
                <RadialProgress value={done} total={total} size={68} stroke={7} />
                <div className="flex flex-col text-[13px]">
                  <span className="font-medium text-text-strong">{done} of {total} done</span>
                  <span className="text-text-muted">{total === 0 ? "No tasks yet" : done === total ? "Everything is done" : `${total - done} left`}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1 text-[13px] text-text-secondary">
                {STATUS_OPTIONS.map((s) => {
                  const n = tasks.filter((t) => t.status === s.value && !t.parentTaskId).length;
                  if (!n) return null;
                  return (
                    <span key={s.value} className="flex items-center gap-2">
                      <Dot color={s.color} />
                      <span className="flex-1">{s.label}</span>
                      <span className="tabular-nums text-text-faint">{n}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          <section>
            <RailHeading>Signals</RailHeading>
            <div className="flex flex-col">
              {signals.map((s) => (
                <div key={s.label} className="grid h-9 grid-cols-[1fr_auto] items-center rounded-full px-3 text-[13px]">
                  <span className="text-text-muted">{s.label}</span>
                  <span className={`tabular-nums ${s.tone === "warn" ? "text-rose-600 dark:text-rose-400" : s.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-text-strong"}`}>{s.value}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}


/** Trailing stub that adds a column to the board. */
function AddColumn({ columns, onSave }: { columns: BoardColumn[]; onSave: (next: BoardColumn[]) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) requestAnimationFrame(() => ref.current?.focus()); }, [editing]);
  const commit = () => {
    const n = name.trim();
    setEditing(false); setName("");
    if (!n) return;
    void onSave([...columns, { id: newColumnId(n, columns), name: n }]);
  };
  return (
    <div className="flex w-[220px] shrink-0 flex-col pt-1">
      {editing ? (
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setName(""); setEditing(false); } }}
          placeholder="Column name"
          className="h-9 rounded-full bg-surface-0 px-3.5 text-[13px] text-text-strong outline-none ring-1 ring-inset ring-line-strong placeholder:text-text-faint dark:bg-white/[0.06]"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-text-faint transition-colors hover:bg-black/[0.04] hover:text-text-strong dark:hover:bg-white/[0.06]">
          <IoAdd className="size-4" /> Add column
        </button>
      )}
    </div>
  );
}
