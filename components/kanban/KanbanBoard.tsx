"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import KanbanCard from "./KanbanCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { SidebarGlyph } from "@/components/ui/sidebar-glyph";
import { Menu, MenuTrigger, MenuPopup, MenuSeparator, MenuCheckboxItem, MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { DatePickerPopover } from "@/components/tasks/TaskPropertyPopovers";
import { glassAction, glassIconButton, BOARD_COLUMN_WIDTH } from "@/lib/ui/chrome";
import {
  format, isToday, isTomorrow, isYesterday, startOfWeek, endOfWeek, addWeeks, addDays,
  endOfMonth, parseISO, isBefore, startOfDay, isSameDay, differenceInCalendarDays,
} from "date-fns";
import { getOverdueTasks } from "@/lib/task-utils";
import { useTimeboxOpen } from "@/lib/timebox-store";
import { useSettings, matchesShortcut } from "@/lib/settings";
import { useQuickAdd } from "@/lib/quick-add";
import { useUiPref } from "@/lib/ui-prefs";
import { durationMinutes } from "@/lib/time-utils";
import {
  IoCalendar,
  IoClose,
  IoChevronBack,
  IoChevronForward,
  IoAlertCircle,
  IoAddCircle,
  IoEllipsisHorizontal,
} from "react-icons/io5";
import { Folder } from "@/components/ui/folder";

/*
 * Inbox: every task, grouped by time. Two ways to look at it:
 * - Overview: Today / This week / Next week / This month buckets.
 * - Days: one column per calendar day, endless in both directions. Scroll to
 *   wherever you like; the strip grows as you approach either edge. Jump to
 *   today or any date from the header.
 */

type View = "overview" | "days";
type SortBy = "priority" | "date" | "created" | "alpha";
const SORT_LABELS: Record<SortBy, string> = {
  priority: "Priority", date: "Due date", created: "Recently added", alpha: "Alphabetical",
};

type Col = {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  /** Exact calendar day this column represents (Days view). */
  date?: string;
  /** Date given to a task created in or dropped on this column. */
  dropDate: string;
  /** Which dates belong to this column (for done tasks). */
  covers: (date: Date) => boolean;
  tasks: Doc<"tasks">[];
  overdueTasks: Doc<"tasks">[];
  isToday?: boolean;
};

const DAY_STR = (d: Date) => format(d, "yyyy-MM-dd");
const PAST_DAYS = 7;
const FUTURE_DAYS = 30;
const GROW_BY = 14;
const COLUMN_GAP = 12; // must equal the row gap and the scroll padding

export default function KanbanBoard() {
  const tasks = useQuery(api.tasks.list, {});
  const projects = useQuery(api.projects.list, { status: "active" });
  const [view, setView] = useUiPref("kanbanView");
  const [activeAdd, setActiveAdd] = useState<string | null>(null);
  const [showDone, setShowDone] = useUiPref("kanbanShowDone");
  const [sortBy, setSortBy] = useUiPref("kanbanSort");
  const [timeboxOpen, setTimeboxOpen] = useTimeboxOpen();
  const { settings } = useSettings();
  const weekStartsOn = settings.calendar.weekStartsOn;
  const sc = settings.shortcuts;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Days view window as day offsets from today. Grows when you near an edge.
  const [range, setRange] = useState({ from: -PAST_DAYS, to: FUTURE_DAYS });
  const pendingPrepend = useRef(0);

  // Project filter lives in the URL so the Filter menu and deep links agree.
  const searchParams = useSearchParams();
  const router = useRouter();
  const filterProject = searchParams.get("project");
  const dateParam = searchParams.get("date");
  const overdueView = searchParams.get("view") === "overdue";
  const setFilterProject = useCallback((id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === null) params.delete("project"); else params.set("project", id);
    const qs = params.toString();
    router.replace(qs ? `/timeline?${qs}` : "/timeline", { scroll: false });
  }, [router, searchParams]);
  const activeProject = useMemo(
    () => (filterProject ? projects?.find((p) => p._id === filterProject) ?? null : null),
    [projects, filterProject],
  );

  const sortTasks = useCallback((list: Doc<"tasks">[]) => {
    const sorted = [...list];
    switch (sortBy) {
      case "priority": { const o = { p1: 0, p2: 1, p3: 2, p4: 3 }; sorted.sort((a, b) => (o[a.priority] ?? 3) - (o[b.priority] ?? 3)); break; }
      case "date":
        sorted.sort((a, b) => {
          const c = (a.dueDate || a.scheduledDate || "9999").localeCompare(b.dueDate || b.scheduledDate || "9999");
          if (c !== 0) return c;
          return (a.dueTime || a.scheduledStartTime || "23:59").localeCompare(b.dueTime || b.scheduledStartTime || "23:59");
        });
        break;
      case "created": sorted.sort((a, b) => b._creationTime - a._creationTime); break;
      case "alpha": sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
    }
    return sorted;
  }, [sortBy]);

  const filterTasks = useCallback((list: Doc<"tasks">[]) => list.filter((t) => filterProject === null || (t.projectId || "") === filterProject), [filterProject]);

  const apply = useCallback((list: Doc<"tasks">[]) => sortTasks(filterTasks(list)), [sortTasks, filterTasks]);

  const columns = useMemo<Col[] | null>(() => {
    if (!tasks) return null;
    const now = new Date();
    const today = startOfDay(now);
    const active = tasks.filter((t) => t.status !== "done" && !t.parentTaskId);
    const overdue = getOverdueTasks(tasks).filter((t) => !t.parentTaskId);
    const dateOf = (t: Doc<"tasks">) => (t.dueDate || t.scheduledDate ? parseISO((t.dueDate || t.scheduledDate)!) : null);

    if (overdueView) {
      // Overdue plus the two most plausible landing days, so rescheduling is a drag away.
      const tomorrow = addDays(today, 1);
      const dayCol = (d: Date, title: string): Col => ({
        id: `date-${DAY_STR(d)}`, title, subtitle: format(d, "EEE, MMM d"), date: DAY_STR(d), dropDate: DAY_STR(d),
        covers: (x: Date) => isSameDay(x, d),
        tasks: active.filter((t) => { const td = dateOf(t); return !!td && isSameDay(td, d); }),
        overdueTasks: [], isToday: isToday(d),
      });
      return [
        {
          id: "overdue", title: "Overdue", subtitle: `${overdue.length} ${overdue.length === 1 ? "task" : "tasks"}`,
          dropDate: DAY_STR(today), covers: () => false, tasks: [], overdueTasks: overdue,
        },
        dayCol(today, "Today"),
        dayCol(tomorrow, "Tomorrow"),
      ];
    }

    if (view === "days") {
      return Array.from({ length: range.to - range.from + 1 }, (_, i) => {
        const idx = range.from + i;
        const day = addDays(today, idx);
        const ds = DAY_STR(day);
        return {
          id: `date-${ds}`,
          title: isToday(day) ? "Today" : isTomorrow(day) ? "Tomorrow" : isYesterday(day) ? "Yesterday" : format(day, "EEEE"),
          subtitle: format(day, "EEE, MMM d"),
          shortcut: idx >= 0 && idx < 9 ? String(idx + 1) : undefined,
          date: ds,
          dropDate: ds,
          covers: (d: Date) => isSameDay(d, day),
          tasks: active.filter((t) => { const d = dateOf(t); return !!d && isSameDay(d, day); }),
          overdueTasks: isToday(day) ? overdue : [],
          isToday: isToday(day),
        } satisfies Col;
      });
    }

    const weekStart = startOfWeek(now, { weekStartsOn });
    const weekEnd = endOfWeek(now, { weekStartsOn });
    const nextWeekStart = addWeeks(weekStart, 1);
    const nextWeekEnd = addWeeks(weekEnd, 1);
    const monthEnd = endOfMonth(now);
    const inRange = (d: Date, from: Date, to: Date) => !isBefore(d, from) && isBefore(d, addDays(to, 1));
    const coversToday = (d: Date) => isSameDay(d, today);
    const coversWeek = (d: Date) => inRange(d, addDays(today, 1), weekEnd);
    const coversNext = (d: Date) => inRange(d, nextWeekStart, nextWeekEnd);
    const coversMonth = (d: Date) => inRange(d, addDays(nextWeekEnd, 1), monthEnd);
    const bucket = (pred: (d: Date) => boolean) => active.filter((t) => { const d = dateOf(t); return !!d && pred(d); });

    return [
      { id: "today", title: "Today", subtitle: format(now, "EEE, MMM d"), shortcut: "1", dropDate: DAY_STR(today), covers: coversToday, tasks: bucket(coversToday), overdueTasks: overdue, isToday: true },
      { id: "this-week", title: "This Week", subtitle: `${format(weekStart, "MMM d")} to ${format(weekEnd, "MMM d")}`, shortcut: "2", dropDate: DAY_STR(isBefore(addDays(today, 1), addDays(weekEnd, 1)) ? addDays(today, 1) : today), covers: coversWeek, tasks: bucket(coversWeek), overdueTasks: [] },
      { id: "next-week", title: "Next Week", subtitle: `${format(nextWeekStart, "MMM d")} to ${format(nextWeekEnd, "MMM d")}`, shortcut: "3", dropDate: DAY_STR(nextWeekStart), covers: coversNext, tasks: bucket(coversNext), overdueTasks: [] },
      { id: "this-month", title: "This Month", subtitle: format(monthEnd, "MMMM"), shortcut: "4", dropDate: DAY_STR(addDays(nextWeekEnd, 1)), covers: coversMonth, tasks: bucket(coversMonth), overdueTasks: [] },
    ];
  }, [tasks, view, range, overdueView, weekStartsOn]);

  const scrollToColumn = useCallback((id: string, behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-column-id="${id}"]`);
    el?.scrollIntoView({ behavior, inline: "start", block: "nearest" });
  }, []);

  const scrollToDate = useCallback((ds: string) => {
    if (view !== "days") setView("days");
    const offset = differenceInCalendarDays(parseISO(ds), startOfDay(new Date()));
    setRange((r) => {
      if (offset >= r.from && offset <= r.to) return r;
      return { from: Math.min(r.from, offset - PAST_DAYS), to: Math.max(r.to, offset + FUTURE_DAYS) };
    });
    // Two frames: one for a possible range change to render, one for layout.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToColumn(`date-${ds}`)));
  }, [view, setView, scrollToColumn]);

  // A ?date= deep link (sidebar month picker) lands on that day in Days view.
  const lastDateParam = useRef<string | null>(null);
  useEffect(() => {
    if (!dateParam || dateParam === lastDateParam.current || !columns) return;
    lastDateParam.current = dateParam;
    const id = requestAnimationFrame(() => scrollToDate(dateParam));
    return () => cancelAnimationFrame(id);
  }, [dateParam, columns, scrollToDate]);

  // Shortcuts: Shift+O / Shift+D switch views, Shift+T goes to today, digits focus a column's add field.
  const keyBuffer = useRef("");
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (matchesShortcut(e, sc.overview)) { e.preventDefault(); setView("overview"); return; }
      if (matchesShortcut(e, sc.days)) { e.preventDefault(); setView("days"); return; }
      if (matchesShortcut(e, sc.today)) { e.preventDefault(); scrollToDate(DAY_STR(new Date())); return; }
      if (columns && matchesShortcut(e, sc.quickAdd) && !/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const first = columns.find((c) => c.shortcut === "1") ?? columns[0];
        if (first) { setActiveAdd(first.id); scrollToColumn(first.id); }
        return;
      }
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9]$/.test(e.key) && columns) {
        keyBuffer.current += e.key;
        if (keyTimer.current) clearTimeout(keyTimer.current);
        keyTimer.current = setTimeout(() => {
          const num = keyBuffer.current; keyBuffer.current = ""; keyTimer.current = null;
          const match = columns.find((c) => c.shortcut === num);
          if (match) { setActiveAdd(match.id); scrollToColumn(match.id); }
        }, 400);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (keyTimer.current) clearTimeout(keyTimer.current); };
  }, [columns, setView, scrollToDate, scrollToColumn, sc]);

  // Land on today: when the board mounts, when the view switches, and whenever
  // the route settles on the plain Inbox (no date, no overdue) again.
  const routeKey = `${overdueView ? "overdue" : "inbox"}|${dateParam ?? ""}`;
  const lastLanding = useRef("");
  useEffect(() => {
    if (!columns) return;
    const key = `${view}|${routeKey}`;
    if (lastLanding.current === key) return;
    lastLanding.current = key;
    if (dateParam) return; // the ?date= effect handles this case
    const id = requestAnimationFrame(() => {
      if (view === "days") scrollToColumn(`date-${DAY_STR(new Date())}`, "instant");
      else if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [view, routeKey, dateParam, columns, scrollToColumn]);

  // After prepending days, keep the viewport where it was.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pendingPrepend.current) return;
    const col = el.firstElementChild as HTMLElement | null;
    if (col) el.scrollLeft += pendingPrepend.current * (col.getBoundingClientRect().width + COLUMN_GAP);
    pendingPrepend.current = 0;
  }, [range.from]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || view !== "days") return;
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - 600) setRange((r) => ({ ...r, to: r.to + GROW_BY }));
    if (el.scrollLeft < 600 && !pendingPrepend.current) {
      pendingPrepend.current = GROW_BY;
      setRange((r) => ({ ...r, from: r.from - GROW_BY }));
    }
  }, [view]);

  const nudge = (dir: -1 | 1) => {
    const el = scrollRef.current;
    const col = el?.firstElementChild as HTMLElement | null;
    if (!el || !col) return;
    el.scrollBy({ left: dir * (col.getBoundingClientRect().width + COLUMN_GAP), behavior: "smooth" });
  };

  if (!columns) {
    return (
      <div className="flex-1 p-6">
        <Skeleton className="mb-6 h-8 w-48 rounded-lg" />
        <div className="flex gap-2.5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-80 flex-1 rounded-[18px]" />)}</div>
      </div>
    );
  }


  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-2">
        <div className="flex min-w-0 items-center gap-3.5">
          {filterProject !== null ? (
            <button
              onClick={() => setFilterProject(null)}
              title="Clear project filter"
              className="group inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-[14px] font-bold tracking-tight text-text-strong transition-colors hover:bg-black/[0.07] dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
            >
              <Folder open className="size-4" style={{ color: activeProject?.color ?? "#71717a" }} />
              <span className="max-w-[220px] truncate">{filterProject === "" ? "No project" : activeProject?.name ?? "Project"}</span>
              <IoClose className="size-3.5 text-text-faint transition-colors group-hover:text-text-secondary" />
            </button>
          ) : overdueView ? (
            <h1 className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-text-strong">
              <IoAlertCircle className="size-4 text-[#ef4444]" />
              Overdue
            </h1>
          ) : (
            <h1 className="text-[15px] font-bold tracking-tight text-text-strong">Inbox</h1>
          )}
          {!overdueView && (
            <Segmented
              layoutId="kanban-view"
              value={view}
              onChange={setView}
              items={[{ value: "overview", label: "Overview" }, { value: "days", label: "Days" }]}
            />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {view === "days" && !overdueView && (
            <div className="mr-1.5 flex items-center gap-1">
              <button onClick={() => nudge(-1)} aria-label="Earlier" className={glassIconButton}>
                <IoChevronBack className="size-4" />
              </button>
              <button onClick={() => scrollToDate(DAY_STR(new Date()))} className={glassAction}>Today</button>
              <button onClick={() => nudge(1)} aria-label="Later" className={glassIconButton}>
                <IoChevronForward className="size-4" />
              </button>
              <DatePickerPopover value={undefined} onChange={(d) => d && scrollToDate(d)}>
                <button aria-label="Jump to date" className={glassIconButton}>
                  <IoCalendar className="size-[15px]" />
                </button>
              </DatePickerPopover>
            </div>
          )}
          <Menu>
            <MenuTrigger render={<button aria-label="View options" className={glassIconButton} />}>
              <IoEllipsisHorizontal className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-[220px]">
              <MenuCheckboxItem checked={showDone} onCheckedChange={(v) => setShowDone(!!v)}>
                Show completed tasks
              </MenuCheckboxItem>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Sort by</MenuGroupLabel>
                <MenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                  {(Object.keys(SORT_LABELS) as SortBy[]).map((k) => (
                    <MenuRadioItem key={k} value={k}>{SORT_LABELS[k]}</MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuPopup>
          </Menu>
          {!timeboxOpen && (
            <button onClick={() => setTimeboxOpen(true)} aria-label="Show timebox" title="Show timebox" className={glassIconButton}>
              <SidebarGlyph side="right" className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Columns */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden scroll-px-3 px-3 pb-3 pt-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            isAdding={activeAdd === col.id}
            onStartAdd={() => setActiveAdd(col.id)}
            onStopAdd={() => setActiveAdd(null)}
            apply={apply}
            showDone={showDone}
            allTasks={tasks || []}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Column ─── */

function BoardColumn({ column, isAdding, onStartAdd, onStopAdd, apply, showDone, allTasks }: {
  column: Col; isAdding: boolean; onStartAdd: () => void; onStopAdd: () => void;
  apply: (list: Doc<"tasks">[]) => Doc<"tasks">[]; showDone: boolean; allTasks: Doc<"tasks">[];
}) {
  const { create: quickCreate, settings } = useQuickAdd();
  const updateTask = useMutation(api.tasks.update);
  const router = useRouter();
  const [newTitle, setNewTitle] = useState("");
  const [isOver, setIsOver] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isAdding) requestAnimationFrame(() => inputRef.current?.focus()); }, [isAdding]);

  const doneTasks = useMemo(() => {
    if (!showDone) return [];
    return allTasks.filter((t) => {
      if (t.status !== "done" || t.parentTaskId) return false;
      const ds = t.dueDate || t.scheduledDate;
      return !!ds && column.covers(parseISO(ds));
    });
  }, [showDone, allTasks, column]);

  const create = useCallback(async (open: boolean) => {
    const title = newTitle.trim() || (open ? "New task" : "");
    if (!title) return;
    const id = await quickCreate({ title, dueDate: column.dropDate });
    setNewTitle("");
    if (open) { onStopAdd(); if (id) router.push(`/task/${id}`); return; }
    inputRef.current?.focus();
    if (id) {
      try {
        const { pushLocalTaskToGoogle } = await import("@/lib/google-sync");
        const result = await pushLocalTaskToGoogle({ _id: id, title, dueDate: column.dropDate } as Doc<"tasks">);
        if (result) await updateTask({ id, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
      } catch (err) { console.warn("Auto-push failed:", err); }
    }
  }, [newTitle, column.dropDate, quickCreate, updateTask, onStopAdd, router]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    if ([...column.tasks, ...column.overdueTasks].some((t) => t._id === taskId)) return;
    await updateTask({ id: taskId as Doc<"tasks">["_id"], dueDate: column.dropDate });
  }, [column, updateTask]);

  const sortedTasks = apply(column.tasks);
  const sortedOverdue = apply(column.overdueTasks);
  // Settings: workday threshold. Hours already planned in this column.
  const threshold = settings.calendar.workdayThresholdEnabled && column.date ? settings.calendar.workdayThresholdHours : null;
  const plannedMin = threshold !== null
    ? [...column.tasks, ...column.overdueTasks].reduce((sum, t) => sum + (durationMinutes(t.scheduledStartTime, t.scheduledEndTime) ?? (t.dueTime || t.scheduledStartTime ? settings.general.defaultDurationMin : 0)), 0)
    : 0;
  const plannedH = Math.round((plannedMin / 60) * 10) / 10;
  const isPast = !!column.date && isBefore(parseISO(column.date), startOfDay(new Date()));

  return (
    <div
      data-column-id={column.id}
      className={`relative flex flex-col overflow-hidden rounded-[18px] bg-black/[0.035] dark:bg-white/[0.04] ${BOARD_COLUMN_WIDTH} ${isPast ? "opacity-70" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={onDrop}
    >
      {isOver && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
          className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand/60 bg-brand/5" />
      )}

      <div className="flex items-baseline gap-2 px-3 pb-2.5 pt-3.5">
        <span className="text-[14px] font-bold tracking-tight text-text-strong">{column.title}</span>
        {column.subtitle && <span className="text-[12px] font-medium text-text-muted">{column.subtitle}</span>}
        {threshold !== null && plannedMin > 0 && (
          <span title={`${plannedH}h planned of a ${threshold}h day`} className={`ml-auto text-[12px] font-medium tabular-nums ${plannedH > threshold ? "text-amber-600" : "text-text-faint"}`}>{plannedH}h</span>
        )}
      </div>

      <div className="mx-3 mb-2.5 flex h-9 items-center gap-2 overflow-hidden rounded-full bg-surface-0 px-1.5 transition-shadow focus-within:ring-1 focus-within:ring-inset focus-within:ring-line-strong dark:bg-white/[0.05] dark:focus-within:ring-white/[0.14]">
        <IoAddCircle className="size-6 shrink-0 text-text-faint" aria-hidden />
        <input
          ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add task"
          onFocus={onStartAdd}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); create(false); }
            if (e.key === "Tab") { e.preventDefault(); create(true); }
            if (e.key === "Escape") { e.currentTarget.blur(); onStopAdd(); }
          }}
          onBlur={() => { if (!newTitle.trim()) onStopAdd(); }}
          className="w-0 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-faint"
        />
        {column.shortcut && (
          <kbd className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[10px] font-medium text-text-faint dark:bg-white/[0.08]">
            {column.shortcut}
          </kbd>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {sortedOverdue.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[13px] font-bold text-[#ef4444]">Overdue</span>
              <span className="text-[13px] font-medium text-text-secondary">{sortedOverdue.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">{sortedOverdue.map((t) => <KanbanCard key={t._id} task={t} isOverdue />)}</div>
          </div>
        )}
        {sortedTasks.length > 0 && (
          <div className="flex flex-col gap-1.5">{sortedTasks.map((t) => <KanbanCard key={t._id} task={t} />)}</div>
        )}
        {showDone && doneTasks.length > 0 && (
          <div className="mt-4 border-t border-line-strong pt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[12px] font-medium text-text-faint">Completed</span>
              <span className="text-[12px] tabular-nums text-text-faint">{doneTasks.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">{doneTasks.map((t) => <KanbanCard key={t._id} task={t} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
