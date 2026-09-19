"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "@/components/ui/menu";
import { DatePickerPopover } from "@/components/tasks/TaskPropertyPopovers";
import { ProjectMenuItems, DeleteProjectDialog } from "@/components/projects/ProjectActions";
import { RailHeading, PropertyRow, Dot } from "@/components/ui/property-rail";
import { glassIconButton, glassAction, softPill as pill, emptyPill as pillEmpty, BOARD_COLUMN_WIDTH } from "@/lib/ui/chrome";
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_OPTIONS, type TaskStatus } from "@/lib/constants";
import { format, parseISO } from "date-fns";
import { useQuickAdd } from "@/lib/quick-add";
import {
  IoArrowDown,
  IoCheckmarkCircle,
  IoEllipsisHorizontal,
  IoAddCircle,
} from "react-icons/io5";
import { Folder } from "@/components/ui/folder";

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
  const [sortBy, setSortBy] = useState<SortBy>("priority");
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Doc<"tasks">[]>();
    for (const s of STATUS_OPTIONS) map.set(s.value, []);
    for (const t of tasks ?? []) if (!t.parentTaskId) map.get(t.status)?.push(t);
    return map;
  }, [tasks]);

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
          <h1 className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight text-text-strong">
            <Folder open className="size-[18px]" style={{ color: project.color }} />
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
              <ProjectMenuItems project={project} onRequestDelete={() => setDeleteOpen(true)} />
            </MenuPopup>
          </Menu>
        </div>
      </div>

      {tab === "board" ? (
        <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden scroll-px-3 px-3 pb-3 pt-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {STATUS_OPTIONS.map((s) => (
            <StatusColumn
              key={s.value}
              status={s.value}
              label={s.label}
              color={s.color}
              tasks={sort(byStatus.get(s.value) ?? [])}
              projectId={project._id}
              defaultDueDate={project.dueDate}
            />
          ))}
        </div>
      ) : (
        <ProjectOverview project={project} tasks={tasks} onUpdate={(patch) => updateProject({ id: project._id, ...patch })} />
      )}

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

function StatusColumn({ status, label, color, tasks, projectId, defaultDueDate }: {
  status: TaskStatus;
  label: string;
  color: string;
  tasks: Doc<"tasks">[];
  projectId: Id<"projects">;
  defaultDueDate?: string;
}) {
  const { create: quickCreate } = useQuickAdd();
  const updateTask = useMutation(api.tasks.update);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [isOver, setIsOver] = useState(false);
  const counter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useCallback(async (open: boolean) => {
    const t = title.trim();
    if (!t && !open) return;
    const id = await quickCreate({ title: t || "New task", status, projectId, dueDate: defaultDueDate });
    setTitle("");
    if (open && id) router.push(`/task/${id}`);
    else inputRef.current?.focus();
  }, [title, status, projectId, defaultDueDate, quickCreate, router]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    counter.current = 0;
    setIsOver(false);
    const id = e.dataTransfer.getData("text/plain") as Id<"tasks">;
    if (!id || tasks.some((t) => t._id === id)) return;
    await updateTask({ id, status, projectId });
  }, [tasks, status, projectId, updateTask]);

  return (
    <div
      data-column-id={status}
      className={`relative flex flex-col overflow-hidden rounded-[18px] bg-black/[0.035] dark:bg-white/[0.04] ${BOARD_COLUMN_WIDTH}`}
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
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-3.5">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[14px] font-bold tracking-tight text-text-strong">{label}</span>
        <span className="text-[12px] font-medium text-text-muted">{tasks.length}</span>
      </div>

      <div className="mx-3 mb-2.5 flex h-9 items-center gap-2 overflow-hidden rounded-full bg-surface-0 px-1.5 transition-shadow focus-within:ring-1 focus-within:ring-inset focus-within:ring-line-strong dark:bg-white/[0.05] dark:focus-within:ring-white/[0.14]">
        <IoAddCircle className="size-6 shrink-0 text-text-faint" aria-hidden />
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
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {tasks.map((t) => <KanbanCard key={t._id} task={t} context="project" />)}
      </div>
    </div>
  );
}

/* ─── Overview: what the project is about, for you and the agent ─── */

function ProjectOverview({ project, tasks, onUpdate }: {
  project: Doc<"projects">;
  tasks: Doc<"tasks">[];
  onUpdate: (patch: Partial<Pick<Doc<"projects">, "name" | "description" | "notes" | "status" | "priority" | "startDate" | "dueDate" | "color">>) => void;
}) {
  const [nameDraft, setNameDraft] = useState<{ id: string; v: string } | null>(null);
  const [descDraft, setDescDraft] = useState<{ id: string; v: string } | null>(null);
  const name = nameDraft?.id === project._id ? nameDraft.v : project.name;
  const description = descDraft?.id === project._id ? descDraft.v : project.description ?? "";
  const archived = project.status === "archived";
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.filter((t) => !t.parentTaskId).length;

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
          <section className="mt-8">
            <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-text-faint">Context</h2>
            <MarkdownEditor
              docKey={project._id}
              value={project.notes ?? ""}
              onCommit={(md) => { if (md !== (project.notes ?? "")) onUpdate({ notes: md || undefined }); }}
              placeholder="Goals, links, decisions, constraints, people. Everything an agent or future you needs to pick this up."
            />
          </section>
        </main>

        <aside className="flex flex-col gap-7 lg:pt-2">
          <section>
            <RailHeading>Properties</RailHeading>
            <div className="flex flex-col gap-1">
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
            <div className="px-3">
              <div className="mb-2 flex items-baseline justify-between text-[13px]">
                <span className="text-text-muted">{done} of {total} done</span>
                <span className="tabular-nums text-text-faint">{total ? Math.round((done / total) * 100) : 0}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
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
        </aside>
      </div>
    </div>
  );
}
