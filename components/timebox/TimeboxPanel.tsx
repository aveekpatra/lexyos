"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { format, parseISO, addDays, isToday } from "date-fns";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";
import { SidebarGlyph } from "@/components/ui/sidebar-glyph";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useTimeboxDate, useTimeboxOpen } from "@/lib/timebox-store";
import { syncTaskUpdateToGoogle, syncCompletionResultToGoogle } from "@/lib/google-sync";
import { isGoogleCalEvent } from "@/lib/task-utils";
import { PRIORITY_COLORS } from "@/lib/constants";
import { useSettings, formatClock } from "@/lib/settings";
import {
  MIN_EVENT_MINUTES, END_OF_DAY_MIN,
  durationMinutes, minutesToTime, resolveTaskBlock, localDateStr,
} from "@/lib/time-utils";

/*
 * Timebox: one day as a time grid beside the board. Drop a card from any
 * column onto an hour to give it that time. Drag a block to move it, pull its
 * bottom edge to change the duration. Untimed tasks for the day sit in the
 * all-day strip and can be dragged down into the grid.
 */

const HOUR_PX = 56;
const DAY_PX = HOUR_PX * 24;

const yToMinutes = (y: number, snap: number) => Math.max(0, Math.min(END_OF_DAY_MIN, Math.round((y / HOUR_PX) * 60 / snap) * snap));
const minutesToY = (m: number) => (m / 60) * HOUR_PX;

