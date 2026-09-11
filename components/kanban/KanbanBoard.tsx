"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import KanbanCard, { TaskEditDialog } from "./KanbanCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd } from "@/components/ui/kbd";
import {
  Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator, MenuCheckboxItem,
} from "@/components/ui/menu";
import { IoArrowDownCircle, IoFilterCircle, IoCheckmarkCircle } from "react-icons/io5";
import { Segmented } from "@/components/ui/segmented";
import { glassAction, glassActionActive, bluePill } from "@/lib/ui/chrome";
import {
  format, isToday, startOfWeek, endOfWeek, addWeeks, addDays,
  isWithinInterval, startOfMonth, endOfMonth,
  parseISO, isBefore, startOfDay, isSameDay, isSameMonth,
} from "date-fns";
import { isGoogleCalEvent, getOverdueTasks, getTasksForDate } from "@/lib/task-utils";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";

type Col = {
  id: string;
  title: string;
  subtitle?: string;
  shortcut: string;
  tasks: Doc<"tasks">[];
  overdueTasks: Doc<"tasks">[];
  doneTasks: Doc<"tasks">[];
};

type SortBy = "priority" | "date" | "created" | "alpha";
type FilterPriority = Set<string>;

const SORT_LABELS: Record<SortBy, string> = {
  priority: "Priority", date: "Due date", created: "Recently added", alpha: "Alphabetical",
};

