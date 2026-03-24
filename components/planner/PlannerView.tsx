"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  getCalendarList,
  type GoogleCalendar,
} from "@/app/actions/calendar";
import { fetchGoogleEventsForSync } from "@/app/actions/calendarSync";
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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowLeftDoubleIcon,
  Calendar03Icon,
  LayoutAlignLeftIcon,
  DashedLineCircleIcon,
} from "@hugeicons/core-free-icons";
import {
  format, startOfWeek, startOfMonth, endOfMonth, addDays, subDays,
  addWeeks, subWeeks, addMonths, subMonths, isToday,
  parseISO, isSameDay, isSameMonth, eachWeekOfInterval,
  startOfDay, isBefore, getDate,
} from "date-fns";

const HOUR_HEIGHT = 96;
const START_HOUR = 0;
const END_HOUR = 24;
const QUARTER_PX = HOUR_HEIGHT / 4; // 24px per 15-min slot

type CalView = "day" | "week" | "month" | number;

const viewBtnBase = "relative z-10 rounded-[7px] px-2.5 py-1.5 text-[11px] font-medium transition-all";
const viewBtnActive = `${viewBtnBase} border border-[#3a3a4a] bg-[#2a2a38] text-white shadow-[0_1px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.06)]`;
const viewBtnInactive = `${viewBtnBase} border border-transparent text-[#71717a] hover:text-[#a1a1aa]`;
const navBtn = "flex size-[30px] items-center justify-center rounded-[7px] border border-[#2a2a36] bg-[#131318] text-[#a1a1aa] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#3a3a4a] hover:text-white active:translate-y-[1px] active:shadow-[0_1px_0_0_rgba(0,0,0,0.4)]";

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