export function TimeboxPanel() {
  const [open, setOpen] = useTimeboxOpen();
  const [dateStr, setDateStr] = useTimeboxDate();
  const dateParam = useSearchParams().get("date");
  useEffect(() => { if (dateParam) setDateStr(dateParam); }, [dateParam, setDateStr]);
  const date = dateStr || localDateStr(new Date());
  const day = parseISO(date);
  const tasks = useQuery(api.tasks.list, {});
  const projects = useQuery(api.projects.list, {});
  const updateTask = useMutation(api.tasks.update);
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropPreview, setDropPreview] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: Id<"tasks">; mode: "move" | "resize"; start: number; end: number } | null>(null);
  const { settings } = useSettings();
  const SNAP = settings.calendar.snapMinutes;
  const clock = settings.calendar.timeFormat;
  const fmt = (m: number) => formatClock(minutesToTime(m), clock);
  const { width, resizing, onPointerDown: onResize } = useResizableWidth("timebox", { initial: 300, min: 260, max: 520, side: "left" });

  const projectColor = useCallback((t: Doc<"tasks">) => {
    if (isGoogleCalEvent(t) && t.calendarColor) return t.calendarColor;
    return projects?.find((p) => p._id === t.projectId)?.color ?? PRIORITY_COLORS[t.priority] ?? "#2563eb";
  }, [projects]);

  const dayTasks = useMemo(() => (tasks ?? []).filter((t) => (t.dueDate || t.scheduledDate) === date && !t.parentTaskId), [tasks, date]);
  const timed = useMemo(() => dayTasks.filter((t) => resolveTaskBlock(t) !== null), [dayTasks]);
  const allDay = useMemo(() => dayTasks.filter((t) => resolveTaskBlock(t) === null && t.status !== "done"), [dayTasks]);

  // Lay overlapping blocks side by side.
  const laid = useMemo(() => {
    const blocks = timed.map((t) => {
      const b = resolveTaskBlock(t)!;
      const live = drag && drag.id === t._id ? { startMin: drag.start, endMin: drag.end } : b;
      return { t, start: live.startMin, end: live.endMin, lane: 0, lanes: 1 };
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster: typeof blocks = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanesEnd: number[] = [];
      for (const b of cluster) {
        let lane = lanesEnd.findIndex((e) => e <= b.start);
        if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(0); }
        lanesEnd[lane] = b.end; b.lane = lane;
      }
      for (const b of cluster) b.lanes = lanesEnd.length;
      cluster = [];
    };
    for (const b of blocks) {
      if (cluster.length && b.start >= clusterEnd) flush();
      cluster.push(b); clusterEnd = Math.max(clusterEnd, b.end);
    }
    if (cluster.length) flush();
    return blocks;
  }, [timed, drag]);

  // Scroll to a sensible hour once.
  const landed = useRef(false);
  useEffect(() => {
    if (!open || landed.current || !scrollRef.current) return;
    landed.current = true;
    const now = new Date();
    const target = isToday(day) ? Math.max(0, now.getHours() - 2) : settings.calendar.dayStartHour;
    scrollRef.current.scrollTop = target * HOUR_PX;
  }, [open, day, settings.calendar.dayStartHour]);

  // Now line ticks each minute.
  const [nowMin, setNowMin] = useState(() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); });
  useEffect(() => {
    const id = setInterval(() => { const n = new Date(); setNowMin(n.getHours() * 60 + n.getMinutes()); }, 60_000);
    return () => clearInterval(id);
  }, []);

  const write = useCallback(async (t: Doc<"tasks">, startMin: number, endMin: number, dueDate = date) => {
    const start = minutesToTime(startMin);
    const end = minutesToTime(Math.min(END_OF_DAY_MIN, Math.max(startMin + MIN_EVENT_MINUTES, endMin)));
    const changes = { id: t._id, dueDate, dueTime: start, scheduledStartTime: start, scheduledEndTime: end };
    await updateTask(changes);
    try {
      const r = await syncTaskUpdateToGoogle(t, changes as Record<string, unknown>);
      if (r) await updateTask({ id: t._id, googleEventId: r.googleEventId, googleCalendarId: r.googleCalendarId });
    } catch (err) { console.warn("Google sync failed:", err); }
  }, [updateTask, date]);

  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const complete = useCallback(async (t: Doc<"tasks">) => {
    const wasDone = t.status === "done";
    const result = await toggleComplete({ id: t._id, userDate: localDateStr(new Date()) });
    try { await syncCompletionResultToGoogle(t, result, wasDone); } catch (err) { console.warn("Google sync failed:", err); }
  }, [toggleComplete]);

  const clearTime = useCallback(async (t: Doc<"tasks">) => {
    const changes = { id: t._id, clearDueTime: true, clearScheduledStartTime: true, clearScheduledEndTime: true };
    await updateTask(changes);
    try { await syncTaskUpdateToGoogle(t, changes as Record<string, unknown>); } catch (err) { console.warn("Google sync failed:", err); }
  }, [updateTask]);

  // Drop from the board (HTML5 DnD carries the task id).
  const minutesFromEvent = (e: React.DragEvent | PointerEvent | React.PointerEvent) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return yToMinutes(e.clientY - rect.top, SNAP);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropPreview(minutesFromEvent(e)); };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDropPreview(null);
    const id = e.dataTransfer.getData("text/plain") as Id<"tasks">;
    const t = tasks?.find((x) => x._id === id);
    if (!t) return;
    const start = minutesFromEvent(e);
    const dur = durationMinutes(t.scheduledStartTime, t.scheduledEndTime) ?? settings.general.defaultDurationMin;
    await write(t, start, start + dur);
  };

  // Pointer drag on blocks: move or resize with 15 minute snapping.
  const beginDrag = (t: Doc<"tasks">, mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const b = resolveTaskBlock(t)!;
    const origin = e.clientY;
    const dur = b.endMin - b.startMin;
    let moved = false;
    let cur = { start: b.startMin, end: b.endMin };
    setDrag({ id: t._id, mode, start: b.startMin, end: b.endMin });
    const onMove = (ev: PointerEvent) => {
      const delta = Math.round(((ev.clientY - origin) / HOUR_PX) * 60 / SNAP) * SNAP;
      if (delta !== 0) moved = true;
      if (mode === "move") {
        const start = Math.max(0, Math.min(END_OF_DAY_MIN - dur, b.startMin + delta));
        cur = { start, end: start + dur };
      } else {
        cur = { start: b.startMin, end: Math.max(b.startMin + MIN_EVENT_MINUTES, Math.min(END_OF_DAY_MIN + 1, b.endMin + delta)) };
      }
      setDrag({ id: t._id, mode, ...cur });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (moved) void write(t, cur.start, cur.end);
      else if (mode === "move") router.push(`/task/${t._id}`);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!open) return null;

  return (
    /* A flat right rail, the mirror of the app sidebar: same grey, full height,
       no rounding, no float. */
    <aside className="relative ml-1 flex shrink-0 flex-col bg-surface-2" style={{ width }}>
      <ResizeHandle side="left" onPointerDown={onResize} active={resizing} />
      {/* Header: column header geometry, controls are soft white capsules on the grey */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="text-[14px] font-semibold tracking-tight text-text-strong">{isToday(day) ? "Today" : format(day, "EEEE")}</span>
          <span className="truncate text-[12px] font-medium text-text-muted">{format(day, "EEE, MMM d")}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setDateStr(localDateStr(addDays(day, -1)))} aria-label="Previous day" className={softCircle}>
            <IoChevronBack className="size-3.5" />
          </button>
          {!isToday(day) && (
            <button onClick={() => setDateStr(localDateStr(new Date()))} className={softCapsule}>Today</button>
          )}
          <button onClick={() => setDateStr(localDateStr(addDays(day, 1)))} aria-label="Next day" className={softCircle}>
            <IoChevronForward className="size-3.5" />
          </button>
          <button onClick={() => setOpen(false)} aria-label="Hide timebox" title="Hide timebox" className={`${softCircle} ml-1`}>
            <SidebarGlyph side="right" className="size-4" />
          </button>
        </div>
      </div>

      {/* All day: chips in the add-pill material */}
      <div
        className="mx-3 mb-2.5 flex min-h-9 items-center gap-2 rounded-full bg-surface-0 pl-3.5 pr-1.5 py-1 dark:bg-white/[0.05]"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={async (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain") as Id<"tasks">;
          const t = tasks?.find((x) => x._id === id);
          if (!t) return;
          if (resolveTaskBlock(t)) await clearTime(t);
          if ((t.dueDate || t.scheduledDate) !== date) await updateTask({ id: t._id, dueDate: date });
        }}
      >
        <span className="shrink-0 text-[12px] text-text-faint">All day</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
          {allDay.map((t) => (
            <button
              key={t._id}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("text/plain", t._id); e.dataTransfer.effectAllowed = "move"; }}
              onClick={() => router.push(`/task/${t._id}`)}
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-black/[0.05] px-2 text-[12px] font-medium text-text-strong transition-colors hover:bg-black/[0.08] dark:bg-white/[0.08]"
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: projectColor(t) }} />
              <span className="truncate">{t.title}</span>
            </button>
          ))}
        </div>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[10px] font-medium tabular-nums text-text-faint dark:bg-white/[0.08]">
          {allDay.length}
        </span>
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="relative flex" style={{ height: DAY_PX }}>
          <div className="relative w-9 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-text-faint" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : formatClock(`${String(h).padStart(2, "0")}:00`, clock)}
              </span>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex-1"
            onDragOver={onDragOver}
            onDragLeave={() => setDropPreview(null)}
            onDrop={onDrop}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute inset-x-0 border-t border-black/[0.06] dark:border-white/[0.06]" style={{ top: h * HOUR_PX, height: HOUR_PX }} />
            ))}

            {dropPreview !== null && (
              <div className="pointer-events-none absolute inset-x-0 rounded-xl border-2 border-dashed border-brand/60 bg-brand/5" style={{ top: minutesToY(dropPreview), height: minutesToY(settings.general.defaultDurationMin) }} />
            )}

            {laid.map(({ t, start, end, lane, lanes }) => {
              const done = t.status === "done";
              const google = isGoogleCalEvent(t);
              const dragging = drag?.id === t._id;
              const width = `calc((100% - ${(lanes - 1) * 4}px) / ${lanes})`;
              const left = `calc(((100% - ${(lanes - 1) * 4}px) / ${lanes} + 4px) * ${lane})`;
              // Sit between the hour lines: 2px in from each line.
              const h = Math.max(24, minutesToY(end - start) - 4);
              const compact = h < 40;
              return (
                <div
                  key={t._id}
                  onPointerDown={beginDrag(t, "move")}
                  className={`absolute select-none overflow-hidden rounded-[13px] px-3 text-left transition-[box-shadow,transform] ${
                    google
                      ? "border border-dashed border-line-strong bg-transparent"
                      : "bg-surface-0 shadow-3d-sm dark:bg-white/[0.06]"
                  } ${dragging ? "z-20 shadow-3d" : "z-10 hover:shadow-3d"} ${done ? "opacity-50" : ""} ${compact ? "flex items-center gap-2" : "py-2"} cursor-grab active:cursor-grabbing`}
                  style={{ top: minutesToY(start) + 2, height: h, width, left }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); void complete(t); }}
                      aria-label={done ? "Mark as not done" : "Mark as done"}
                      className="flex size-4 shrink-0 items-center justify-center rounded-full transition-colors"
                      style={{ border: `2px solid ${done ? "#93c5fd" : PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.p4}`, backgroundColor: done ? "#71717a" : "transparent" }}
                    >
                      {done && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </button>
                    <span className={`truncate text-[13px] leading-4 ${done ? "line-through text-text-faint" : "text-text-strong"}`}>{t.title}</span>
                  </div>
                  {!compact && (
                    <div className="pl-6 text-[11px] leading-4 text-text-muted">
                      {fmt(start)} to {fmt(Math.min(end, END_OF_DAY_MIN))}
                    </div>
                  )}
                  {!google && <div onPointerDown={beginDrag(t, "resize")} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" aria-label="Resize" />}
                </div>
              );
            })}

            {isToday(day) && (
              <div className="pointer-events-none absolute inset-x-0 z-30 flex items-center" style={{ top: minutesToY(nowMin) }}>
                <span className="-ml-[3px] size-[7px] rounded-full bg-[#ef4444]" />
                <span className="h-px flex-1 bg-[#ef4444]" />
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

const softCircle =
  "inline-flex size-7 items-center justify-center rounded-full bg-surface-0 text-text-secondary shadow-3d-sm transition-colors hover:text-text-strong active:translate-y-px dark:bg-white/[0.06]";
const softCapsule =
  "inline-flex h-7 items-center rounded-full bg-surface-0 px-3 text-xs font-medium text-text-secondary shadow-3d-sm transition-colors hover:text-text-strong active:translate-y-px dark:bg-white/[0.06]";
