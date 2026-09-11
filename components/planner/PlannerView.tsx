"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  getCalendarList,
  type GoogleCalendar,
} from "@/app/actions/calendar";
import { runCalendarSync } from "@/lib/calendar-sync-client";
import KanbanCard, { TaskEditDialog } from "@/components/kanban/KanbanCard";
import { TaskContextMenu } from "@/components/tasks/TaskContextMenu";
import { isGoogleCalEvent } from "@/lib/task-utils";
import { PRIORITY_COLORS } from "@/lib/constants";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Kbd } from "@/components/ui/kbd";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import {
  Menu, MenuTrigger, MenuPopup, MenuItem, MenuCheckboxItem, MenuSeparator,
} from "@/components/ui/menu";
import { motion } from "motion/react";
import { Segmented } from "@/components/ui/segmented";
import { glassAction, glassIconButton } from "@/lib/ui/chrome";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  LayoutAlignLeftIcon,
  DashedLineCircleIcon,
} from "@hugeicons/core-free-icons";
import {
  format, startOfWeek, startOfMonth, endOfMonth, addDays, subDays,
  addWeeks, subWeeks, addMonths, subMonths,
  parseISO, isSameDay, isSameMonth, eachWeekOfInterval,
  startOfDay, isBefore, differenceInCalendarDays,
} from "date-fns";
import { syncTaskUpdateToGoogle, pushLocalTaskToGoogle } from "@/lib/google-sync";
import { getDraggingTaskId, setDraggingTaskId } from "@/lib/drag-store";
import { layoutTimeBlocks } from "@/lib/calendar-layout";
import {
  DEFAULT_EVENT_MINUTES, MIN_EVENT_MINUTES, END_OF_DAY_MIN,
  resolveTaskBlock, endTimeFor, minutesToTime, durationMinutes, localDateStr,
} from "@/lib/time-utils";

const HOUR_HEIGHT = 96;
const START_HOUR = 0;
const END_HOUR = 24;
const QUARTER_PX = HOUR_HEIGHT / 4; // 24px per 15-min slot
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const MIN_BLOCK_PX = (MIN_EVENT_MINUTES / 60) * HOUR_HEIGHT;
const MAX_MONTH_CHIPS = 4;

type CalView = "day" | "week" | "month" | number;
/** The three fixed segments in the view switcher (the "X days" option lives in
 *  its own menu next to the Segmented control). */
type CalSeg = "day" | "week" | "month";
type UpdateTask = ReturnType<typeof useMutation<typeof api.tasks.update>>;
type TaskChanges = Parameters<UpdateTask>[0];

function loadCalView(): CalView {
  if (typeof window === "undefined") return "week";
  try {
    const v = localStorage.getItem("unifocus-cal-view");
    if (v === "day" || v === "week" || v === "month") return v;
    const n = parseInt(v || "", 10);
    if (n >= 2 && n <= 6) return n;
  } catch {}
  return "week";
}

function loadStoredSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(key);
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set();
}

function loadStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {}
  return fallback;
}

function numVisibleFor(view: CalView): number {
  return view === "day" ? 1 : view === "week" ? 7 : view === "month" ? 0 : view;
}

/** Today's calendar date, re-evaluated when the clock crosses midnight. */
function useToday(): Date {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const now = new Date();
      const next = addDays(startOfDay(now), 1);
      timer = setTimeout(() => { setToday(startOfDay(new Date())); arm(); }, next.getTime() - now.getTime() + 50);
    };
    arm();
    const onVisible = () => { if (document.visibilityState === "visible") setToday(startOfDay(new Date())); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return today;
}

/** True when a keyboard event originates from an input, editor, dialog or menu. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return !!el.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"], [contenteditable="true"]');
}

// Tasks with a Google push in flight; a second write before the first push has
// stored its event id must not create a duplicate Google event.
const pushInFlight = new Set<string>();

/**
 * Write-back to Google after a Convex update, storing the new event link when
 * the push created one. Every planner mutation path goes through here.
 */