export default function PlannerView() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calAnchor, setCalAnchor] = useState(new Date());
  const [calView, setCalViewRaw] = useState<CalView>("week");
  const [showDone, setShowDone] = useState(false);
  const tasks = useQuery(api.tasks.list, {});
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);

  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendar[]>([]);
  const bulkUpsert = useMutation(api.tasks.bulkUpsertFromGoogle);
  const removeDeleted = useMutation(api.tasks.removeDeletedGoogleEvents);

  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set());

  // Hydrate hidden calendars from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("unifocus-hidden-calendars");
      if (stored) setHiddenCalendarIds(new Set(JSON.parse(stored)));
    } catch {}
  }, []);
  const [showTaskSidebar, setShowTaskSidebar] = useState(true);

  // Hydrate sidebar visibility from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("unifocus-planner-sidebar");
      if (stored === "false") setShowTaskSidebar(false);
    } catch {}
  }, []);
  const [addingTask, setAddingTask] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const calBodyRef = useRef<HTMLDivElement>(null);

  // Load persisted view on mount
  useEffect(() => { setCalViewRaw(loadCalView()); }, []);

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

  const weekOfMonth = Math.ceil(getDate(calAnchor) / 7);
  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");

  // Sync calendar anchor when selected date changes
  // Don't sync calAnchor to selectedDate — clicking a day header should
  // only highlight it, not re-anchor the entire view. calAnchor is only
  // changed by nav buttons, "Today" button, and the date picker.

  // Nav
  const navForward = useCallback(() => {
    if (calView === "day") setCalAnchor((d) => addDays(d, 1));
    else if (calView === "week") setCalAnchor((d) => addWeeks(d, 1));
    else if (calView === "month") setCalAnchor((d) => addMonths(d, 1));
    else setCalAnchor((d) => addDays(d, 1)); // X-days: scroll by 1 day
  }, [calView]);

  const navBackward = useCallback(() => {
    if (calView === "day") setCalAnchor((d) => subDays(d, 1));
    else if (calView === "week") setCalAnchor((d) => subWeeks(d, 1));
    else if (calView === "month") setCalAnchor((d) => subMonths(d, 1));
    else setCalAnchor((d) => subDays(d, 1)); // X-days: scroll by 1 day
  }, [calView]);

  // Buffer days for infinite scroll (not used for month view)
  const BUFFER = 14; // 14 days on each side
  const allScrollDays = useMemo(() => {
    if (calView === "month") return [];
    const numVisible = calView === "day" ? 1 : calView === "week" ? 7 : calView;
    const startDay = subDays(visibleDays[0] || calAnchor, BUFFER);
    const totalDays = BUFFER + numVisible + BUFFER;
    return Array.from({ length: totalDays }, (_, i) => addDays(startDay, i));
  }, [calAnchor, calView, visibleDays]);

  // Horizontal scroll refs
  const hScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const isResettingScroll = useRef(false);

  // Sync header scroll with time grid scroll
  useEffect(() => {
    const grid = hScrollRef.current;
    const header = headerScrollRef.current;
    if (!grid || !header) return;
    function onScroll() {
      if (header && grid) header.scrollLeft = grid.scrollLeft;
    }
    grid.addEventListener("scroll", onScroll, { passive: true });
    return () => grid.removeEventListener("scroll", onScroll);
  }, [calView]);

  // Center scroll to show the visible days on mount / anchor change
  useEffect(() => {
    if (calView === "month") return;
    const grid = hScrollRef.current;
    if (!grid) return;
    const numVisible = calView === "day" ? 1 : calView === "week" ? 7 : calView;
    const colWidth = grid.clientWidth / numVisible;
    isResettingScroll.current = true;
    grid.scrollLeft = BUFFER * colWidth;
    requestAnimationFrame(() => { isResettingScroll.current = false; });
  }, [calAnchor, calView]);

  // Detect when user scrolls near edges and shift anchor
  useEffect(() => {
    if (calView === "month") return;
    const grid = hScrollRef.current;
    if (!grid) return;
    const numVisible = calView === "day" ? 1 : calView === "week" ? 7 : calView;

    function onScroll() {
      if (isResettingScroll.current) return;
      const colWidth = grid!.clientWidth / numVisible;
      const leftBuffer = BUFFER * colWidth;
      const rightBuffer = (BUFFER + numVisible) * colWidth;
      const scrollRight = grid!.scrollLeft + grid!.clientWidth;
      const totalWidth = grid!.scrollWidth;

      // If scrolled past 70% of left buffer, shift anchor backward
      if (grid!.scrollLeft < leftBuffer * 0.3) {
        const daysScrolled = Math.round((leftBuffer - grid!.scrollLeft) / colWidth);
        setCalAnchor((d) => subDays(d, Math.max(1, daysScrolled)));
      }
      // If scrolled past 70% of right buffer
      else if (scrollRight > totalWidth - leftBuffer * 0.3) {
        const daysScrolled = Math.round((scrollRight - rightBuffer) / colWidth);
        setCalAnchor((d) => addDays(d, Math.max(1, daysScrolled)));
      }
    }

    grid.addEventListener("scroll", onScroll, { passive: true });
    return () => grid.removeEventListener("scroll", onScroll);
  }, [calView]);

  // Fetch Google Calendar list once
  useEffect(() => {
    getCalendarList().then(setGoogleCalendars).catch(() => {});
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

  // Sync Google Calendar events → Convex (runs on view/anchor changes)
  const lastSyncRef = useRef<string>("");
  useEffect(() => {
    async function sync() {
      let timeMin: string, timeMax: string;
      if (calView === "month") {
        timeMin = startOfMonth(calAnchor).toISOString();
        timeMax = addDays(endOfMonth(calAnchor), 1).toISOString();
      } else if (visibleDays.length > 0) {
        timeMin = subDays(visibleDays[0], 7).toISOString();
        timeMax = addDays(visibleDays[visibleDays.length - 1], 8).toISOString();
      } else return;

      // Deduplicate — don't re-sync if the range hasn't changed
      const syncKey = `${timeMin}|${timeMax}`;
      if (syncKey === lastSyncRef.current) return;
      lastSyncRef.current = syncKey;

      setCalendarLoading(true);
      setCalendarError(null);
      try {
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const googleEvents = await fetchGoogleEventsForSync(timeMin, timeMax, userTz);
        if (googleEvents.length > 0) {
          await bulkUpsert({ events: googleEvents });
        }
        // Clean up events deleted from Google Calendar
        const knownIds = googleEvents.map((e) => e.googleEventId);
        const rangeStart = timeMin.slice(0, 10); // ISO date
        const rangeEnd = timeMax.slice(0, 10);
        await removeDeleted({ knownGoogleEventIds: knownIds, syncRangeStart: rangeStart, syncRangeEnd: rangeEnd });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to sync calendar";
        setCalendarError(msg);
        console.error("Calendar sync error:", msg);
      } finally {
        setCalendarLoading(false);
      }
    }
    sync();
  }, [calAnchor, calView, bulkUpsert, removeDeleted]);

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
    const realToday = startOfDay(new Date());
    const viewingToday = isSameDay(selectedDate, new Date());
    for (const t of visibleTasks) {
      const d = t.dueDate || t.scheduledDate;
      if (!d) continue;
      const pd = parseISO(d);
      if (t.status === "done") {
        if (isSameDay(pd, selectedDate)) done.push(t);
        continue;
      }
      // Overdue = only local tasks when viewing today — calendar events from the past are not overdue
      if (viewingToday && isBefore(pd, realToday) && !isGoogleCalEvent(t)) {
        overdue.push(t);
      } else if (isSameDay(pd, selectedDate)) {
        dayList.push(t);
      }
    }
    return { overdue, day: dayList, done };
  }, [visibleTasks, selectedDate]);

  async function handleAdd() {
    if (!newTitle.trim()) return;
    await createTask({ title: newTitle.trim(), dueDate: selectedDateStr });
    setNewTitle("");
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (addingTask) requestAnimationFrame(() => inputRef.current?.focus());
    else setNewTitle("");
  }, [addingTask]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "c" || e.key === "C") setAddingTask(true);
      if (e.key === "t" || e.key === "T") { setSelectedDate(new Date()); setCalAnchor(new Date()); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalTasks = dayTasks.overdue.length + dayTasks.day.length;
  const { width: panelWidth, onMouseDown: handleResize } = useResizablePanel("planner-today", 380, 280, 500);
  const overdueDuration = calcDuration(dayTasks.overdue);

  // Left panel drop
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
    await updateTask({ id: taskId as Parameters<typeof updateTask>[0]["id"], dueDate: selectedDateStr });
  }, [selectedDateStr, dayTasks, updateTask]);

  // View label for header
  const viewLabel = calView === "month" ? format(calAnchor, "MMMM yyyy") : `${format(calAnchor, "MMM yyyy")}`;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel (task sidebar) ── */}
      {showTaskSidebar && <div
        className="relative flex shrink-0 flex-col border-r border-dashed border-[#3a3a48]"
        style={{ width: panelWidth }}
        onDragEnter={(e) => { e.preventDefault(); leftDragCounter.current++; setLeftDropOver(true); }}
        onDragLeave={() => { leftDragCounter.current--; if (leftDragCounter.current <= 0) { leftDragCounter.current = 0; setLeftDropOver(false); } }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop={handleLeftDrop}
      >
        {leftDropOver && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-[#a78bfa]/60 bg-[#a78bfa]/5" />
        )}

        {/* Header with date picker + sidebar toggle */}
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <Popover>
            <PopoverTrigger render={
              <button className="flex items-center gap-1.5 text-[15px] font-bold text-white transition-colors hover:text-[#a78bfa]" />
            }>
              {isToday(selectedDate) ? "Today" : format(selectedDate, "EEE, MMM d")}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5l3 3 3-3" /></svg>
            </PopoverTrigger>
            <PopoverPopup sideOffset={4} className="p-0">
              <Calendar mode="single" selected={selectedDate} onSelect={(d) => { if (d) { setSelectedDate(d); setCalAnchor(d); } }} />
              <div className="border-t px-3 py-2">
                <button onClick={() => { setSelectedDate(new Date()); setCalAnchor(new Date()); }}
                  className="rounded-[7px] border border-[#2a2a36] bg-[#131318] px-3 py-1.5 text-xs font-medium text-[#a78bfa] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#3a3a4a] hover:text-white active:translate-y-[1px] active:shadow-[0_1px_0_0_rgba(0,0,0,0.4)]">
                  Go to today
                </button>
              </div>
            </PopoverPopup>
          </Popover>

          <button
            onClick={toggleTaskSidebar}
            className={navBtn}
            title="Hide sidebar"
          >
            <HugeiconsIcon icon={LayoutAlignLeftIcon} size={14} />
          </button>
        </div>

        {/* Add task */}
        <div
          onClick={() => { if (!addingTask) setAddingTask(true); }}
          className={`mx-5 mb-3 flex items-center justify-between rounded-[10px] border px-3.5 py-2.5 transition-colors ${
            addingTask ? "border-[#4a4a58] bg-[#1a1a22]" : "cursor-pointer border-[#333340] bg-[#16161e] hover:border-[#4a4a58] hover:bg-[#1e1e28]"
          }`}
        >
          {addingTask ? (
            <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter = quick add, Tab = full editor, Esc = cancel"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                if (e.key === "Tab") { e.preventDefault(); setAddingTask(false); setCreateDialogOpen(true); }
                if (e.key === "Escape") setAddingTask(false);
              }}
              onBlur={() => { if (!newTitle.trim()) setAddingTask(false); }}
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#71717a]"
            />
          ) : (
            <>
              <span className="flex items-center gap-2.5 text-sm text-[#a1a1aa]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>
                Add new task
              </span>
              <Kbd>C</Kbd>
            </>
          )}
        </div>

        {/* Tasks */}
        <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-4">
          {dayTasks.overdue.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-[#ef4444]">Overdue</span>
                  <span className="text-[13px] font-medium text-[#a1a1aa]">{dayTasks.overdue.length}</span>
                </div>
                {overdueDuration && <span className="text-[11px] font-medium text-[#a1a1aa]">{overdueDuration}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                {dayTasks.overdue.map((t) => <KanbanCard key={t._id} task={t} isOverdue context="sidebar" />)}
              </div>
            </div>
          )}
          {/* Unified task list sorted by time (includes local + google_calendar tasks) */}
          {(() => {
            const sorted = [...dayTasks.day].sort((a, b) => {
              const timeA = (a as Record<string, unknown>).dueTime as string || a.scheduledStartTime || "99:99";
              const timeB = (b as Record<string, unknown>).dueTime as string || b.scheduledStartTime || "99:99";
              return timeA.localeCompare(timeB);
            });

            if (sorted.length === 0) return null;
            return (
              <div className="flex flex-col gap-1.5">
                {sorted.map((t) => {
                  if (t.source === "google_calendar") {
                    const color = (t as Record<string, unknown>).calendarColor as string || "#059669";
                    const startStr = t.scheduledStartTime || "";
                    const endStr = t.scheduledEndTime || "";
                    let timeStr = "";
                    if (startStr && endStr) {
                      const fmtTime = (ts: string) => {
                        const [hh, mm] = ts.split(":").map(Number);
                        const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
                        const ampm = hh < 12 ? "am" : "pm";
                        return `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
                      };
                      timeStr = `${fmtTime(startStr)} – ${fmtTime(endStr)}`;
                    } else if (startStr) {
                      const [hh, mm] = startStr.split(":").map(Number);
                      const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
                      const ampm = hh < 12 ? "am" : "pm";
                      timeStr = `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
                    } else if ((t as Record<string, unknown>).isAllDay) {
                      timeStr = "All day";
                    }
                    return (
                      <TaskContextMenu key={t._id} task={t}>
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", t._id);
                            e.dataTransfer.setData("application/source-date", t.dueDate || t.scheduledDate || "");
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="flex cursor-grab flex-col gap-1.5 rounded-[10px] border border-[#333340] bg-[#1a1a22] px-3 py-2.5 shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#4a4a58] hover:bg-[#1e1e28] active:cursor-grabbing">
                          {/* Row 1: Icon + Title */}
                          <div className="flex min-w-0 items-start gap-2.5">
                            <HugeiconsIcon icon={DashedLineCircleIcon} size={16} style={{ color }} className="mt-0.5 shrink-0" />
                            <span
                              className="min-w-0 flex-1 text-sm font-medium leading-snug text-[#e4e4e7]"
                              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                            >
                              {t.title || "(No title)"}
                            </span>
                          </div>
                          {/* Row 2: Time chip */}
                          {timeStr && (
                            <div className="pl-[26px]">
                              <span className="inline-flex rounded-[6px] bg-[#1a1a22] px-2 py-0.5 text-[11px] font-medium text-[#a1a1aa] shadow-[0_1px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                                {timeStr}
                              </span>
                            </div>
                          )}
                        </div>
                      </TaskContextMenu>
                    );
                  }
                  return <KanbanCard key={t._id} task={t} context="sidebar" />;
                })}
              </div>
            );
          })()}

          {totalTasks === 0 && !showDone && (
            <div className="mt-auto flex items-center gap-2 pb-2">
              <span className="text-[12px] tracking-wide text-[#52525b]">No tasks</span>
              <span className="flex size-[18px] items-center justify-center rounded-[5px] border border-[#3a3a48] bg-[#1a1a22] text-[10px] font-bold text-[#606068] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">0</span>
            </div>
          )}

          {/* Done tasks toggle */}
          {dayTasks.done.length > 0 && (
            <div className="mt-4 border-t border-[#2a2a32] pt-3">
              <button
                onClick={() => setShowDone(!showDone)}
                className="mb-2 flex w-full items-center gap-2 text-[12px] font-medium text-[#52525b] transition-colors hover:text-[#a1a1aa]"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                  className={`transition-transform ${showDone ? "rotate-90" : ""}`}>
                  <path d="M3.5 2L6.5 5L3.5 8" />
                </svg>
                Completed
                <span className="flex size-[16px] items-center justify-center rounded-full border border-[#3a3a48] text-[9px] font-medium text-[#52525b]">
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

      {/* ── Right panel: Calendar ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2a32] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-bold text-white">{viewLabel}</span>
            {calView !== "month" && <span className="text-[13px] font-medium text-[#71717a]">W{weekOfMonth}</span>}
          </div>
          <div className="flex items-center gap-2">
            {/* View switcher */}
            <div className="flex items-center rounded-[10px] border border-[#2a2a36] bg-[#131318] p-[3px] shadow-[0_2px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              {([
                { id: "day" as const, label: "D" },
                { id: "week" as const, label: "W" },
                { id: "month" as const, label: "M" },
              ] as const).map((v) => (
                <button key={v.id} onClick={() => setCalView(v.id)}
                  className={calView === v.id ? viewBtnActive : viewBtnInactive}>
                  {v.label}
                </button>
              ))}
              <Menu>
                <MenuTrigger render={
                  <button className={typeof calView === "number" ? viewBtnActive : viewBtnInactive} />
                }>
                  {typeof calView === "number" ? `${calView}D` : "X"}
                </MenuTrigger>
                <MenuPopup>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <MenuItem key={n} onClick={() => setCalView(n)}>
                      {n} days
                      {calView === n && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>

            {/* Today + nav */}
            <button onClick={() => { setCalAnchor(new Date()); setSelectedDate(new Date()); }} className={navBtn}>
              <span className="text-[11px] font-bold">T</span>
            </button>
            <button onClick={navBackward} className={navBtn}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            </button>
            <button onClick={navForward} className={navBtn}>
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </button>

            {/* Divider */}
            <div className="mx-1 h-5 w-px bg-[#2a2a36]" />

            {/* Calendar picker */}
            <Menu>
              <MenuTrigger render={<button className={navBtn} />}>
                <HugeiconsIcon icon={Calendar03Icon} size={14} />
              </MenuTrigger>
              <MenuPopup>
                {googleCalendars.length === 0 ? (
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
                className={`${navBtn} border-[#a78bfa]/30 text-[#a78bfa]`}
                title="Show task sidebar"
              >
                <HugeiconsIcon icon={LayoutAlignLeftIcon} size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Calendar status */}
        {calendarError && (
          <div className="flex items-center gap-2 border-b border-[#2a2a32] bg-[#1a1018] px-5 py-2">
            <span className="text-[12px] text-[#f87171]">⚠ {calendarError}</span>
            <button onClick={() => setCalendarError(null)} className="text-[11px] text-[#71717a] hover:text-white">dismiss</button>
          </div>
        )}
        {calendarLoading && !calendarError && (
          <div className="flex items-center gap-2 border-b border-[#2a2a32] px-5 py-1.5">
            <div className="h-0.5 w-20 overflow-hidden rounded-full bg-[#1f1f28]">
              <div className="h-full w-8 animate-[shimmer_1s_ease-in-out_infinite] rounded-full bg-[#a78bfa]/60" />
            </div>
            <span className="text-[11px] text-[#52525b]">Loading calendar...</span>
          </div>
        )}

        {/* Calendar body */}
        <div ref={calBodyRef} className="flex flex-1 flex-col overflow-hidden">
          {calView === "month" ? (
            <div className="flex-1 overflow-y-auto">
              <MonthGrid
                anchor={calAnchor}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                tasks={visibleTasks}
                updateTask={updateTask}
              />
            </div>
          ) : (
            <>
              {/* Day headers — scrolls in sync with time grid */}
              <div className="flex border-b border-[#2a2a32]">
                <div className="w-14 shrink-0 px-2 py-2 text-[11px] text-[#52525b]">
                  {Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()?.replace("_", " ") || ""}
                </div>
                <div
                  ref={headerScrollRef}
                  className="flex flex-1 overflow-hidden"
                >
                  {allScrollDays.map((day) => {
                    const numVisible = calView === "day" ? 1 : calView === "week" ? 7 : calView;
                    const pct = 100 / numVisible;
                    const isNow = isToday(day);
                    const isSel = isSameDay(day, selectedDate);
                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => setSelectedDate(day)}
                        className={`flex shrink-0 items-center gap-1.5 px-2 py-2 transition-colors ${isSel ? "bg-[#1a1a28]" : "hover:bg-[#14141c]"}`}
                        style={{ width: `${pct}%` }}
                      >
                        <span className={`text-[12px] font-medium ${isNow ? "text-white" : isSel ? "text-[#a78bfa]" : "text-[#a1a1aa]"}`}>
                          {format(day, "EEE")}
                        </span>
                        <span className={`flex size-[22px] items-center justify-center rounded-[5px] text-[12px] font-bold ${
                          isNow ? "bg-[#7c3aed] text-white" : isSel ? "bg-[#2a2a3a] text-[#a78bfa]" : "text-[#a1a1aa]"
                        }`}>
                          {format(day, "d")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time grid — horizontal + vertical scroll */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto">
                <div className="flex" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
                  {/* Hour labels — sticky left */}
                  <div className="sticky left-0 z-10 w-14 shrink-0 bg-[#0c0c10]">
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map((hour) => (
                      <div key={hour} className="flex items-start justify-end pr-2 text-[11px] text-[#52525b]"
                        style={{ height: HOUR_HEIGHT, paddingTop: 2 }}>
                        {hour === 0 ? "12 am" : hour < 12 ? `${hour} am` : hour === 12 ? "12 pm" : `${hour - 12} pm`}
                      </div>
                    ))}
                  </div>

                  {/* Scrollable day columns */}
                  <div
                    ref={hScrollRef}
                    className="flex flex-1 snap-x snap-mandatory overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  >
                    {allScrollDays.map((day) => {
                      const numVisible = calView === "day" ? 1 : calView === "week" ? 7 : calView;
                      const pct = 100 / numVisible;
                      return (
                        <div key={day.toISOString()} className="shrink-0 snap-start" style={{ width: `${pct}%` }}>
                          <CalendarDayColumn
                            day={day}
                            selectedDate={selectedDate}
                            tasks={visibleTasks}
                            updateTask={updateTask}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center gap-3 border-t border-[#2a2a32] px-5 py-2">
          <span className="text-[12px] font-medium text-[#7c3aed]">{format(new Date(), "h:mm a")}</span>
          <div className="h-px flex-1 border-t border-dashed border-[#3a3a48]" />
          <span className="text-[12px] font-medium text-[#a1a1aa]">{totalTasks} Task{totalTasks !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <TaskEditDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} defaultDueDate={selectedDateStr} />
    </div>
  );
}

/* ─── Month Grid (Google Calendar style) with drop support ─── */
function MonthGrid({ anchor, selectedDate, onSelectDate, tasks, updateTask }: {
  anchor: Date;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  tasks: Doc<"tasks">[];
  updateTask: ReturnType<typeof useMutation<typeof api.tasks.update>>;
}) {
  const mStart = startOfMonth(anchor);
  const mEnd = endOfMonth(anchor);
  const weeks = eachWeekOfInterval({ start: mStart, end: mEnd }, { weekStartsOn: 1 });
  // Show ALL tasks on calendar including done (done tasks get visual styling)
  const activeTasks = tasks;

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-[#2a2a32]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[11px] font-medium text-[#71717a]">{d}</div>
        ))}
      </div>
      {weeks.map((ws) => (
        <div key={ws.toISOString()} className="grid min-h-[100px] grid-cols-7 border-b border-[#1a1a22]">
          {Array.from({ length: 7 }, (_, i) => (
            <MonthDayCell
              key={i}
              day={addDays(ws, i)}
              anchor={anchor}
              selectedDate={selectedDate}
              onSelectDate={onSelectDate}
              activeTasks={activeTasks}
              updateTask={updateTask}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MonthDayCell({ day, anchor, selectedDate, onSelectDate, activeTasks, updateTask }: {
  day: Date; anchor: Date; selectedDate: Date;
  onSelectDate: (d: Date) => void;
  activeTasks: Doc<"tasks">[];
  updateTask: ReturnType<typeof useMutation<typeof api.tasks.update>>;
}) {
  const [isOver, setIsOver] = useState(false);
  const dragCounter = useRef(0);
  const isNow = isToday(day);
  const isSel = isSameDay(day, selectedDate);
  const isOtherMonth = !isSameMonth(day, anchor);
  const dayStr = format(day, "yyyy-MM-dd");

  const dayTasks = activeTasks.filter((t) => {
    const d = t.dueDate || t.scheduledDate;
    return d && isSameDay(parseISO(d), day);
  });
  const calendarTasks = dayTasks.filter((t) => t.source === "google_calendar");
  const localTasks = dayTasks.filter((t) => t.source !== "google_calendar");

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    await updateTask({ id: taskId as Parameters<typeof updateTask>[0]["id"], dueDate: dayStr });
  }, [dayStr, updateTask]);

  return (
    <div
      onClick={() => onSelectDate(day)}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); } }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleDrop}
      className={`relative flex cursor-pointer flex-col gap-0.5 border-r border-[#1a1a22] p-1.5 text-left transition-colors last:border-r-0 ${
        isSel ? "bg-[#1a1a28]" : "hover:bg-[#14141c]"
      } ${isOtherMonth ? "opacity-40" : ""}`}
    >
      {isOver && (
        <div className="pointer-events-none absolute inset-0.5 rounded-md border-2 border-dashed border-[#a78bfa]/60 bg-[#a78bfa]/5" />
      )}
      <span className={`mb-0.5 flex size-[24px] items-center justify-center self-end rounded-full text-[12px] font-bold ${
        isNow ? "bg-[#7c3aed] text-white" : isSel ? "text-[#a78bfa]" : "text-[#a1a1aa]"
      }`}>
        {format(day, "d")}
      </span>
      {calendarTasks.slice(0, 2).map((t) => {
        const done = t.status === "done";
        return (
          <TaskContextMenu key={t._id} task={t}>
            <div className={`truncate rounded-[3px] px-1 py-px text-[10px] font-medium ${done ? "opacity-70 line-through" : "text-white"}`}
              style={{ backgroundColor: (t as Record<string, unknown>).calendarColor as string || "#059669" }}>
              {t.title || "(No title)"}
            </div>
          </TaskContextMenu>
        );
      })}
      {localTasks.slice(0, 2).map((t) => {
        const done = t.status === "done";
        return (
          <TaskContextMenu key={t._id} task={t}>
            <div className="flex items-center gap-1 truncate px-1 py-px text-[10px]">
              <span className="size-1.5 shrink-0 rounded-full" style={{
                backgroundColor: done ? "#52525b" : PRIORITY_COLORS[t.priority]
              }} />
              <span className={`truncate ${done ? "text-[#71717a] line-through" : "text-[#d4d4d8]"}`}>{t.title}</span>
            </div>
          </TaskContextMenu>
        );
      })}
      {dayTasks.length > 4 && (
        <span className="px-1 text-[9px] text-[#71717a]">+{dayTasks.length - 4} more</span>
      )}
    </div>
  );
}

/* ─── Snap to 15-min grid helper ─── */
const HALF_HOUR_PX = HOUR_HEIGHT / 2; // for default block height (30-min)

function yToSnappedTime(y: number): { timeStr: string; topPx: number; label: string } {
  const slot = Math.max(0, Math.round(y / QUARTER_PX)); // snap to nearest 15-min
  const totalMin = slot * 15;
  const hour = Math.min(23, Math.floor(totalMin / 60));
  const minute = totalMin % 60;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const topPx = slot * QUARTER_PX;
  const ampm = hour < 12 ? "am" : "pm";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const label = `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
  return { timeStr, topPx, label };
}

/* ─── Priority colors imported from @/lib/constants ─── */

/* ─── Calendar day column with 30-min snap drop ─── */
function CalendarDayColumn({ day, selectedDate, tasks, updateTask }: {
  day: Date;
  selectedDate: Date;
  tasks: Doc<"tasks">[];
  updateTask: ReturnType<typeof useMutation<typeof api.tasks.update>>;
}) {
  const [isOver, setIsOver] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<{ topPx: number; label: string } | null>(null);
  const dragCounter = useRef(0);
  const columnRef = useRef<HTMLDivElement>(null);
  const isSelected = isSameDay(day, selectedDate);
  const dayStr = format(day, "yyyy-MM-dd");

  // All tasks with scheduled time that belong to this day (including done)
  const dayScheduledTasks = useMemo(() => {
    return tasks.filter((t) => {
      const dateStr = t.dueDate || t.scheduledDate;
      if (!dateStr) return false;
      if (!isSameDay(parseISO(dateStr), day)) return false;
      return !!t.scheduledStartTime && !!t.scheduledEndTime;
    });
  }, [tasks, day]);

  // All tasks rendered uniformly through ResizableTaskBlock (with overlap detection)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // getBoundingClientRect already accounts for scroll position
    // so e.clientY - rect.top gives the correct absolute position within the column
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const { topPx, label } = yToSnappedTime(y);
    setDropIndicator({ topPx, label });
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsOver(false);
    setDropIndicator(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    // Check if this is a same-day reposition or a cross-day move
    const sourceDate = e.dataTransfer.getData("application/source-date");
    const isSameDayDrop = sourceDate === dayStr;

    // Calculate drop time from cursor position
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const { timeStr } = yToSnappedTime(y);

    if (isSameDayDrop) {
      await updateTask({ id: taskId as Parameters<typeof updateTask>[0]["id"], dueTime: timeStr });
    } else {
      await updateTask({ id: taskId as Parameters<typeof updateTask>[0]["id"], dueDate: dayStr, dueTime: timeStr });
    }

    // Sync to Google Calendar if the task has a linked event
    const droppedTask = tasks?.find((t) => t._id === taskId);
    if (droppedTask) {
      try {
        const { syncTaskUpdateToGoogle } = await import("@/lib/google-sync");
        await syncTaskUpdateToGoogle(droppedTask, { dueDate: dayStr, dueTime: timeStr });
      } catch (err) {
        console.warn("Google Calendar sync failed:", err);
      }
    }
  }, [dayStr, updateTask, tasks]);

  return (
    <div ref={columnRef}
      className={`relative flex-1 border-l ${isSelected ? "border-[#2a2a3a]" : "border-[#1f1f28]"}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setIsOver(true); }}
      onDragLeave={() => {
        dragCounter.current--;
        if (dragCounter.current <= 0) { dragCounter.current = 0; setIsOver(false); setDropIndicator(null); }
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 15-min box drop indicator */}
      {isOver && dropIndicator && (
        <div
          className="pointer-events-none absolute left-1 right-1 z-30 rounded-[10px] border-2 border-dashed border-[#a78bfa]/70 bg-[#a78bfa]/10"
          style={{ top: dropIndicator.topPx, height: HALF_HOUR_PX }}
        >
          <span className="absolute right-1 top-1 rounded-[5px] bg-[#a78bfa] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-[0_1px_0_0_rgba(0,0,0,0.3)]">
            {dropIndicator.label}
          </span>
        </div>
      )}

      {/* 15-min grid lines: hour = solid, 30-min = dashed, 15-min = faint */}
      {Array.from({ length: (END_HOUR - START_HOUR) * 4 }, (_, i) => (
        <div key={i} className={
          i % 4 === 0
            ? "border-b border-[#1e1e28]"
            : i % 2 === 0
              ? "border-b border-dashed border-[#181820]"
              : "border-b border-[#131318]"
        } style={{ height: QUARTER_PX }} />
      ))}

      {/* All tasks — unified with overlap detection */}
      {(() => {
        type TaskLayout = { task: Doc<"tasks">; startMin: number; endMin: number; col: number; totalCols: number };
        const parsed: TaskLayout[] = [];
        for (const t of dayScheduledTasks) {
          if (!t.scheduledStartTime || !t.scheduledEndTime) continue;
          const [sh, sm] = t.scheduledStartTime.split(":").map(Number);
          const [eh, em] = t.scheduledEndTime.split(":").map(Number);
          const sMin = (sh - START_HOUR) * 60 + sm;
          let eMin = (eh - START_HOUR) * 60 + em;
          // Handle midnight-crossing tasks: treat end time as end-of-day (23:59) for display
          if (eMin <= sMin) {
            eMin = (23 - START_HOUR) * 60 + 59;
          }
          parsed.push({ task: t, startMin: sMin, endMin: eMin, col: 0, totalCols: 1 });
        }
        parsed.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

        // Assign overlap columns
        const cols: TaskLayout[][] = [];
        for (const item of parsed) {
          let placed = false;
          for (let c = 0; c < cols.length; c++) {
            const last = cols[c][cols[c].length - 1];
            if (last.endMin <= item.startMin) { item.col = c; cols[c].push(item); placed = true; break; }
          }
          if (!placed) { item.col = cols.length; cols.push([item]); }
        }
        for (const item of parsed) {
          const overlapping = parsed.filter((o) => o.startMin < item.endMin && o.endMin > item.startMin);
          item.totalCols = Math.max(...overlapping.map((o) => o.col + 1));
        }

        return parsed.map(({ task, col, totalCols }) => {
          const widthPct = 100 / totalCols;
          const leftPct = col * widthPct;
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
        });
      })()}

      {isToday(day) && <CurrentTimeLine />}
    </div>
  );
}

/* ─── Resizable + draggable task block on calendar grid ─── */
function ResizableTaskBlock({ task, dayStr, updateTask, style: overrideStyle }: {
  task: Doc<"tasks">;
  dayStr: string;
  updateTask: ReturnType<typeof useMutation<typeof api.tasks.update>>;
  style?: React.CSSProperties;
}) {
  const isCalendarSource = task.source === "google_calendar";
  const calColor = (task as Record<string, unknown>).calendarColor as string | undefined;
  const MIN_BLOCK_HEIGHT = QUARTER_PX * 2; // 30 min minimum
  const time = (task as Record<string, unknown>).dueTime as string | undefined || task.scheduledStartTime || "09:00";
  const [h, m] = time.split(":").map(Number);
  const startMin = (h - START_HOUR) * 60 + m;
  const topPx = (startMin / 60) * HOUR_HEIGHT;

  // Calculate initial height from scheduled times
  let initialHeight = HALF_HOUR_PX;
  if (task.scheduledStartTime && task.scheduledEndTime) {
    const [sh, sm] = task.scheduledStartTime.split(":").map(Number);
    const [eh, em] = task.scheduledEndTime.split(":").map(Number);
    const dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur > 0) initialHeight = (dur / 60) * HOUR_HEIGHT;
  }

  const [height, setHeight] = useState(Math.max(initialHeight, MIN_BLOCK_HEIGHT));
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(0);

  // Sync height when task data changes externally
  useEffect(() => {
    if (!isResizing) {
      let h2 = HALF_HOUR_PX;
      if (task.scheduledStartTime && task.scheduledEndTime) {
        const [sh2, sm2] = task.scheduledStartTime.split(":").map(Number);
        const [eh2, em2] = task.scheduledEndTime.split(":").map(Number);
        const dur2 = (eh2 * 60 + em2) - (sh2 * 60 + sm2);
        if (dur2 > 0) h2 = (dur2 / 60) * HOUR_HEIGHT;
      }
      setHeight(Math.max(h2, MIN_BLOCK_HEIGHT));
    }
  }, [task.scheduledStartTime, task.scheduledEndTime, isResizing]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartH.current = height;

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - resizeStartY.current;
      const raw = resizeStartH.current + dy;
      // Snap to 15-min increments
      const snapped = Math.max(MIN_BLOCK_HEIGHT, Math.round(raw / QUARTER_PX) * QUARTER_PX);
      setHeight(snapped);
    };

    const onUp = async (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setIsResizing(false);

      const dy = ev.clientY - resizeStartY.current;
      const raw = resizeStartH.current + dy;
      const snapped = Math.max(MIN_BLOCK_HEIGHT, Math.round(raw / QUARTER_PX) * QUARTER_PX);
      const durationMin = (snapped / HOUR_HEIGHT) * 60;
      const endTotalMin = startMin + durationMin;
      const endH = Math.min(23, Math.floor(endTotalMin / 60));
      const endM = Math.round(endTotalMin % 60);
      const endTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
      const startTimeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

      await updateTask({
        id: task._id as Parameters<typeof updateTask>[0]["id"],
        scheduledStartTime: startTimeStr,
        scheduledEndTime: endTimeStr,
      });

      // Sync resize to Google Calendar
      try {
        const { syncTaskUpdateToGoogle } = await import("@/lib/google-sync");
        await syncTaskUpdateToGoogle(task, { scheduledStartTime: startTimeStr, scheduledEndTime: endTimeStr });
      } catch (err) {
        console.warn("Google Calendar resize sync failed:", err);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height, startMin, h, m, task._id, task.googleEventId, task.googleCalendarId, task.dueDate, task.scheduledDate, updateTask]);

  const isDone = task.status === "done";
  const color = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.p4;
  const fmtH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "am" : "pm";

  // Compute displayed end time
  const durationMin = (height / HOUR_HEIGHT) * 60;
  const endTotalMin = startMin + durationMin;
  const endHour = Math.min(23, Math.floor(endTotalMin / 60));
  const endMin = Math.round(endTotalMin % 60);
  const endFmtH = endHour === 0 ? 12 : endHour > 12 ? endHour - 12 : endHour;
  const endAmpm = endHour < 12 ? "am" : "pm";

  return (
    <TaskContextMenu task={task} className="absolute overflow-hidden" style={{ top: topPx, height, ...(overrideStyle || { left: 4, right: 4 }) }}>
    <div
      draggable={!isResizing && !isDone}
      onDragStart={(e) => {
        if (isResizing || isDone) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", task._id);
        e.dataTransfer.setData("application/source-date", dayStr);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group h-full w-full overflow-hidden rounded-[10px] border shadow-[0_2px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)] ${
        isDone
          ? "border-[#2a2a32] bg-[#1a1a22] opacity-70"
          : isResizing
            ? "z-40 cursor-ns-resize border-[#a78bfa]/50 ring-1 ring-[#a78bfa]/30 bg-[#1a1a22]"
            : "border-[#333340] bg-[#1a1a22] cursor-grab active:cursor-grabbing"
      }`}
    >
      {/* Content — top-left aligned, responsive to block height */}
      <div className={`flex flex-col px-2 ${height < 36 ? "flex-row items-start gap-1.5 pt-0.5" : "gap-0.5 pt-1.5"}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          {isCalendarSource ? (
            <HugeiconsIcon icon={DashedLineCircleIcon} size={height < 36 ? 10 : 14} style={{ color: isDone ? "#71717a" : calColor || "#059669" }} className="shrink-0" />
          ) : (
            <span
              className={`shrink-0 rounded-full ${height < 36 ? "size-[10px]" : "size-[14px]"}`}
              style={{ border: `2px solid ${isDone ? "#71717a" : color}`, backgroundColor: isDone ? "#71717a" : "transparent" }}
            />
          )}
          <p className={`min-w-0 truncate font-semibold ${isDone ? "text-[#71717a] line-through" : "text-white"} ${height < 36 ? "text-[11px]" : "text-[13px]"}`}>{task.title}</p>
        </div>
        {height >= 44 && (
          <p className={`truncate font-medium ${isDone ? "text-[#606068]" : "text-[#a1a1aa]"} ${height < 36 ? "text-[9px]" : "text-[11px]"}`} style={{ paddingLeft: height < 36 ? 0 : 20 }}>
            {fmtH}:{String(m).padStart(2, "0")} {ampm} – {endFmtH}:{String(endMin).padStart(2, "0")} {endAmpm}
          </p>
        )}
        {height < 44 && height >= 36 && (
          <p className={`truncate pl-5 text-[10px] font-medium ${isDone ? "text-[#606068]" : "text-[#71717a]"}`}>
            {fmtH}:{String(m).padStart(2, "0")} {ampm}
          </p>
        )}
      </div>

      {/* Bottom resize handle — hidden for done tasks */}
      {!isDone && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 left-0 right-0 z-30 flex h-2.5 cursor-ns-resize items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
        >
          <div className="h-[2px] w-8 rounded-full bg-[#a1a1aa]/60" />
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
    <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top }}>
      <div className="flex items-center">
        <div className="size-2 rounded-full bg-[#7c3aed]" />
        <div className="h-[2px] flex-1 bg-[#7c3aed]" />
      </div>
    </div>
  );
}

function calcDuration(tasks: Doc<"tasks">[]): string {
  let totalMin = 0;
  for (const t of tasks) {
    if (t.scheduledStartTime && t.scheduledEndTime) {
      const [sh, sm] = t.scheduledStartTime.split(":").map(Number);
      const [eh, em] = t.scheduledEndTime.split(":").map(Number);
      totalMin += eh * 60 + em - (sh * 60 + sm);
    }
  }
  if (totalMin <= 0) return "";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  return h > 0 ? `${h}h` : `${m}m`;
}