export default function KanbanBoard() {
  const tasks = useQuery(api.tasks.list, {});
  const projects = useQuery(api.projects.list, { status: "active" });
  const [view, setViewRaw] = useState<"overview" | "d" | "w" | "m">(() => {
    if (typeof window === "undefined") return "overview";
    return (localStorage.getItem("unifocus:kanban:view") as "overview" | "d" | "w" | "m") || "overview";
  });
  const setView = useCallback((v: "overview" | "d" | "w" | "m") => {
    setViewRaw(v);
    try { localStorage.setItem("unifocus:kanban:view", v); } catch {}
  }, []);
  const [activeAdd, setActiveAdd] = useState<string | null>(null);
  const [showDone, setShowDoneRaw] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("unifocus:kanban:showDone") === "true";
  });
  const setShowDone = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setShowDoneRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try { localStorage.setItem("unifocus:kanban:showDone", String(next)); } catch {}
      return next;
    });
  }, []);
  const [sortBy, setSortByRaw] = useState<SortBy>(() => {
    if (typeof window === "undefined") return "priority";
    return (localStorage.getItem("unifocus:kanban:sort") as SortBy) || "priority";
  });
  const setSortBy = useCallback((v: SortBy) => {
    setSortByRaw(v);
    try { localStorage.setItem("unifocus:kanban:sort", v); } catch {}
  }, []);
  const [filterPriority, setFilterPriority] = useState<FilterPriority>(new Set(["p1", "p2", "p3", "p4"]));
  const [filterProject, setFilterProject] = useState<string | null>(null); // null = all
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sort function
  const sortTasks = useCallback((list: Doc<"tasks">[]) => {
    const sorted = [...list];
    switch (sortBy) {
      case "priority": {
        const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
        sorted.sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3));
        break;
      }
      case "date":
        sorted.sort((a, b) => {
          const da = a.dueDate || a.scheduledDate || "9999";
          const db = b.dueDate || b.scheduledDate || "9999";
          const dateCmp = da.localeCompare(db);
          if (dateCmp !== 0) return dateCmp;
          // Same date — sort by time (dueTime or scheduledStartTime)
          const ta = a.dueTime || a.scheduledStartTime || "23:59";
          const tb = b.dueTime || b.scheduledStartTime || "23:59";
          return ta.localeCompare(tb);
        });
        break;
      case "created":
        sorted.sort((a, b) => b._creationTime - a._creationTime);
        break;
      case "alpha":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return sorted;
  }, [sortBy]);

  // Filter function
  const filterTasks = useCallback((list: Doc<"tasks">[]) => {
    return list.filter((t) => {
      if (!filterPriority.has(t.priority)) return false;
      if (filterProject !== null && (t.projectId || "") !== filterProject) return false;
      return true;
    });
  }, [filterPriority, filterProject]);

  const apply = useCallback((list: Doc<"tasks">[]) => sortTasks(filterTasks(list)), [sortTasks, filterTasks]);

  // Build columns based on view
  const columns = useMemo(() => {
    if (!tasks) return null;
    const now = new Date();
    const today = startOfDay(now);
    const active = tasks.filter((t) => t.status !== "done");
    const overdue = getOverdueTasks(tasks);

    if (view === "d") {
      // Day view — 4 columns (Morning/Afternoon/Evening/Night) with hour blocks inside
      const buckets: Record<string, Doc<"tasks">[]> = { morning: [], afternoon: [], evening: [], night: [] };
      const todayActive = getTasksForDate(tasks, now);

      for (const t of todayActive) {
        const time = (t as Record<string, unknown>).dueTime as string || t.scheduledStartTime || "";
        const hour = time ? parseInt(time.split(":")[0], 10) : 9;
        if (hour >= 6 && hour < 12) buckets.morning.push(t);
        else if (hour >= 12 && hour < 17) buckets.afternoon.push(t);
        else if (hour >= 17 && hour < 21) buckets.evening.push(t);
        else buckets.night.push(t);
      }

      return [
        { id: "morning", title: "Morning", subtitle: "6am – 12pm", shortcut: "1", tasks: buckets.morning, overdueTasks: overdue, doneTasks: [] },
        { id: "afternoon", title: "Afternoon", subtitle: "12pm – 5pm", shortcut: "2", tasks: buckets.afternoon, overdueTasks: [], doneTasks: [] },
        { id: "evening", title: "Evening", subtitle: "5pm – 9pm", shortcut: "3", tasks: buckets.evening, overdueTasks: [], doneTasks: [] },
        { id: "night", title: "Night", subtitle: "9pm – 6am", shortcut: "4", tasks: buckets.night, overdueTasks: [], doneTasks: [] },
      ] as Col[];
    }

    if (view === "w") {
      // Week view — 7 days starting Monday
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const todayIdx = Math.max(0, Math.floor((today.getTime() - weekStart.getTime()) / 86400000));

      return Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weekStart, i);
        return {
          id: `day-${i}`,
          title: format(day, "EEE"),
          subtitle: format(day, "MMM d"),
          shortcut: String(i + 1),
          tasks: getTasksForDate(tasks, day),
          overdueTasks: i === todayIdx ? overdue : [],
          doneTasks: [],
        } as Col;
      });
    }

    if (view === "m") {
      // Month view — every day of the month
      const mStart = startOfMonth(now);
      const daysInMonth = endOfMonth(now).getDate();
      const todayDayIdx = isSameMonth(now, mStart) ? today.getDate() - 1 : -1;

      return Array.from({ length: daysInMonth }, (_, i) => {
        const day = addDays(mStart, i);
        return {
          id: `mday-${i}`,
          title: format(day, "EEE"),
          subtitle: format(day, "MMM d"),
          shortcut: String(i + 1),
          tasks: getTasksForDate(tasks, day),
          overdueTasks: i === todayDayIdx ? overdue : [],
          doneTasks: [],
        } as Col;
      });
    }

    // Overview — Today / This Week / Next Week / This Month
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const nextWeekStart = addWeeks(weekStart, 1);
    const nextWeekEnd = addWeeks(weekEnd, 1);
    const monthEnd = endOfMonth(now);
    const afterNextWeek = addDays(nextWeekEnd, 1);

    const todayTasks: Doc<"tasks">[] = [];
    const thisWeekTasks: Doc<"tasks">[] = [];
    const nextWeekTasks: Doc<"tasks">[] = [];
    const thisMonthTasks: Doc<"tasks">[] = [];

    for (const t of active) {
      const ds = t.dueDate || t.scheduledDate;
      if (!ds) continue;
      const d = parseISO(ds);

      if (isBefore(d, today) && !isToday(d)) continue; // overdue handled by shared fn
      if (isToday(d)) todayTasks.push(t);
      else if (isBefore(d, addDays(weekEnd, 1)) && !isBefore(d, today)) thisWeekTasks.push(t);
      else if (isBefore(d, addDays(nextWeekEnd, 1)) && !isBefore(d, nextWeekStart)) nextWeekTasks.push(t);
      else if (isBefore(d, addDays(monthEnd, 1)) && !isBefore(d, afterNextWeek)) thisMonthTasks.push(t);
    }

    return [
      { id: "today", title: "Today", subtitle: format(now, "MMM d"), shortcut: "1", tasks: todayTasks, overdueTasks: overdue, doneTasks: [] },
      { id: "this-week", title: "This Week", subtitle: `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d")}`, shortcut: "2", tasks: thisWeekTasks, overdueTasks: [], doneTasks: [] },
      { id: "next-week", title: "Next Week", subtitle: `${format(nextWeekStart, "MMM d")} – ${format(nextWeekEnd, "MMM d")}`, shortcut: "3", tasks: nextWeekTasks, overdueTasks: [], doneTasks: [] },
      { id: "this-month", title: "This Month", subtitle: format(monthEnd, "MMM yyyy"), shortcut: "4", tasks: thisMonthTasks, overdueTasks: [], doneTasks: [] },
    ] as Col[];
  }, [tasks, view]);

  // Keyboard shortcuts
  // Shift+O/D/W/M = switch views
  // Number keys = debounced buffer for column shortcuts (handles 2 vs 22, etc.)
  const keyBuffer = useRef("");
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 400;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // View switching with Shift
      if (e.shiftKey) {
        const key = e.key.toUpperCase();
        if (key === "O") { e.preventDefault(); setView("overview"); return; }
        if (key === "D") { e.preventDefault(); setView("d"); return; }
        if (key === "W") { e.preventDefault(); setView("w"); return; }
        if (key === "M") { e.preventDefault(); setView("m"); return; }
      }

      // Number keys — debounced buffer
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9]$/.test(e.key) && columns) {
        keyBuffer.current += e.key;

        // Clear any pending timer
        if (keyTimer.current) clearTimeout(keyTimer.current);

        // Set new timer — when it fires, resolve the buffered number
        keyTimer.current = setTimeout(() => {
          const num = keyBuffer.current;
          keyBuffer.current = "";
          keyTimer.current = null;

          const match = columns.find((c) => c.shortcut === num);
          if (match) setActiveAdd(match.id);
        }, DEBOUNCE_MS);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (keyTimer.current) clearTimeout(keyTimer.current);
    };
  }, [columns]);

  // Auto-scroll to today's column in week/month views
  useEffect(() => {
    if ((view !== "w" && view !== "m") || !columns || !scrollContainerRef.current) return;
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todayIdx = columns.findIndex((col) => {
      // For week view (day-N) or month view (mday-N), compute the date
      if (col.id.startsWith("day-")) {
        const i = parseInt(col.id.split("-")[1], 10);
        const day = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i);
        return isSameDay(day, new Date());
      }
      if (col.id.startsWith("mday-")) {
        const i = parseInt(col.id.split("-")[1], 10);
        const day = addDays(startOfMonth(new Date()), i);
        return isSameDay(day, new Date());
      }
      return false;
    });
    if (todayIdx < 0) return;
    // Find the column element by data-column-id
    const container = scrollContainerRef.current;
    const colEl = container.querySelector(`[data-column-id="${columns[todayIdx].id}"]`);
    if (colEl) {
      setTimeout(() => {
        colEl.scrollIntoView({ behavior: "smooth", inline: "start" });
      }, 50);
    }
  }, [view, columns]);

  if (!columns) {
    return (
      <div className="flex-1 p-6">
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="flex gap-0">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-80 flex-1" />)}</div>
      </div>
    );
  }

  const views = [
    { id: "overview" as const, label: "Overview", shortcut: "⇧O" },
    { id: "d" as const, label: "D", shortcut: "⇧D" },
    { id: "w" as const, label: "W", shortcut: "⇧W" },
    { id: "m" as const, label: "M", shortcut: "⇧M" },
  ];

  function togglePriority(p: string) {
    setFilterPriority((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  const isFiltered = filterPriority.size < 4 || filterProject !== null;
  const filterCount = (filterPriority.size < 4 ? 1 : 0) + (filterProject !== null ? 1 : 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-5 py-2">
        <div className="flex items-center gap-3.5">
          <h1 className="text-[15px] font-bold tracking-tight text-text-strong">Upcoming</h1>
          <Segmented
            layoutId="kanban-view"
            value={view}
            onChange={setView}
            items={views.map((v) => ({ value: v.id, label: v.label, title: v.label }))}
          />
        </div>

        {/* Sort + Filter */}
        <div className="flex items-center gap-1.5">
          {/* Sort */}
          <Menu>
            <MenuTrigger render={
              <button className={glassAction} />
            }>
              <IoArrowDownCircle className="size-[15px]" />
              <span>Sort</span>
            </MenuTrigger>
            <MenuPopup>
              {(Object.keys(SORT_LABELS) as SortBy[]).map((s) => (
                <MenuItem key={s} onClick={() => setSortBy(s)}>
                  {SORT_LABELS[s]}
                  {sortBy === s && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>

          {/* Filter */}
          <Menu>
            <MenuTrigger render={
              <button className={`${glassAction} ${isFiltered ? glassActionActive : ""}`} />
            }>
              <IoFilterCircle className="size-[15px]" />
              <span>Filter</span>
              {filterCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold tabular-nums text-white">
                  {filterCount}
                </span>
              )}
            </MenuTrigger>
            <MenuPopup>
              <MenuItem className="text-xs font-semibold text-muted-foreground pointer-events-none">Priority</MenuItem>
              {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                <MenuCheckboxItem key={p} checked={filterPriority.has(p)} onCheckedChange={() => togglePriority(p)}>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                  {PRIORITY_LABELS[p]}
                </MenuCheckboxItem>
              ))}
              {projects && projects.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuItem className="text-xs font-semibold text-muted-foreground pointer-events-none">Project</MenuItem>
                  <MenuItem onClick={() => setFilterProject(null)}>
                    All projects
                    {filterProject === null && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                  </MenuItem>
                  <MenuItem onClick={() => setFilterProject("")}>
                    No project
                    {filterProject === "" && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                  </MenuItem>
                  {projects.map((p) => (
                    <MenuItem key={p._id} onClick={() => setFilterProject(p._id)}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.name}
                      {filterProject === p._id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                    </MenuItem>
                  ))}
                </>
              )}
              {isFiltered && (
                <>
                  <MenuSeparator />
                  <MenuItem onClick={() => { setFilterPriority(new Set(["p1", "p2", "p3", "p4"])); setFilterProject(null); }}>
                    Clear all filters
                  </MenuItem>
                </>
              )}
            </MenuPopup>
          </Menu>

          {/* Show-done toggle — brand fill when on for clear on/off feedback */}
          <button
            onClick={() => setShowDone(!showDone)}
            aria-pressed={showDone}
            className={showDone ? bluePill : glassAction}
          >
            <IoCheckmarkCircle className="size-[15px]" />
            <span>Done</span>
          </button>
        </div>
      </div>

      {/* Columns — week/month views scroll horizontally with hidden scrollbar */}
      <div
        ref={scrollContainerRef}
        className={`flex flex-1 gap-2.5 overflow-hidden px-3 pb-3 pt-1 ${
          view === "w" || view === "m"
            ? "overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            : ""
        }`}
      >
        {columns.map((col) => (
          <UpcomingColumn
            key={col.id}
            column={col}
            isAdding={activeAdd === col.id}
            onStartAdd={() => setActiveAdd(col.id)}
            onStopAdd={() => setActiveAdd(null)}
            applySort={apply}
            view={view}
            showDone={showDone}
            allTasks={tasks || []}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Time mappings for day-view quarters ─── */
const QUARTER_START_TIMES: Record<string, string> = {
  morning: "06:00", afternoon: "12:00", evening: "17:00", night: "21:00",
};

const PERIOD_HOURS: Record<string, number[]> = {
  morning: [6, 7, 8, 9, 10, 11],
  afternoon: [12, 13, 14, 15, 16],
  evening: [17, 18, 19, 20],
  night: [21, 22, 23],
};

function formatHour(h: number): string {
  if (h === 0) return "12 am";
  if (h < 12) return `${h} am`;
  if (h === 12) return "12 pm";
  return `${h - 12} pm`;
}

/** Renders tasks grouped by hour blocks inside a day-view column */
function DayViewHourBlocks({ tasks, columnId }: { tasks: Doc<"tasks">[]; columnId: string }) {
  const hours = PERIOD_HOURS[columnId] || [];
  const now = new Date();
  const currentHour = now.getHours();

  // Group tasks by hour
  const tasksByHour = new Map<number, Doc<"tasks">[]>();
  for (const h of hours) tasksByHour.set(h, []);

  // Tasks without a matching hour go into the first hour
  const unslotted: Doc<"tasks">[] = [];
  for (const t of tasks) {
    const time = (t as Record<string, unknown>).dueTime as string || t.scheduledStartTime || "";
    const hour = time ? parseInt(time.split(":")[0], 10) : -1;
    const bucket = tasksByHour.get(hour);
    if (bucket) bucket.push(t);
    else unslotted.push(t);
  }
  // Put unslotted into first hour
  if (unslotted.length > 0 && hours.length > 0) {
    const first = tasksByHour.get(hours[0])!;
    first.push(...unslotted);
  }

  return (
    <div className="flex flex-col">
      {hours.map((h) => {
        const hourTasks = tasksByHour.get(h) || [];
        const isCurrentHour = h === currentHour;

        return (
          <div key={h} className="relative">
            {/* Hour label with dashed line */}
            <div className="flex items-center gap-2 py-1.5">
              <span className={`shrink-0 text-[11px] font-medium tabular-nums ${isCurrentHour ? "text-brand" : "text-text-faint"}`}>
                {formatHour(h)}
              </span>
              <div className={`h-px flex-1 ${isCurrentHour ? "border-t border-dashed border-brand/40" : "border-t border-dashed border-line-strong"}`} />
            </div>

            {/* Tasks in this hour */}
            {hourTasks.length > 0 && (
              <div className="flex flex-col gap-1.5 pb-1">
                {hourTasks.map((t) => (
                  <KanbanCard key={t._id} task={t} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Column ─── */
function UpcomingColumn({ column, isAdding, onStartAdd, onStopAdd, applySort, view, showDone, allTasks }: {
  column: Col; isAdding: boolean;
  onStartAdd: () => void; onStopAdd: () => void;
  applySort: (list: Doc<"tasks">[]) => Doc<"tasks">[];
  view: string;
  showDone: boolean;
  allTasks: Doc<"tasks">[];
}) {
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const [newTitle, setNewTitle] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // isAdding is now only a focus signal (e.g. from the number-key shortcut).
  useEffect(() => {
    if (isAdding) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isAdding]);

  // Compute default due date for this column
  const defaultDueDate = useMemo(() => {
    const now = new Date();
    if (column.id === "today" || column.id === "morning" || column.id === "afternoon" || column.id === "evening" || column.id === "night") {
      return format(now, "yyyy-MM-dd");
    } else if (column.id === "this-week") {
      return format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
    } else if (column.id === "next-week") {
      return format(addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1), "yyyy-MM-dd");
    } else if (column.id === "this-month") {
      return format(endOfMonth(now), "yyyy-MM-dd");
    } else if (column.id.startsWith("mday-")) {
      const dayIdx = parseInt(column.id.split("-")[1], 10);
      return format(addDays(startOfMonth(now), dayIdx), "yyyy-MM-dd");
    } else if (column.id.startsWith("day-")) {
      const dayIdx = parseInt(column.id.split("-")[1], 10);
      return format(addDays(startOfWeek(now, { weekStartsOn: 1 }), dayIdx), "yyyy-MM-dd");
    }
    return format(now, "yyyy-MM-dd");
  }, [column.id]);

  // Done tasks for this column — tasks matching this column's date range that are done
  const doneTasks = useMemo(() => {
    if (!showDone) return [];
    const now = new Date();
    const today = startOfDay(now);
    const ws = startOfWeek(now, { weekStartsOn: 1 });
    const we = endOfWeek(now, { weekStartsOn: 1 });
    const nws = addWeeks(ws, 1);
    const nwe = addWeeks(we, 1);
    const me = endOfMonth(now);

    return allTasks.filter((t) => {
      if (t.status !== "done") return false;
      const ds = t.dueDate || t.scheduledDate;
      if (!ds) return false;
      const d = parseISO(ds);

      // Specific day columns — exact day match
      if (column.id.startsWith("day-") || column.id.startsWith("mday-") || column.id === "today") {
        return isSameDay(d, parseISO(defaultDueDate));
      }
      // Range columns — same logic as active task bucketing
      if (column.id === "this-week") {
        return isWithinInterval(d, { start: today, end: we }) && !isToday(d);
      }
      if (column.id === "next-week") {
        return isWithinInterval(d, { start: nws, end: nwe });
      }
      if (column.id === "this-month") {
        return isWithinInterval(d, { start: nwe, end: me });
      }
      // Day-view quarters — today only
      if (["morning", "afternoon", "evening", "night"].includes(column.id)) {
        return isSameDay(d, today);
      }
      return false;
    });
  }, [showDone, allTasks, column.id, defaultDueDate]);

  const handleQuickAdd = useCallback(async () => {
    if (!newTitle.trim()) return;
    const quarterTime = QUARTER_START_TIMES[column.id];
    const newTaskId = await createTask({
      title: newTitle.trim(),
      dueDate: defaultDueDate,
      userDate: format(new Date(), "yyyy-MM-dd"),
      ...(quarterTime ? { dueTime: quarterTime } : {}),
    });
    setNewTitle("");
    inputRef.current?.focus();
    // Auto-push to Google Calendar
    if (newTaskId && defaultDueDate) {
      try {
        const { pushLocalTaskToGoogle } = await import("@/lib/google-sync");
        const result = await pushLocalTaskToGoogle({ _id: newTaskId, title: newTitle.trim(), dueDate: defaultDueDate } as Doc<"tasks">);
        if (result) await updateTask({ id: newTaskId, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId } as Parameters<typeof updateTask>[0]);
      } catch (err) { console.warn("Auto-push failed:", err); }
    }
  }, [newTitle, defaultDueDate, createTask, updateTask]);

  // ── Drop handlers ──
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);

    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    // Check if task already belongs to this column — skip update if so
    const allColumnTasks = [...column.tasks, ...column.overdueTasks];
    if (allColumnTasks.some((t) => t._id === taskId)) return;

    // For range columns (today, this-week, this-month), use today's date
    // since past days don't matter. For specific-day columns, use exact date.
    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");

    let targetDate: string;
    if (column.id === "today" || column.id === "this-week" || column.id === "this-month") {
      // Range columns: anchor to today
      targetDate = todayStr;
    } else if (column.id === "next-week") {
      // Next week: set to Monday of next week
      targetDate = defaultDueDate;
    } else {
      // Specific day columns (day-N, mday-N) or day quarters: use exact date
      targetDate = defaultDueDate;
    }

    const update: Record<string, unknown> = {
      id: taskId,
      dueDate: targetDate,
    };

    // Day view quarters: also set the time
    const startTime = QUARTER_START_TIMES[column.id];
    if (startTime) {
      update.dueTime = startTime;
    }

    await updateTask(update as Parameters<typeof updateTask>[0]);
  }, [defaultDueDate, column, updateTask]);

  const sortedTasks = applySort(column.tasks);
  const sortedOverdue = applySort(column.overdueTasks);

  const hasOverdue = sortedOverdue.length > 0;

  // Week/month views: fixed width per column (4 visible = 25% each)
  const widthClass = (view === "w" || view === "m") ? "w-[25%] min-w-[25%] shrink-0" : "min-w-[260px] flex-1";

  return (
    <div
      data-column-id={column.id}
      className={`relative flex flex-col overflow-hidden rounded-[18px] bg-black/[0.035] dark:bg-white/[0.04] ${widthClass}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop zone indicator */}
      {isOver && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand/60 bg-brand/5"
        />
      )}

      {/* Header */}
      <div className="flex items-baseline gap-2 px-3 pb-2.5 pt-3.5">
        <span className="text-[14px] font-bold tracking-tight text-text-strong">{column.title}</span>
        {column.subtitle && <span className="text-[12px] font-medium text-text-muted">{column.subtitle}</span>}
      </div>

      {/* Add task — a persistent pill text input (Enter adds, Tab opens full editor) */}
      <div className="mx-3 mb-2.5 flex items-center gap-2 rounded-full bg-surface-0 px-3.5 py-2 transition-shadow focus-within:ring-1 focus-within:ring-inset focus-within:ring-line-strong dark:bg-white/[0.05] dark:focus-within:ring-white/[0.14]">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-text-faint"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>
        <input
          ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add task"
          onFocus={onStartAdd}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleQuickAdd(); }
            if (e.key === "Tab") { e.preventDefault(); setCreateDialogOpen(true); }
            if (e.key === "Escape") { e.currentTarget.blur(); onStopAdd(); }
          }}
          onBlur={() => { if (!newTitle.trim()) onStopAdd(); }}
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-faint"
        />
        {column.shortcut && <Kbd className="shrink-0">{column.shortcut}</Kbd>}
      </div>

      {/* Tasks */}
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {hasOverdue && (
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-[#ef4444]">Overdue</span>
                <span className="text-[13px] font-medium text-text-secondary">{sortedOverdue.length}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {sortedOverdue.map((t) => <KanbanCard key={t._id} task={t} isOverdue />)}
            </div>
          </div>
        )}

        {/* Tasks — grouped by hour in day view, flat otherwise */}
        {sortedTasks.length > 0 && (
          view === "d" ? (
            <DayViewHourBlocks tasks={sortedTasks} columnId={column.id} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {sortedTasks.map((t) => (
                <KanbanCard key={t._id} task={t} />
              ))}
            </div>
          )
        )}

        {/* Done tasks */}
        {showDone && doneTasks.length > 0 && (
          <div className="mt-4 border-t border-line-strong pt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[12px] font-medium text-text-faint">Completed</span>
              <span className="flex size-[16px] items-center justify-center rounded-full border border-line-strong text-[9px] font-medium text-text-faint">
                {doneTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {doneTasks.map((t) => <KanbanCard key={t._id} task={t} />)}
            </div>
          </div>
        )}

      </div>

      {/* Full create dialog */}
      <TaskEditDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} defaultDueDate={defaultDueDate} />
    </div>
  );
}