async function syncChangesToGoogle(task: Doc<"tasks">, changes: Record<string, unknown>, updateTask: UpdateTask) {
  const willPush = !task.googleEventId;
  if (willPush && pushInFlight.has(task._id)) return;
  if (willPush) pushInFlight.add(task._id);
  try {
    const result = await syncTaskUpdateToGoogle(task, changes);
    if (result) {
      await updateTask({ id: task._id, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
    }
  } catch (err) {
    console.warn("Google Calendar sync failed:", err);
  } finally {
    if (willPush) pushInFlight.delete(task._id);
  }
}

/** Snap a y offset (px from the top of a column) to the 15-minute grid. */
function yToSnappedTime(y: number): { timeStr: string; topPx: number; label: string; startMin: number } {
  const slot = Math.max(0, Math.min((END_HOUR - START_HOUR) * 4 - 1, Math.round(y / QUARTER_PX)));
  const totalMin = slot * 15;
  const timeStr = minutesToTime(totalMin);
  return { timeStr, topPx: slot * QUARTER_PX, label: formatTime12(totalMin), startMin: totalMin };
}

function formatTime12(totalMin: number): string {
  const hour = Math.floor(totalMin / 60);
  const minute = totalMin % 60;
  const ampm = hour < 12 ? "am" : "pm";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/** Move focus to a sibling element inside `root` matching `selector`. */
function focusWithin(root: HTMLElement | null, selector: string) {
  requestAnimationFrame(() => {
    const el = root?.querySelector<HTMLElement>(selector);
    el?.focus();
  });
}

export default function PlannerView() {
  const today = useToday();
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [calAnchor, setCalAnchorRaw] = useState(() => startOfDay(new Date()));
  const setCalAnchor = useCallback((d: Date | ((prev: Date) => Date)) => {
    setCalAnchorRaw((prev) => startOfDay(typeof d === "function" ? d(prev) : d));
  }, []);
  const [calView, setCalViewRaw] = useState<CalView>(loadCalView);
  const [showDone, setShowDone] = useState(false);
  const tasks = useQuery(api.tasks.list, {});
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);

  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarListError, setCalendarListError] = useState<string | null>(null);
  const bulkUpsert = useMutation(api.tasks.bulkUpsertFromGoogle);
  const removeDeleted = useMutation(api.tasks.removeDeletedGoogleEvents);

  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(() => loadStoredSet("unifocus-hidden-calendars"));
  const [showTaskSidebar, setShowTaskSidebar] = useState(() => loadStoredBool("unifocus-planner-sidebar", true));
  const [addingTask, setAddingTask] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{ title?: string; date?: string; start?: string; end?: string }>({});
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const calBodyRef = useRef<HTMLDivElement>(null);
  const [scrollbarW, setScrollbarW] = useState(0);

  // Persist view changes
  const setCalView = useCallback((v: CalView) => {
    setCalViewRaw(v);
    try { localStorage.setItem("unifocus-cal-view", String(v)); } catch {}
  }, []);

  // Visible days for time-grid views (day, week, X-days)
  const visibleDays = useMemo(() => {
    if (calView === "day") return [calAnchor];
    if (calView === "week") {
      const ws = startOfWeek(calAnchor, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    }
    if (calView === "month") return []; // month uses grid, not time-grid
    // X days
    return Array.from({ length: calView }, (_, i) => addDays(calAnchor, i));
  }, [calAnchor, calView]);

  const numVisible = numVisibleFor(calView);
  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");

  // calAnchor is only changed by nav buttons, "Today", the date picker and
  // keyboard navigation; clicking a day header only highlights it.

  // Nav. Month steps go through startOfMonth so Jan 31 -> Feb -> Mar does not
  // drift to the 28th.
  const navForward = useCallback(() => {
    if (calView === "day") setCalAnchor((d) => addDays(d, 1));
    else if (calView === "week") setCalAnchor((d) => addWeeks(d, 1));
    else if (calView === "month") setCalAnchor((d) => addMonths(startOfMonth(d), 1));
    else setCalAnchor((d) => addDays(d, 1)); // X-days: scroll by 1 day
  }, [calView, setCalAnchor]);

  const navBackward = useCallback(() => {
    if (calView === "day") setCalAnchor((d) => subDays(d, 1));
    else if (calView === "week") setCalAnchor((d) => subWeeks(d, 1));
    else if (calView === "month") setCalAnchor((d) => subMonths(startOfMonth(d), 1));
    else setCalAnchor((d) => subDays(d, 1)); // X-days: scroll by 1 day
  }, [calView, setCalAnchor]);

  const goToToday = useCallback(() => {
    const t = startOfDay(new Date());
    setSelectedDate(t);
    setCalAnchor(t);
  }, [setCalAnchor]);

  // Buffer days for infinite scroll (not used for month view)
  const BUFFER = 14; // 14 days on each side
  const allScrollDays = useMemo(() => {
    if (calView === "month") return [];
    const startDay = subDays(visibleDays[0] || calAnchor, BUFFER);
    const totalDays = BUFFER + numVisible + BUFFER;
    return Array.from({ length: totalDays }, (_, i) => addDays(startDay, i));
  }, [calAnchor, calView, visibleDays, numVisible]);

  // Horizontal scroll refs
  const hScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const allDayScrollRef = useRef<HTMLDivElement>(null);
  const isResettingScroll = useRef(false);

  // Sync header + all-day rows with time grid scroll
  useEffect(() => {
    const grid = hScrollRef.current;
    if (!grid) return;
    function onScroll() {
      if (!grid) return;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = grid.scrollLeft;
      if (allDayScrollRef.current) allDayScrollRef.current.scrollLeft = grid.scrollLeft;
    }
    grid.addEventListener("scroll", onScroll, { passive: true });
    return () => grid.removeEventListener("scroll", onScroll);
  }, [calView]);

  // On platforms with classic (non-overlay) scrollbars the vertical scrollbar
  // steals width from the column scroller but not from the header row. Measure
  // it and pad the header rows so day columns and headers stay aligned.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || calView === "month") return;
    const measure = () => setScrollbarW(Math.max(0, el.offsetWidth - el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [calView]);

  // Center scroll to show the visible days on mount / anchor change
  useEffect(() => {
    if (calView === "month") return;
    const grid = hScrollRef.current;
    if (!grid || grid.clientWidth === 0) return;
    const colWidth = grid.clientWidth / numVisible;
    isResettingScroll.current = true;
    grid.scrollLeft = BUFFER * colWidth;
    const raf = requestAnimationFrame(() => { isResettingScroll.current = false; });
    return () => cancelAnimationFrame(raf);
  }, [calAnchor, calView, numVisible]);

  // Detect when user scrolls near edges and shift anchor
  useEffect(() => {
    if (calView === "month") return;
    const grid = hScrollRef.current;
    if (!grid) return;
    let safety: ReturnType<typeof setTimeout> | undefined;

    function onScroll() {
      if (!grid || isResettingScroll.current) return;
      if (grid.clientWidth === 0) return; // hidden grid: colWidth would be 0 -> NaN
      const colWidth = grid.clientWidth / numVisible;
      const leftBuffer = BUFFER * colWidth;
      const rightBuffer = (BUFFER + numVisible) * colWidth;
      const scrollRight = grid.scrollLeft + grid.clientWidth;
      const totalWidth = grid.scrollWidth;

      let shift = 0;
      // If scrolled past 70% of left buffer, shift anchor backward
      if (grid.scrollLeft < leftBuffer * 0.3) {
        shift = -Math.max(1, Math.round((leftBuffer - grid.scrollLeft) / colWidth));
      }
      // If scrolled past 70% of right buffer
      else if (scrollRight > totalWidth - leftBuffer * 0.3) {
        shift = Math.max(1, Math.round((scrollRight - rightBuffer) / colWidth));
      }
      if (shift === 0) return;
      // Ignore further momentum events until the recenter effect has run, so
      // two events in one frame cannot shift the anchor twice.
      isResettingScroll.current = true;
      clearTimeout(safety);
      safety = setTimeout(() => { isResettingScroll.current = false; }, 500);
      setCalAnchor((d) => addDays(d, shift));
    }

    grid.addEventListener("scroll", onScroll, { passive: true });
    return () => { grid.removeEventListener("scroll", onScroll); clearTimeout(safety); };
  }, [calView, numVisible, setCalAnchor]);

  // Fetch Google Calendar list once; surface failure instead of pretending
  // there are no calendars.
  useEffect(() => {
    let cancelled = false;
    getCalendarList()
      .then((list) => { if (!cancelled) setGoogleCalendars(list); })
      .catch((err) => { if (!cancelled) setCalendarListError(err instanceof Error ? err.message : "Failed to load calendars"); });
    return () => { cancelled = true; };
  }, []);

  // Persist hidden calendars
  const toggleCalendar = useCallback((calId: string) => {
    setHiddenCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId); else next.add(calId);
      try { localStorage.setItem("unifocus-hidden-calendars", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  // Persist sidebar visibility
  const toggleTaskSidebar = useCallback(() => {
    setShowTaskSidebar((prev) => {
      const next = !prev;
      try { localStorage.setItem("unifocus-planner-sidebar", String(next)); } catch {}
      return next;
    });
  }, []);

  // Filter tasks: exclude google_calendar tasks from hidden calendars
  const visibleTasks = useMemo(() => {
    if (!tasks) return [];
    if (hiddenCalendarIds.size === 0) return tasks;
    return tasks.filter((t) => !t.googleCalendarId || !hiddenCalendarIds.has(t.googleCalendarId));
  }, [tasks, hiddenCalendarIds]);

  // Sync Google Calendar events -> Convex.
  // Strategy: keep a list of loaded intervals. Only fetch when the desired
  // window is not fully inside one of them (then extend by a big chunk), and
  // debounce so rapid scroll/anchor changes don't fire repeated requests.
  // Requests are chained, never dropped: each one re-checks coverage when its
  // turn comes, so a range that an earlier request already covered is skipped.
  const loadedRangesRef = useRef<{ min: number; max: number }[]>([]);
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const isCovered = useCallback((min: number, max: number) =>
    loadedRangesRef.current.some((r) => min >= r.min && max <= r.max), []);
  const addLoadedRange = useCallback((min: number, max: number) => {
    const ranges = [...loadedRangesRef.current, { min, max }].sort((a, b) => a.min - b.min);
    const merged: { min: number; max: number }[] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.min <= last.max) last.max = Math.max(last.max, r.max);
      else merged.push({ ...r });
    }
    loadedRangesRef.current = merged;
  }, []);

  const desiredWindow = useMemo(() => {
    if (calView === "month") {
      return { min: startOfMonth(calAnchor), max: addDays(endOfMonth(calAnchor), 1) };
    }
    if (visibleDays.length > 0) {
      return { min: subDays(visibleDays[0], 7), max: addDays(visibleDays[visibleDays.length - 1], 8) };
    }
    return null;
  }, [calAnchor, calView, visibleDays]);
  const desiredKey = desiredWindow ? `${desiredWindow.min.getTime()}-${desiredWindow.max.getTime()}` : "";

  useEffect(() => {
    if (!desiredWindow) return;
    const { min: desiredMin, max: desiredMax } = desiredWindow;
    if (isCovered(desiredMin.getTime(), desiredMax.getTime())) return;

    // Debounce: wait for scroll/anchor to settle before firing.
    const handle = setTimeout(() => {
      syncChainRef.current = syncChainRef.current.then(async () => {
        // A previous request may have covered this window while we waited.
        if (isCovered(desiredMin.getTime(), desiredMax.getTime())) return;
        // Extend the fetch window well beyond what we need so future scrolls hit the cache.
        const CHUNK_DAYS = 60;
        const from = subDays(desiredMin, CHUNK_DAYS);
        const to = addDays(desiredMax, CHUNK_DAYS);
        const isFirstLoad = loadedRangesRef.current.length === 0;
        if (isFirstLoad) setCalendarLoading(true);
        setCalendarError(null);
        try {
          const result = await runCalendarSync({ from, to }, { bulkUpsert, removeDeleted });
          addLoadedRange(from.getTime(), to.getTime());
          if (!result.complete) {
            setCalendarError(`${result.failedCalendarIds.length} calendar(s) could not be loaded; nothing was removed.`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to sync calendar";
          setCalendarError(msg);
          console.warn("Calendar sync error:", msg);
        } finally {
          if (isFirstLoad) setCalendarLoading(false);
        }
      });
    }, 250);

    return () => clearTimeout(handle);
    // desiredKey captures the window identity; desiredWindow itself is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, bulkUpsert, removeDeleted, isCovered, addLoadedRange]);

  // Scroll to current hour on mount and when switching views
  useEffect(() => {
    // Small delay to ensure the grid has rendered
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        const hour = new Date().getHours();
        scrollRef.current.scrollTo({ top: Math.max(0, (hour - 2) * HOUR_HEIGHT), behavior: "smooth" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [calView]);

  // Tasks for selected day (includes both local and google_calendar tasks)
  const dayTasks = useMemo(() => {
    if (!visibleTasks.length) return { overdue: [], day: [], done: [] };
    const overdue: Doc<"tasks">[] = [];
    const dayList: Doc<"tasks">[] = [];
    const done: Doc<"tasks">[] = [];
    const viewingToday = isSameDay(selectedDate, today);
    for (const t of visibleTasks) {
      const d = t.dueDate || t.scheduledDate;
      if (!d) continue;
      const pd = parseISO(d);
      if (t.status === "done") {
        if (isSameDay(pd, selectedDate)) done.push(t);
        continue;
      }
      // Overdue = only local tasks when viewing today; calendar events from the past are not overdue
      if (viewingToday && isBefore(pd, today) && !isGoogleCalEvent(t)) {
        overdue.push(t);
      } else if (isSameDay(pd, selectedDate)) {
        dayList.push(t);
      }
    }
    return { overdue, day: dayList, done };
  }, [visibleTasks, selectedDate, today]);

  // Quick-add: guarded against double submit; the input clears immediately and
  // is restored if the create fails. Pushes to Google like the timeline does.
  const submittingRef = useRef(false);
  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || submittingRef.current) return;
    submittingRef.current = true;
    setNewTitle("");
    try {
      const newTaskId = await createTask({ title, dueDate: selectedDateStr, userDate: localDateStr(new Date()) });
      inputRef.current?.focus();
      try {
        const result = await pushLocalTaskToGoogle({ _id: newTaskId, title, dueDate: selectedDateStr } as Doc<"tasks">);
        if (result) await updateTask({ id: newTaskId, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
      } catch (err) { console.warn("Auto-push failed:", err); }
    } catch (err) {
      console.error("Create task failed:", err);
      setNewTitle(title);
    } finally {
      submittingRef.current = false;
    }
  }, [newTitle, selectedDateStr, createTask, updateTask]);

  useEffect(() => {
    if (addingTask) requestAnimationFrame(() => inputRef.current?.focus());
    else setNewTitle("");
  }, [addingTask]);

  // Open the full editor pre-filled (quick-add Tab, click-to-create on the grid)
  const openCreateDialog = useCallback((defaults: { title?: string; date?: string; start?: string; end?: string }) => {
    setCreateDefaults(defaults);
    setCreateDialogOpen(true);
  }, []);

  // Keyboard shortcuts (ignored inside inputs, editors, dialogs and menus)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === "c" || e.key === "C") { e.preventDefault(); setAddingTask(true); }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); goToToday(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToToday]);

  const { width: panelWidth, onMouseDown: handleResize } = useResizablePanel("planner-today", 380, 280, 500);
  const overdueDuration = calcDuration(dayTasks.overdue);

  // Left panel drop: move the task to the selected day (keeps its time)
  const [leftDropOver, setLeftDropOver] = useState(false);
  const leftDragCounter = useRef(0);
  const handleLeftDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    leftDragCounter.current = 0;
    setLeftDropOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const allTasks = [...dayTasks.overdue, ...dayTasks.day];
    if (allTasks.some((t) => t._id === taskId)) return;
    const task = tasks?.find((t) => t._id === taskId);
    const changes = { dueDate: selectedDateStr };
    await updateTask({ id: taskId as Id<"tasks">, ...changes });
    if (task) await syncChangesToGoogle(task, changes, updateTask);
  }, [selectedDateStr, dayTasks, tasks, updateTask]);

  // Roving focus between day header buttons
  const headerRowRef = useRef<HTMLDivElement>(null);
  const onHeaderKeyDown = useCallback((e: React.KeyboardEvent, day: Date) => {
    let next: Date | null = null;
    if (e.key === "ArrowRight") next = addDays(day, 1);
    else if (e.key === "ArrowLeft") next = subDays(day, 1);
    else if (e.key === "Home") next = visibleDays[0] ?? day;
    else if (e.key === "End") next = visibleDays[visibleDays.length - 1] ?? day;
    if (!next) return;
    e.preventDefault();
    setSelectedDate(next);
    const first = visibleDays[0], last = visibleDays[visibleDays.length - 1];
    if (first && last && (isBefore(next, first) || isBefore(last, next))) {
      setCalAnchor((d) => addDays(d, differenceInCalendarDays(next!, isBefore(next!, first) ? first : last)));
    }
    focusWithin(headerRowRef.current, `[data-day-header="${format(next, "yyyy-MM-dd")}"]`);
  }, [visibleDays, setCalAnchor]);

  // View label for header
  const viewLabel = (() => {
    if (calView === "month") return format(calAnchor, "MMMM yyyy");
    if (calView === "day") return format(calAnchor, "EEEE, MMMM d");
    const first = visibleDays[0] ?? calAnchor;
    const last = visibleDays[visibleDays.length - 1] ?? calAnchor;
    const sameMonth = isSameMonth(first, last);
    return sameMonth
      ? `${format(first, "MMM d")} – ${format(last, "d, yyyy")}`
      : `${format(first, "MMM d")} – ${format(last, "MMM d, yyyy")}`;
  })();

  return (
    <div className="flex flex-1 overflow-hidden p-3">
      {/* ── Left panel (task sidebar) — flat grey rounded panel ── */}
      {showTaskSidebar && <div
        className="relative flex shrink-0 flex-col overflow-hidden rounded-[18px] bg-[#f5f5f6] dark:bg-[#212226]"
        style={{ width: panelWidth }}
        onDragEnter={(e) => { e.preventDefault(); leftDragCounter.current++; setLeftDropOver(true); }}
        onDragLeave={() => { leftDragCounter.current--; if (leftDragCounter.current <= 0) { leftDragCounter.current = 0; setLeftDropOver(false); } }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop={handleLeftDrop}
      >
        {leftDropOver && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand/60 bg-brand/5" />
        )}

        {/* Header with date picker + sidebar toggle */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-4">
          <Popover>
            <PopoverTrigger render={
              <button className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight text-text-strong transition-colors hover:text-brand" aria-label="Pick a date" />
            }>
              {isSameDay(selectedDate, today) ? "Today" : format(selectedDate, "EEE, MMM d")}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 5l3 3 3-3" /></svg>
            </PopoverTrigger>
            <PopoverPopup sideOffset={4} className="p-0">
              <Calendar mode="single" weekStartsOn={1} selected={selectedDate}
                onSelect={(d) => { if (d) { setSelectedDate(startOfDay(d)); setCalAnchor(d); } }} />
              <div className="px-3 py-2">
                <button onClick={goToToday} className={glassAction}>
                  Go to today
                </button>
              </div>
            </PopoverPopup>
          </Popover>

          <button
            onClick={toggleTaskSidebar}
            className={glassIconButton}
            title="Hide sidebar"
            aria-label="Hide task sidebar"
          >
            <HugeiconsIcon icon={LayoutAlignLeftIcon} size={14} />
          </button>
        </div>

        {/* Add task */}
        <div
          onClick={() => { if (!addingTask) setAddingTask(true); }}
          className={`mx-3 mb-2.5 flex items-center justify-between rounded-[13px] px-3.5 py-2.5 transition-colors ${
            addingTask
              ? "bg-surface-0 ring-1 ring-inset ring-line-strong dark:bg-white/[0.08] dark:ring-white/[0.12]"
              : "cursor-pointer bg-surface-0 hover:bg-hover active:translate-y-px dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
          }`}
        >
          {addingTask ? (
            <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add task"
              aria-label="New task title"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const title = newTitle.trim();
                  openCreateDialog({ title: title || undefined, date: selectedDateStr });
                  setAddingTask(false);
                }
                if (e.key === "Escape") setAddingTask(false);
              }}
              onBlur={() => { if (!newTitle.trim()) setAddingTask(false); }}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-muted"
            />
          ) : (
            <>
              <span className="flex items-center gap-2.5 text-sm text-text-faint">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>
                Add new task
              </span>
              <Kbd>C</Kbd>
            </>
          )}
        </div>

        {/* Tasks */}
        <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
          {dayTasks.overdue.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-[#ef4444]">Overdue</span>
                  <span className="text-[13px] font-medium text-text-secondary">{dayTasks.overdue.length}</span>
                </div>
                {overdueDuration && <span className="text-[11px] font-medium text-text-secondary">{overdueDuration}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                {dayTasks.overdue.map((t) => <KanbanCard key={t._id} task={t} isOverdue context="sidebar" />)}
              </div>
            </div>
          )}
          {/* Unified task list sorted by time (includes local + google_calendar tasks) */}
          {(() => {
            const sorted = [...dayTasks.day].sort((a, b) => {
              const timeA = a.dueTime || a.scheduledStartTime || "99:99";
              const timeB = b.dueTime || b.scheduledStartTime || "99:99";
              return timeA.localeCompare(timeB);
            });

            if (sorted.length === 0) return null;
            return (
              <div className="flex flex-col gap-1.5">
                {sorted.map((t) => <KanbanCard key={t._id} task={t} context="sidebar" />)}
              </div>
            );
          })()}

          {/* Done tasks toggle */}
          {dayTasks.done.length > 0 && (
            <div className="mt-4 pt-3">
              <button
                onClick={() => setShowDone(!showDone)}
                aria-expanded={showDone}
                className="mb-2 flex w-full items-center gap-2 text-[12px] font-medium text-text-faint transition-colors hover:text-text-secondary"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
                  className={`transition-transform ${showDone ? "rotate-90" : ""}`}>
                  <path d="M3.5 2L6.5 5L3.5 8" />
                </svg>
                Completed
                <span className="flex size-[16px] items-center justify-center rounded-full border border-line-strong text-[9px] font-medium text-text-faint">
                  {dayTasks.done.length}
                </span>
              </button>
              {showDone && (
                <div className="flex flex-col gap-1.5">
                  {dayTasks.done.map((t) => <KanbanCard key={t._id} task={t} context="sidebar" />)}
                </div>
              )}
            </div>
          )}
        </div>

      </div>}

      {showTaskSidebar && <ResizeHandle onMouseDown={handleResize} />}

      {/* ── Right panel: Calendar — flat grey rounded panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-[18px] bg-[#f5f5f6] dark:bg-[#212226]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <h2 className="text-[15px] font-bold tracking-tight text-text-strong" aria-live="polite">{viewLabel}</h2>
          <div className="flex items-center gap-1.5">
            {/* View switcher (D / W / M) */}
            <Segmented<CalSeg | "x">
              layoutId="planner-view"
              size="sm"
              value={typeof calView === "number" ? "x" : calView}
              onChange={(v) => { if (v !== "x") setCalView(v); }}
              items={[
                { value: "day", label: "D", title: "Day view" },
                { value: "week", label: "W", title: "Week view" },
                { value: "month", label: "M", title: "Month view" },
              ]}
            />

            {/* X-days menu (kept beside the switcher — a menu, not a segment); not applicable in month view */}
            {calView !== "month" && <Menu>
              <MenuTrigger render={
                <button aria-label="Number of days to show" className={`${glassAction} ${typeof calView === "number" ? "!text-brand" : ""}`} />
              }>
                <span>{typeof calView === "number" ? `${calView}D` : "Days"}</span>
              </MenuTrigger>
              <MenuPopup>
                {[2, 3, 4, 5, 6].map((n) => (
                  <MenuItem key={n} onClick={() => setCalView(n)}>
                    {n} days
                    {calView === n && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>}

            {/* Today + nav */}
            <button onClick={goToToday} className={glassIconButton} title="Today" aria-label="Go to today">
              <span className="text-[11px] font-bold">T</span>
            </button>
            <button onClick={navBackward} className={glassIconButton} title="Previous" aria-label={calView === "month" ? "Previous month" : calView === "day" ? "Previous day" : "Previous period"}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            </button>
            <button onClick={navForward} className={glassIconButton} title="Next" aria-label={calView === "month" ? "Next month" : calView === "day" ? "Next day" : "Next period"}>
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </button>

            {/* Divider */}
            <div className="mx-1 h-5 w-px bg-line" />

            {/* Calendar picker */}
            <Menu>
              <MenuTrigger render={<button className={glassIconButton} aria-label="Calendars" title="Calendars" />}>
                <HugeiconsIcon icon={Calendar03Icon} size={14} />
              </MenuTrigger>
              <MenuPopup>
                {calendarListError ? (
                  <MenuItem className="pointer-events-none text-xs text-muted-foreground">Couldn&apos;t load calendars</MenuItem>
                ) : googleCalendars.length === 0 ? (
                  <MenuItem className="pointer-events-none text-xs text-muted-foreground">No calendars found</MenuItem>
                ) : (
                  googleCalendars.map((cal) => (
                    <MenuCheckboxItem
                      key={cal.id}
                      checked={!hiddenCalendarIds.has(cal.id)}
                      onCheckedChange={() => toggleCalendar(cal.id)}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cal.backgroundColor }} />
                      <span className="truncate">{cal.summary}</span>
                    </MenuCheckboxItem>
                  ))
                )}
                {hiddenCalendarIds.size > 0 && (
                  <>
                    <MenuSeparator />
                    <MenuItem onClick={() => {
                      setHiddenCalendarIds(new Set());
                      try { localStorage.removeItem("unifocus-hidden-calendars"); } catch {}
                    }}>
                      Show all calendars
                    </MenuItem>
                  </>
                )}
              </MenuPopup>
            </Menu>

            {/* Sidebar toggle — only show when sidebar is hidden */}
            {!showTaskSidebar && (
              <button
                onClick={toggleTaskSidebar}
                className={`${glassIconButton} !text-brand`}
                title="Show task sidebar"
                aria-label="Show task sidebar"
              >
                <HugeiconsIcon icon={LayoutAlignLeftIcon} size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Calendar status */}
        {calendarError && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-[12px] bg-rose-50 px-3.5 py-2 dark:bg-rose-950/25" role="status">
            <span className="text-[12px] text-[#f87171]">⚠ {calendarError}</span>
            <button onClick={() => setCalendarError(null)} className="text-[11px] text-text-muted hover:text-foreground">dismiss</button>
          </div>
        )}
        {calendarLoading && !calendarError && (
          <div className="flex items-center gap-2 px-4 py-1" role="status">
            <div className="h-0.5 w-20 overflow-hidden rounded-full bg-line">
              <div className="h-full w-8 animate-[shimmer_1s_ease-in-out_infinite] rounded-full bg-brand/60" />
            </div>
            <span className="text-[11px] text-text-faint">Loading calendar...</span>
          </div>
        )}

        {/* Calendar body */}
        <div ref={calBodyRef} className="flex flex-1 flex-col overflow-hidden">
          {calView === "month" ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <MonthGrid
                anchor={calAnchor}
                today={today}
                selectedDate={selectedDate}
                onSelectDate={(d) => setSelectedDate(startOfDay(d))}
                onAnchorChange={setCalAnchor}
                tasks={visibleTasks}
                updateTask={updateTask}
              />
            </div>
          ) : (
            <div role="grid" aria-label="Time grid" aria-rowcount={3} className="flex flex-1 flex-col overflow-hidden">
              {/* Day headers — scrolls in sync with time grid */}
              <div role="row" className="flex px-3" style={{ paddingRight: 12 + scrollbarW }}>
                <div role="presentation" className="w-14 shrink-0 pr-2 pb-1.5 pt-0.5 text-[11px] text-text-faint">
                  <TimeZoneLabel />
                </div>
                <div
                  ref={(el) => { headerScrollRef.current = el; headerRowRef.current = el; }}
                  role="presentation"
                  className="flex flex-1 overflow-hidden"
                >
                  {allScrollDays.map((day) => {
                    const pct = 100 / numVisible;
                    const isNow = isSameDay(day, today);
                    const isSel = isSameDay(day, selectedDate);
                    const dayKey = format(day, "yyyy-MM-dd");
                    return (
                      <button
                        key={dayKey}
                        role="columnheader"
                        data-day-header={dayKey}
                        tabIndex={isSel ? 0 : -1}
                        onClick={() => setSelectedDate(day)}
                        onKeyDown={(e) => onHeaderKeyDown(e, day)}
                        aria-label={format(day, "EEEE, MMMM d, yyyy")}
                        aria-selected={isSel}
                        aria-current={isNow ? "date" : undefined}
                        className={`flex shrink-0 items-center gap-1.5 px-2 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
                          numVisible === 1 ? "justify-center" : ""
                        } ${isSel && numVisible > 1 ? "bg-black/[0.05] dark:bg-white/[0.07]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"}`}
                        style={{ width: `${pct}%` }}
                      >
                        <span className={`text-[12px] font-medium ${isNow ? "text-text-strong" : isSel ? "text-brand" : "text-text-secondary"}`}>
                          {format(day, "EEE")}
                        </span>
                        <span className={`flex size-[22px] items-center justify-center rounded-[6px] text-[12px] font-bold ${
                          isNow ? "bg-brand text-white" : isSel ? "bg-brand-bg text-brand-strong" : "text-text-secondary"
                        }`}>
                          {format(day, "d")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* All-day lane — dated tasks without a time; drop here to unschedule */}
              <div role="row" className="flex px-3 pb-1.5" style={{ paddingRight: 12 + scrollbarW }}>
                <div role="presentation" className="w-14 shrink-0 pr-2 pt-1 text-right text-[10px] text-text-faint">all-day</div>
                <div ref={allDayScrollRef} role="presentation" className="flex flex-1 overflow-hidden rounded-[8px] bg-surface-0 dark:bg-[#191a1d]">
                  {allScrollDays.map((day) => (
                    <AllDayCell
                      key={format(day, "yyyy-MM-dd")}
                      day={day}
                      today={today}
                      widthPct={100 / numVisible}
                      tasks={visibleTasks}
                      updateTask={updateTask}
                    />
                  ))}
                </div>
              </div>

              {/* Time grid — horizontal + vertical scroll */}
              <div ref={scrollRef} role="presentation" className="mx-3 mb-3 flex-1 overflow-y-auto rounded-[12px] bg-surface-0 dark:bg-[#191a1d]">
                <div role="row" className="flex" style={{ height: GRID_HEIGHT }}>
                  {/* Hour labels — sticky left */}
                  <div role="presentation" aria-hidden="true" className="sticky left-0 z-10 w-14 shrink-0 bg-surface-0 dark:bg-[#191a1d]">
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map((hour) => (
                      <div key={hour} className="flex items-start justify-end pr-2 text-[11px] leading-none text-text-faint"
                        style={{ height: HOUR_HEIGHT }}>
                        {/* Label straddles its hour line; the very first one stays inside the grid. */}
                        <span className={hour === START_HOUR ? "mt-0.5" : "-translate-y-1/2"}>
                          {hour === 0 ? "12 am" : hour < 12 ? `${hour} am` : hour === 12 ? "12 pm" : `${hour - 12} pm`}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Scrollable day columns */}
                  <div
                    ref={hScrollRef}
                    role="presentation"
                    className="flex flex-1 snap-x snap-mandatory overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  >
                    {allScrollDays.map((day) => {
                      const pct = 100 / numVisible;
                      return (
                        <div key={format(day, "yyyy-MM-dd")} role="presentation" className="shrink-0 snap-start" style={{ width: `${pct}%` }}>
                          <CalendarDayColumn
                            day={day}
                            today={today}
                            tasks={visibleTasks}
                            updateTask={updateTask}
                            onCreateAt={(dateStr, start) => openCreateDialog({ date: dateStr, start, end: endTimeFor(start, DEFAULT_EVENT_MINUTES) })}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      <TaskEditDialog
        open={createDialogOpen}
        onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) setCreateDefaults({}); }}
        defaultDueDate={createDefaults.date ?? selectedDateStr}
        defaultTitle={createDefaults.title}
        defaultStartTime={createDefaults.start}
        defaultEndTime={createDefaults.end}
      />
    </div>
  );
}

/** Timezone label. The planner is client-only, so reading Intl here is safe. */
function TimeZoneLabel() {
  const [label] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()?.replace("_", " ") || "");
  return <>{label}</>;
}

/* ─── All-day lane cell: tasks on this day with no time ─── */
function AllDayCell({ day, today, widthPct, tasks, updateTask }: {
  day: Date;
  today: Date;
  widthPct: number;
  tasks: Doc<"tasks">[];
  updateTask: UpdateTask;
}) {
  const [isOver, setIsOver] = useState(false);
  const dragCounter = useRef(0);
  const dayStr = format(day, "yyyy-MM-dd");
  const items = useMemo(() => tasks.filter((t) => {
    const d = t.dueDate || t.scheduledDate;
    return d === dayStr && resolveTaskBlock(t) === null;
  }), [tasks, dayStr]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const task = tasks.find((t) => t._id === taskId);
    const changes: TaskChanges = {
      id: taskId as Id<"tasks">,
      dueDate: dayStr,
      clearDueTime: true,
      clearScheduledStartTime: true,
      clearScheduledEndTime: true,
    };
    await updateTask(changes);
    if (task) await syncChangesToGoogle(task, changes as Record<string, unknown>, updateTask);
  }, [dayStr, tasks, updateTask]);

  const shown = items.slice(0, 2);
  const hidden = items.length - shown.length;
  return (
    <div
      role="gridcell"
      aria-label={`All-day, ${format(day, "EEEE, MMMM d")}`}
      className={`relative flex min-h-[26px] shrink-0 flex-col gap-0.5 border-l border-black/[0.09] px-1 py-1 dark:border-white/[0.09] ${
        isSameDay(day, today) ? "bg-brand/[0.035]" : ""
      } ${isOver ? "bg-brand/[0.08]" : ""}`}
      style={{ width: `${widthPct}%` }}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleDrop}
    >
      {shown.map((t) => {
        const isCal = t.source === "google_calendar";
        const color = isCal ? (t.calendarColor || "#059669") : PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.p4;
        const done = t.status === "done";
        return (
          <TaskContextMenu key={t._id} task={t}>
            <div
              draggable={!done}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", t._id);
                e.dataTransfer.setData("application/source-date", dayStr);
                e.dataTransfer.effectAllowed = "move";
                setDraggingTaskId(t._id);
              }}
              onDragEnd={() => setDraggingTaskId(null)}
              className={`flex items-center gap-1.5 rounded-[6px] bg-surface-0 px-1.5 text-[10px] font-medium leading-[18px] shadow-3d-sm dark:bg-white/[0.06] ${done ? "opacity-60" : "cursor-grab hover:shadow-3d"}`}
              title={t.title}
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: done ? "#52525b" : color }} />
              <span className={`truncate ${done ? "text-text-muted line-through" : "text-text-strong"}`}>{t.title || "(No title)"}</span>
            </div>
          </TaskContextMenu>
        );
      })}
      {hidden > 0 && <span className="px-1 text-[9px] text-text-muted">+{hidden} more</span>}
    </div>
  );
}

/* ─── Month Grid (Google Calendar style) with drop support ─── */
function MonthGrid({ anchor, today, selectedDate, onSelectDate, onAnchorChange, tasks, updateTask }: {
  anchor: Date;
  today: Date;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onAnchorChange: (d: Date) => void;
  tasks: Doc<"tasks">[];
  updateTask: UpdateTask;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const mStart = startOfMonth(anchor);
  const mEnd = endOfMonth(anchor);
  const weeks = eachWeekOfInterval({ start: mStart, end: mEnd }, { weekStartsOn: 1 });
  // Show ALL tasks on calendar including done (done tasks get visual styling)
  const activeTasks = tasks;

  // Arrow-key navigation between cells (roving tabindex on the selected day)
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-date]");
    if (!cell) return;
    const current = parseISO(cell.dataset.date!);
    let next: Date | null = null;
    switch (e.key) {
      case "ArrowRight": next = addDays(current, 1); break;
      case "ArrowLeft": next = subDays(current, 1); break;
      case "ArrowDown": next = addDays(current, 7); break;
      case "ArrowUp": next = subDays(current, 7); break;
      case "Home": next = startOfWeek(current, { weekStartsOn: 1 }); break;
      case "End": next = addDays(startOfWeek(current, { weekStartsOn: 1 }), 6); break;
      case "PageDown": next = addMonths(current, 1); break;
      case "PageUp": next = subMonths(current, 1); break;
      default: return;
    }
    e.preventDefault();
    onSelectDate(next);
    if (!isSameMonth(next, anchor)) onAnchorChange(startOfMonth(next));
    focusWithin(gridRef.current, `[data-date="${format(next, "yyyy-MM-dd")}"]`);
  }, [anchor, onSelectDate, onAnchorChange]);

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={`${format(anchor, "MMMM yyyy")} calendar`}
      onKeyDown={onKeyDown}
      className="mx-3 mb-3 flex flex-1 flex-col overflow-hidden rounded-[12px] bg-surface-0 dark:bg-[#191a1d]"
    >
      {/* Weekday headers — left-aligned to match the day numbers below */}
      <div role="row" className="grid grid-cols-7 border-b border-black/[0.06] dark:border-white/[0.07]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <div
            key={d}
            role="columnheader"
            className={`px-2 py-1.5 text-[11px] font-medium text-text-muted ${i > 0 ? "border-l border-black/[0.06] dark:border-white/[0.07]" : ""}`}
          >
            {d}
          </div>
        ))}
      </div>
      {/* Weeks fill the card evenly; hairline separators between cells */}
      <div
        role="presentation"
        className="grid flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.map((ws, wi) => (
          <div key={format(ws, "yyyy-MM-dd")} role="row" className="contents">
            {Array.from({ length: 7 }, (_, i) => (
              <MonthDayCell
                key={i}
                day={addDays(ws, i)}
                today={today}
                anchor={anchor}
                selectedDate={selectedDate}
                onSelectDate={onSelectDate}
                activeTasks={activeTasks}
                updateTask={updateTask}
                isFirstCol={i === 0}
                isFirstRow={wi === 0}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthTaskChip({ task }: { task: Doc<"tasks"> }) {
  const done = task.status === "done";
  if (task.source === "google_calendar") {
    return (
      <TaskContextMenu task={task}>
        <div className={`truncate rounded-[3px] px-1 py-px text-[10px] font-medium ${done ? "opacity-70 line-through" : "text-foreground"}`}
          style={{ backgroundColor: task.calendarColor || "#059669" }}>
          {task.title || "(No title)"}
        </div>
      </TaskContextMenu>
    );
  }
  return (
    <TaskContextMenu task={task}>
      <div className="flex items-center gap-1 truncate px-1 py-px text-[10px]">
        <span className="size-1.5 shrink-0 rounded-full" style={{
          backgroundColor: done ? "#52525b" : PRIORITY_COLORS[task.priority]
        }} />
        <span className={`truncate ${done ? "text-text-muted line-through" : "text-text-strong"}`}>{task.title}</span>
      </div>
    </TaskContextMenu>
  );
}

function MonthDayCell({ day, today, anchor, selectedDate, onSelectDate, activeTasks, updateTask, isFirstCol, isFirstRow }: {
  day: Date; today: Date; anchor: Date; selectedDate: Date;
  onSelectDate: (d: Date) => void;
  activeTasks: Doc<"tasks">[];
  updateTask: UpdateTask;
  isFirstCol: boolean;
  isFirstRow: boolean;
}) {
  const [isOver, setIsOver] = useState(false);
  const dragCounter = useRef(0);
  const isNow = isSameDay(day, today);
  const isSel = isSameDay(day, selectedDate);
  const isOtherMonth = !isSameMonth(day, anchor);
  const dayStr = format(day, "yyyy-MM-dd");

  const dayTasks = activeTasks.filter((t) => (t.dueDate || t.scheduledDate) === dayStr);
  const calendarTasks = dayTasks.filter((t) => t.source === "google_calendar");
  const localTasks = dayTasks.filter((t) => t.source !== "google_calendar");
  // Up to MAX_MONTH_CHIPS chips: calendar events first, then local tasks fill the rest.
  const shownCalendar = calendarTasks.slice(0, Math.min(2, MAX_MONTH_CHIPS));
  const shownLocal = localTasks.slice(0, MAX_MONTH_CHIPS - shownCalendar.length);
  const hiddenCount = dayTasks.length - shownCalendar.length - shownLocal.length;

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const task = activeTasks.find((t) => t._id === taskId);
    if (task && (task.dueDate || task.scheduledDate) === dayStr) return;
    const changes = { dueDate: dayStr };
    await updateTask({ id: taskId as Id<"tasks">, ...changes });
    if (task) await syncChangesToGoogle(task, changes, updateTask);
  }, [dayStr, activeTasks, updateTask]);

  return (
    <div
      role="gridcell"
      data-date={dayStr}
      tabIndex={isSel ? 0 : -1}
      aria-label={`${format(day, "EEEE, MMMM d, yyyy")}${dayTasks.length ? `, ${dayTasks.length} item${dayTasks.length === 1 ? "" : "s"}` : ""}`}
      aria-selected={isSel}
      aria-current={isNow ? "date" : undefined}
      onClick={() => onSelectDate(day)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectDate(day); } }}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleDrop}
      className={`relative flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
        isFirstCol ? "" : "border-l border-black/[0.06] dark:border-white/[0.07]"
      } ${isFirstRow ? "" : "border-t border-black/[0.06] dark:border-white/[0.07]"} ${
        isSel ? "bg-brand/[0.06]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.04]"
      } ${isOtherMonth ? "text-text-faint" : ""}`}
    >
      {isOver && (
        <div className="pointer-events-none absolute inset-0.5 rounded-md border-2 border-dashed border-brand/60 bg-brand/5" />
      )}
      <span className={`mb-0.5 flex size-[22px] items-center justify-center self-start rounded-full text-[12px] font-semibold ${
        isNow ? "bg-brand text-white" : isSel ? "text-brand" : isOtherMonth ? "text-text-faint" : "text-text-secondary"
      }`}>
        {format(day, "d")}
      </span>
      {shownCalendar.map((t) => <MonthTaskChip key={t._id} task={t} />)}
      {shownLocal.map((t) => <MonthTaskChip key={t._id} task={t} />)}
      {hiddenCount > 0 && (
        <Popover>
          <PopoverTrigger render={
            <button
              onClick={(e) => e.stopPropagation()}
              className="self-start rounded-[4px] px-1 text-[9px] text-text-muted transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
              aria-label={`Show ${hiddenCount} more items on ${format(day, "MMMM d")}`}
            />
          }>
            +{hiddenCount} more
          </PopoverTrigger>
          <PopoverPopup sideOffset={4} align="start" className="w-56 p-2">
            <div className="mb-1.5 px-1 text-[11px] font-semibold text-text-secondary">{format(day, "EEEE, MMMM d")}</div>
            <div className="flex flex-col gap-0.5">
              {calendarTasks.map((t) => <MonthTaskChip key={t._id} task={t} />)}
              {localTasks.map((t) => <MonthTaskChip key={t._id} task={t} />)}
            </div>
          </PopoverPopup>
        </Popover>
      )}
    </div>
  );
}

/* ─── Calendar day column with 15-min snap drop ─── */
function CalendarDayColumn({ day, today, tasks, updateTask, onCreateAt }: {
  day: Date;
  today: Date;
  tasks: Doc<"tasks">[];
  updateTask: UpdateTask;
  onCreateAt: (dateStr: string, startTime: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<{ topPx: number; heightPx: number; label: string } | null>(null);
  const lastIndicatorTop = useRef<number | null>(null);
  const dragCounter = useRef(0);
  const columnRef = useRef<HTMLDivElement>(null);
  const dayStr = format(day, "yyyy-MM-dd");
  const isNow = isSameDay(day, today);

  // Every task on this day that has a time (explicit block, or a bare due time
  // rendered with the default duration); includes done tasks.
  const dayScheduledTasks = useMemo(() => {
    return tasks.filter((t) => {
      const dateStr = t.dueDate || t.scheduledDate;
      return dateStr === dayStr && resolveTaskBlock(t) !== null;
    });
  }, [tasks, dayStr]);

  // Height the dragged task will occupy (its real duration, or the default)
  const draggedDurationMin = useCallback(() => {
    const id = getDraggingTaskId();
    const task = id ? tasks.find((t) => t._id === id) : undefined;
    const block = task ? resolveTaskBlock(task) : null;
    return block ? block.endMin - block.startMin : DEFAULT_EVENT_MINUTES;
  }, [tasks]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { topPx, label, startMin } = yToSnappedTime(e.clientY - rect.top);
    // dragover fires continuously; only re-render when the snapped slot changes
    if (lastIndicatorTop.current === topPx) return;
    lastIndicatorTop.current = topPx;
    const dur = Math.min(draggedDurationMin(), END_OF_DAY_MIN + 1 - startMin);
    setDropIndicator({ topPx, heightPx: (dur / 60) * HOUR_HEIGHT, label });
  }, [draggedDurationMin]);

  const clearIndicator = useCallback(() => {
    lastIndicatorTop.current = null;
    setDropIndicator(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);
    clearIndicator();
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { timeStr: start } = yToSnappedTime(e.clientY - rect.top);
    const task = tasks.find((t) => t._id === taskId);
    const block = task ? resolveTaskBlock(task) : null;
    const dur = block ? block.endMin - block.startMin : DEFAULT_EVENT_MINUTES;
    const end = endTimeFor(start, dur);

    // Write the full block explicitly so the grid, Convex and Google all see the
    // same start AND end (a bare dueTime would pair the new start with the old end).
    const changes = { dueDate: dayStr, dueTime: start, scheduledStartTime: start, scheduledEndTime: end };
    await updateTask({ id: taskId as Id<"tasks">, ...changes });
    if (task) await syncChangesToGoogle(task, changes, updateTask);
  }, [dayStr, updateTask, tasks, clearIndicator]);

  // Click on empty space creates a task at that slot (FullCalendar `dateClick`)
  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-task-block]")) return;
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    onCreateAt(dayStr, yToSnappedTime(e.clientY - rect.top).timeStr);
  }, [dayStr, onCreateAt]);

  const placements = useMemo(() => {
    const blocks = dayScheduledTasks.map((t) => {
      const b = resolveTaskBlock(t)!;
      return { id: t._id, startMin: b.startMin, endMin: b.endMin };
    });
    return layoutTimeBlocks(blocks);
  }, [dayScheduledTasks]);

  return (
    <div ref={columnRef}
      role="gridcell"
      aria-label={format(day, "EEEE, MMMM d")}
      aria-current={isNow ? "date" : undefined}
      className={`relative flex-1 border-l border-black/[0.09] dark:border-white/[0.09] ${
        isNow ? "bg-brand/[0.035]" : (day.getDay() === 0 || day.getDay() === 6) ? "bg-black/[0.015] dark:bg-white/[0.02]" : ""
      }`}
      onClick={handleClick}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => {
        dragCounter.current--;
        if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); clearIndicator(); }
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop indicator sized to the dragged task's duration */}
      {isOver && dropIndicator && (
        <div
          className="pointer-events-none absolute left-1 right-1 z-30 rounded-[10px] border-2 border-dashed border-brand/70 bg-brand/10"
          style={{ top: dropIndicator.topPx, height: dropIndicator.heightPx }}
        >
          <span className="absolute right-1 top-1 rounded-[5px] bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white shadow-3d-sm">
            {dropIndicator.label}
          </span>
        </div>
      )}

      {/* 15-min grid lines: hour = solid, 30-min = faint, 15-min = none */}
      {Array.from({ length: (END_HOUR - START_HOUR) * 4 }, (_, i) => (
        <div key={i} className={
          i % 4 === 0
            ? "border-b border-black/[0.09] dark:border-white/[0.09]"
            : i % 2 === 0
              ? "border-b border-black/[0.04] dark:border-white/[0.04]"
              : ""
        } style={{ height: QUARTER_PX }} />
      ))}

      {/* Task blocks, laid out per overlap cluster */}
      {dayScheduledTasks.map((task) => {
        const p = placements.get(task._id) ?? { col: 0, totalCols: 1 };
        const widthPct = 100 / p.totalCols;
        const leftPct = p.col * widthPct;
        return (
          <ResizableTaskBlock
            key={task._id}
            task={task}
            dayStr={dayStr}
            updateTask={updateTask}
            style={{
              left: `calc(${leftPct}% + 4px)`,
              width: `calc(${widthPct}% - 8px)`,
            }}
          />
        );
      })}

      {isNow && <CurrentTimeLine />}
    </div>
  );
}

