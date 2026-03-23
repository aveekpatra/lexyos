"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import KanbanCard, { TaskEditDialog } from "./KanbanCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator, MenuCheckboxItem,
} from "@/components/ui/menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon, SortingAZ01Icon } from "@hugeicons/core-free-icons";
import {
  format, isToday, startOfWeek, endOfWeek, addWeeks, addDays,
  isWithinInterval, startOfMonth, endOfMonth,
  parseISO, isBefore, startOfDay, isSameDay, isSameMonth,
} from "date-fns";
import { isGoogleCalEvent, getOverdueTasks, getTasksForDate } from "@/lib/task-utils";

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
  const [view, setView] = useState<"overview" | "d" | "w" | "m">("overview");
  const [activeAdd, setActiveAdd] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("priority");
  const [filterPriority, setFilterPriority] = useState<FilterPriority>(new Set(["p1", "p2", "p3", "p4"]));
  const [filterProject, setFilterProject] = useState<string | null>(null); // null = all

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
          return da.localeCompare(db);
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
      // Day view — Morning / Afternoon / Evening / Night
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#2a2a32] px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-[15px] font-bold tracking-tight text-white">Upcoming</h1>
          <div className="relative flex items-center rounded-[10px] border border-[#2a2a36] bg-[#131318] p-[3px] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`relative z-10 rounded-[7px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  view === v.id ? "text-white" : "text-[#71717a] hover:text-[#a1a1aa]"
                }`}
              >
                {view === v.id && (
                  <motion.div
                    layoutId="view-tab-indicator"
                    className="absolute inset-0 rounded-[7px] border border-[#3a3a4a] bg-[#2a2a38] shadow-[0_1px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sort + Filter */}
        <div className="flex items-center gap-2">
          {/* Sort */}
          <Menu>
            <MenuTrigger render={
              <button className="inline-flex h-7 items-center gap-1.5 rounded-[10px] border border-[#2a2a36] bg-[#131318] px-2.5 text-xs font-medium text-[#a1a1aa] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#3a3a4a] hover:text-white" />
            }>
              <HugeiconsIcon icon={SortingAZ01Icon} size={13} />
              <span>{SORT_LABELS[sortBy]}</span>
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
              <button className={`inline-flex h-7 items-center gap-1.5 rounded-[10px] border bg-[#131318] px-2.5 text-xs font-medium shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#3a3a4a] hover:text-white ${
                isFiltered ? "border-[#a78bfa]/30 text-[#a78bfa]" : "border-[#2a2a36] text-[#a1a1aa]"
              }`} />
            }>
              <HugeiconsIcon icon={FilterIcon} size={13} />
              <span>{isFiltered ? "Filtered" : "Filter"}</span>
            </MenuTrigger>
            <MenuPopup>
              <MenuItem className="text-xs font-semibold text-muted-foreground pointer-events-none">Priority</MenuItem>
              {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                <MenuCheckboxItem key={p} checked={filterPriority.has(p)} onCheckedChange={() => togglePriority(p)}>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: { p1: "#f87171", p2: "#fb923c", p3: "#a78bfa", p4: "#a1a1aa" }[p] }} />
                  {{ p1: "Urgent", p2: "High", p3: "Medium", p4: "Low" }[p]}
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

          {/* Show done toggle */}
          <button
            onClick={() => setShowDone(!showDone)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-[10px] border bg-[#131318] px-2.5 text-xs font-medium shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#3a3a4a] hover:text-white ${
              showDone ? "border-[#a78bfa]/30 text-[#a78bfa]" : "border-[#2a2a36] text-[#a1a1aa]"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6l3 3 5-5" />
            </svg>
            <span>Done</span>
          </button>
        </div>
      </div>

      {/* Columns — week/month views scroll horizontally with hidden scrollbar */}
      <div
        className={`flex flex-1 ${
          view === "w" || view === "m"
            ? "overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            : ""
        }`}
      >
        {columns.map((col, idx) => (
          <UpcomingColumn
            key={col.id}
            column={col}
            isLast={idx === columns.length - 1}
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

/* ─── Column ─── */
function UpcomingColumn({ column, isLast, isAdding, onStartAdd, onStopAdd, applySort, view, showDone, allTasks }: {
  column: Col; isLast: boolean; isAdding: boolean;
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

  useEffect(() => {
    if (isAdding) requestAnimationFrame(() => inputRef.current?.focus());
    else setNewTitle("");
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
    await createTask({ title: newTitle.trim(), dueDate: defaultDueDate });
    setNewTitle("");
    inputRef.current?.focus();
  }, [newTitle, defaultDueDate, createTask]);

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

  const totalTasks = sortedTasks.length + sortedOverdue.length;
  const hasOverdue = sortedOverdue.length > 0;

  // Week/month views: fixed width per column (4 visible = 25% each)
  const widthClass = (view === "w" || view === "m") ? "w-[25%] min-w-[25%] shrink-0" : "min-w-[260px] flex-1";

  return (
    <div
      className={`relative flex flex-col ${widthClass} ${!isLast ? "border-r border-dashed border-[#3a3a48]" : ""}`}
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
          className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-[#a78bfa]/60 bg-[#a78bfa]/5"
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-5 pb-3 pt-4">
        <span className="text-[15px] font-bold text-[#a78bfa]">{column.title}</span>
        {column.subtitle && <span className="text-sm text-[#a1a1aa]">{column.subtitle}</span>}
      </div>

      {/* Add task — click opens inline quick-add, Tab opens full dialog */}
      <div
        onClick={() => { if (!isAdding) onStartAdd(); }}
        className={`mx-5 mb-3 flex items-center justify-between rounded-[10px] border px-3.5 py-2.5 transition-colors ${
          isAdding ? "border-[#4a4a58] bg-[#1a1a22]" : "cursor-pointer border-[#333340] bg-[#16161e] hover:border-[#4a4a58] hover:bg-[#1e1e28]"
        }`}
      >
        {isAdding ? (
          <input
            ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Enter = quick add, Tab = full editor, Esc = cancel"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleQuickAdd(); }
              if (e.key === "Tab") { e.preventDefault(); onStopAdd(); setCreateDialogOpen(true); }
              if (e.key === "Escape") onStopAdd();
            }}
            onBlur={() => { if (!newTitle.trim()) onStopAdd(); }}
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#71717a]"
          />
        ) : (
          <>
            <span className="flex items-center gap-2.5 text-sm text-[#a1a1aa]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>
              Add new task
            </span>
            {column.shortcut && (
              <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-[#28283a] text-[11px] font-bold text-[#a1a1aa] shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                {column.shortcut}
              </span>
            )}
          </>
        )}
      </div>

      {/* Tasks */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-4">
        {hasOverdue && (
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-[#ef4444]">Overdue</span>
                <span className="text-[13px] font-medium text-[#a1a1aa]">{sortedOverdue.length}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {sortedOverdue.map((t) => <KanbanCard key={t._id} task={t} isOverdue />)}
            </div>
          </div>
        )}

        {/* Tasks sorted by time */}
        {sortedTasks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {sortedTasks.map((t) => (
              <KanbanCard key={t._id} task={t} />
            ))}
          </div>
        )}

        {/* Done tasks */}
        {showDone && doneTasks.length > 0 && (
          <div className="mt-4 border-t border-[#2a2a32] pt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[12px] font-medium text-[#52525b]">Completed</span>
              <span className="flex size-[16px] items-center justify-center rounded-full border border-[#3a3a48] text-[9px] font-medium text-[#52525b]">
                {doneTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {doneTasks.map((t) => <KanbanCard key={t._id} task={t} />)}
            </div>
          </div>
        )}

        {totalTasks === 0 && !showDone && (
          <div className="mt-auto flex items-center gap-2 pb-1">
            <span className="text-[13px] tracking-wide text-[#52525b]">No tasks planned yet</span>
            <span className="flex size-[18px] items-center justify-center rounded-[5px] border border-[#3a3a48] bg-[#1a1a22] text-[10px] font-bold text-[#606068] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">0</span>
          </div>
        )}
      </div>

      {/* Full create dialog */}
      <TaskEditDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} defaultDueDate={defaultDueDate} />
    </div>
  );
}