/* ─── Resizable + draggable task block on calendar grid ─── */
function ResizableTaskBlock({ task, dayStr, updateTask, style: overrideStyle }: {
  task: Doc<"tasks">;
  dayStr: string;
  updateTask: UpdateTask;
  style?: React.CSSProperties;
}) {
  const isCalendarSource = task.source === "google_calendar";
  const calColor = task.calendarColor;
  const stored = resolveTaskBlock(task) ?? { startMin: 9 * 60, endMin: 9 * 60 + DEFAULT_EVENT_MINUTES };

  // Local override while the user is moving/resizing with the keyboard, or the
  // height while a mouse resize is in progress. Cleared once Convex confirms.
  const [pending, setPending] = useState<{ startMin: number; endMin: number } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const startMin = pending?.startMin ?? stored.startMin;
  const endMin = pending?.endMin ?? stored.endMin;
  const topPx = (startMin / 60) * HOUR_HEIGHT;
  const height = dragHeight ?? Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, MIN_BLOCK_PX);
  const maxHeight = GRID_HEIGHT - topPx;

  const taskRef = useRef(task);
  taskRef.current = task;
  const mountedRef = useRef(true);
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A block unmounted mid-resize must not leave window listeners behind
      if (listenersRef.current) {
        window.removeEventListener("mousemove", listenersRef.current.move);
        window.removeEventListener("mouseup", listenersRef.current.up);
        listenersRef.current = null;
      }
    };
  }, []);

  // Commit a block change to Convex and Google
  const commitBlock = useCallback(async (next: { startMin: number; endMin: number; dateStr?: string }) => {
    const current = taskRef.current;
    const start = minutesToTime(next.startMin);
    const end = endTimeFor(start, next.endMin - next.startMin);
    const changes: Record<string, unknown> = { dueTime: start, scheduledStartTime: start, scheduledEndTime: end };
    if (next.dateStr && next.dateStr !== dayStr) changes.dueDate = next.dateStr;
    await updateTask({ id: current._id, ...changes } as TaskChanges);
    await syncChangesToGoogle(current, changes, updateTask);
  }, [dayStr, updateTask]);

  // Keyboard: arrows move by 15 min / 1 day, shift+arrows resize. Changes are
  // shown immediately and committed 400ms after the last key.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<{ startMin: number; endMin: number } | null>(null);
  const scheduleCommit = useCallback((next: { startMin: number; endMin: number }) => {
    pendingRef.current = next;
    setPending(next);
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(async () => {
      const p = pendingRef.current;
      pendingRef.current = null;
      if (!p) return;
      try { await commitBlock(p); } finally { if (mountedRef.current) setPending(null); }
    }, 400);
  }, [commitBlock]);
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const onKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    const dur = endMin - startMin;
    const step = 15;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? -1 : 1;
      if (e.shiftKey) {
        const nextEnd = Math.max(startMin + MIN_EVENT_MINUTES, Math.min(END_OF_DAY_MIN + 1, endMin + dir * step));
        scheduleCommit({ startMin, endMin: nextEnd });
      } else {
        const nextStart = Math.max(0, Math.min(END_OF_DAY_MIN + 1 - dur, startMin + dir * step));
        scheduleCommit({ startMin: nextStart, endMin: nextStart + dur });
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      clearTimeout(commitTimer.current);
      const base = pendingRef.current ?? { startMin, endMin };
      pendingRef.current = null;
      const nextDate = format(addDays(parseISO(dayStr), e.key === "ArrowLeft" ? -1 : 1), "yyyy-MM-dd");
      await commitBlock({ ...base, dateStr: nextDate });
      if (mountedRef.current) setPending(null);
      // The block re-renders in the neighbouring column; keep focus on it.
      focusWithin(document.body, `[data-task-block="${task._id}"]`);
    }
  }, [startMin, endMin, dayStr, task._id, scheduleCommit, commitBlock]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = height;
    setIsResizing(true);
    setDragHeight(startH);

    const snap = (clientY: number) => {
      const raw = startH + (clientY - startY);
      return Math.max(MIN_BLOCK_PX, Math.min(maxHeight, Math.round(raw / QUARTER_PX) * QUARTER_PX));
    };
    const onMove = (ev: MouseEvent) => setDragHeight(snap(ev.clientY));
    const onUp = async (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      listenersRef.current = null;
      const snapped = snap(ev.clientY);
      const newEndMin = startMin + (snapped / HOUR_HEIGHT) * 60;
      try {
        await commitBlock({ startMin, endMin: newEndMin });
      } finally {
        // Keep the dragged height until Convex has the new value, so the block
        // does not snap back to the old height for a frame.
        if (mountedRef.current) { setIsResizing(false); setDragHeight(null); }
      }
    };
    listenersRef.current = { move: onMove, up: onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height, maxHeight, startMin, commitBlock]);

  const isDone = task.status === "done";
  const color = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.p4;
  const shownEndMin = dragHeight !== null ? startMin + (dragHeight / HOUR_HEIGHT) * 60 : endMin;
  const startLabel = formatTime12(startMin);
  const endLabel = formatTime12(Math.min(END_OF_DAY_MIN, Math.round(shownEndMin)));
  const a11yLabel = `${task.title}, ${startLabel} to ${endLabel}, ${format(parseISO(dayStr), "EEEE, MMMM d")}${isDone ? ", done" : ""}`;

  return (
    <TaskContextMenu task={task} className="absolute" style={{ top: topPx, height, ...(overrideStyle || { left: 4, right: 4 }) }}>
    <div
      data-task-block={task._id}
      role="button"
      tabIndex={0}
      aria-label={a11yLabel}
      aria-keyshortcuts={isDone ? undefined : "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown ArrowLeft ArrowRight"}
      onKeyDown={isDone ? undefined : onKeyDown}
      onClick={(e) => e.stopPropagation()}
      draggable={!isResizing && !isDone}
      onDragStart={(e) => {
        if (isResizing || isDone) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", task._id);
        e.dataTransfer.setData("application/source-date", dayStr);
        e.dataTransfer.effectAllowed = "move";
        setDraggingTaskId(task._id);
      }}
      onDragEnd={() => setDraggingTaskId(null)}
      className={`group h-full w-full overflow-hidden rounded-[10px] shadow-3d-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-brand/60 ${
        isDone
          ? ""
          : isResizing
            ? "z-40 cursor-ns-resize ring-1 ring-brand-border"
            : "cursor-grab hover:brightness-[0.97] active:translate-y-[1px] active:cursor-grabbing"
      }`}
      style={{
        backgroundColor: `${isCalendarSource ? (calColor || "#059669") : color}${isDone ? "0c" : "18"}`,
        borderColor: `${isCalendarSource ? (calColor || "#059669") : color}${isDone ? "20" : "40"}`,
      }}
    >
      {/* Content — top-left aligned, responsive to block height */}
      <div className={`flex flex-col px-2 ${height < 36 ? "flex-row items-start gap-1.5 pt-0.5" : "gap-0.5 pt-1.5"}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          {isDone ? (
            <span
              className="flex size-[16px] shrink-0 items-center justify-center rounded-full"
              style={{ border: "2px solid #93c5fd", backgroundColor: "#93c5fd" }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ) : isCalendarSource ? (
            <span className="flex shrink-0 items-center justify-center">
              <HugeiconsIcon icon={DashedLineCircleIcon} size={16} style={{ color: calColor || "#059669" }} />
            </span>
          ) : (
            <span
              className="flex size-[16px] shrink-0 items-center justify-center rounded-full"
              style={{ border: `2px solid ${color}`, backgroundColor: "transparent" }}
            />
          )}
          <p className={`min-w-0 truncate font-semibold ${isDone ? "text-text-faint line-through decoration-text-faint" : "text-foreground"} ${height < 36 ? "text-[11px]" : "text-[13px]"}`}>{task.title}</p>
        </div>
        {height >= 44 && (
          <p className={`truncate font-medium ${isDone ? "text-text-faint" : "text-text-secondary"} ${height < 36 ? "text-[9px]" : "text-[11px]"}`} style={{ paddingLeft: height < 36 ? 0 : 20 }}>
            {startLabel} – {endLabel}
          </p>
        )}
        {height < 44 && height >= 36 && (
          <p className={`truncate pl-5 text-[10px] font-medium ${isDone ? "text-text-faint" : "text-text-muted"}`}>
            {startLabel}
          </p>
        )}
      </div>

      {/* Bottom resize handle — hidden for done tasks */}
      {!isDone && (
        <div
          onMouseDown={handleResizeStart}
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 z-30 flex h-2.5 cursor-ns-resize items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
        >
          <div className="h-[2px] w-8 rounded-full bg-text-secondary/60" />
        </div>
      )}
    </div>
    </TaskContextMenu>
  );
}

function CurrentTimeLine() {
  const [top, setTop] = useState(0);
  useEffect(() => {
    function update() {
      const now = new Date();
      setTop(((now.getHours() - START_HOUR) * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT);
    }
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top }} aria-hidden="true">
      <div className="flex items-center">
        <div className="size-2 rounded-full bg-brand-strong" />
        <div className="h-[2px] flex-1 bg-brand-strong" />
      </div>
    </div>
  );
}

function calcDuration(tasks: Doc<"tasks">[]): string {
  let totalMin = 0;
  for (const t of tasks) {
    totalMin += durationMinutes(t.scheduledStartTime, t.scheduledEndTime) ?? 0;
  }
  if (totalMin <= 0) return "";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  return h > 0 ? `${h}h` : `${m}m`;
}
