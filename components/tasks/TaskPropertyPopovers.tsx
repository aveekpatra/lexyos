"use client";

import { useState, useMemo, useCallback, memo, useRef, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { menuRow, menuInput, menuSectionLabel } from "@/lib/ui/chrome";
import {
  format, addDays, startOfWeek, endOfWeek, addWeeks, endOfMonth, getWeek,
} from "date-fns";
import {
  IoCalendar,
  IoTrash,
} from "react-icons/io5";
import { Folder } from "@/components/ui/folder";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";

/**
 * Runs `reset` when `open` transitions from true to false, using React's
 * canonical "adjust state during render" pattern (prev-tracking) instead of a
 * synchronous setState inside an effect, which react-hooks/set-state-in-effect
 * flags as a cascading-render risk.
 */
function useResetOnClose(open: boolean, reset: () => void) {
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) reset();
  }
}

/* ────────────────────────────────────────────────────────
 * Shared styles
 * ──────────────────────────────────────────────────────── */

const popoverClass = "w-[268px]";
const inputClass = `${menuInput} mb-1`;
const itemClass = `${menuRow} w-full cursor-pointer justify-between hover:text-text-strong`;
const removeClass = `${menuRow} w-full cursor-pointer !text-[#ef4444] [&_svg]:!text-[#ef4444]`;
const sectionClass = menuSectionLabel;

/* ────────────────────────────────────────────────────────
 * DatePickerPopover
 * ──────────────────────────────────────────────────────── */

interface DatePickerPopoverProps {
  value: string | undefined; // "YYYY-MM-DD"
  onChange: (date: string | undefined) => void;
  children: React.ReactNode;
}

export const DatePickerPopover = memo(function DatePickerPopover({
  value,
  onChange,
  children,
}: DatePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useResetOnClose(open, () => setSearch(""));
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const nextWeekStart = addWeeks(weekStart, 1);
  const nextWeekEnd = addWeeks(weekEnd, 1);

  // No useMemo — values depend on `now` (current date) and are cheap to compute.
  // A stale memo (empty deps) would show wrong dates after midnight.
  const presets = [
    {
      label: "Today",
      detail: format(now, "EEE"),
      value: format(now, "yyyy-MM-dd"),
    },
    {
      label: "Tomorrow",
      detail: format(addDays(now, 1), "MMM d"),
      value: format(addDays(now, 1), "yyyy-MM-dd"),
    },
    {
      label: "This week",
      detail: `W${getWeek(now, { weekStartsOn: 1 })}, ${format(weekStart, "d")}-${format(weekEnd, "d MMM")}`,
      value: format(weekEnd, "yyyy-MM-dd"),
      icon: IoCalendar,
    },
    {
      label: "Next week",
      detail: `W${getWeek(nextWeekStart, { weekStartsOn: 1 })}, ${format(nextWeekStart, "d")}-${format(nextWeekEnd, "d MMM")}`,
      value: format(nextWeekStart, "yyyy-MM-dd"),
      icon: IoCalendar,
    },
    {
      label: "This month",
      detail: format(now, "MMM"),
      value: format(endOfMonth(now), "yyyy-MM-dd"),
      icon: IoCalendar,
    },
  ];

  const filtered = search.trim()
    ? presets.filter((p) => p.label.toLowerCase().includes(search.toLowerCase()))
    : presets;

  const select = useCallback((date: string | undefined) => {
    onChange(date);
    setOpen(false);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      <PopoverPopup className={popoverClass} sideOffset={6}>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type date and time or Time Slot"
          className={inputClass}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && filtered.length > 0) {
              select(filtered[0].value);
            }
          }}
        />
        <div className="space-y-0.5">
          {filtered.map((preset) => (
            <button
              data-row
              key={preset.label}
              onClick={() => select(preset.value)}
              className={itemClass}
            >
              <span className="flex items-center gap-2.5">
                {preset.icon && (
                  <preset.icon size={14} className="text-text-muted" />
                )}
                {preset.label}
              </span>
              <span className="text-xs text-text-muted">{preset.detail}</span>
            </button>
          ))}
        </div>
        {value && (
          <div className="mt-1.5">
            <button data-row onClick={() => select(undefined)} className={removeClass}>
              <IoTrash size={14} />
              Remove
            </button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
});

/* ────────────────────────────────────────────────────────
 * DurationPickerPopover
 * ──────────────────────────────────────────────────────── */

interface DurationPickerPopoverProps {
  /** Duration in minutes */
  value: number | undefined;
  onChange: (minutes: number | undefined) => void;
  children: React.ReactNode;
}

const DURATION_PRESETS = [
  { label: "0 minutes", minutes: 0 },
  { label: "10 minutes", minutes: 10 },
  { label: "15 minutes", minutes: 15 },
  { label: "20 minutes", minutes: 20 },
  { label: "30 minutes", minutes: 30 },
  { label: "45 minutes", minutes: 45 },
  { label: "1 hour", minutes: 60 },
  { label: "1h 30m", minutes: 90 },
  { label: "2 hours", minutes: 120 },
  { label: "3 hours", minutes: 180 },
  { label: "4 hours", minutes: 240 },
];

export const DurationPickerPopover = memo(function DurationPickerPopover({
  value,
  onChange,
  children,
}: DurationPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useResetOnClose(open, () => setSearch(""));
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = search.trim()
    ? DURATION_PRESETS.filter((p) => p.label.toLowerCase().includes(search.toLowerCase()))
    : DURATION_PRESETS;

  const select = useCallback((minutes: number | undefined) => {
    onChange(minutes);
    setOpen(false);
  }, [onChange]);

  // Parse custom input like "45m", "1h", "1h30m", "90"
  const parseCustom = useCallback((text: string): number | null => {
    const t = text.trim().toLowerCase();
    const hm = t.match(/^(\d+)\s*h\s*(\d+)?\s*m?$/);
    if (hm) return parseInt(hm[1]) * 60 + (parseInt(hm[2] || "0"));
    const mOnly = t.match(/^(\d+)\s*m(in(utes?)?)?$/);
    if (mOnly) return parseInt(mOnly[1]);
    const hOnly = t.match(/^(\d+)\s*h(ours?)?$/);
    if (hOnly) return parseInt(hOnly[1]) * 60;
    const num = parseInt(t);
    if (!isNaN(num) && num >= 0 && num <= 480) return num;
    return null;
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      <PopoverPopup className={popoverClass} sideOffset={6}>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type: 30 minutes, 1h"
          className={inputClass}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              const custom = parseCustom(search);
              if (custom !== null) {
                select(custom);
              } else if (filtered.length > 0) {
                select(filtered[0].minutes);
              }
            }
          }}
        />
        <div className="space-y-0.5">
          {filtered.map((preset) => (
            <button
              data-row
              key={preset.minutes}
              onClick={() => select(preset.minutes)}
              className={`${itemClass} ${value === preset.minutes ? "!text-brand-strong" : ""}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {value !== undefined && value > 0 && (
          <div className="mt-1.5">
            <button data-row onClick={() => select(undefined)} className={removeClass}>
              <IoTrash size={14} />
              Remove
            </button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
});

/* ────────────────────────────────────────────────────────
 * ProjectPickerPopover
 * ──────────────────────────────────────────────────────── */

interface ProjectPickerPopoverProps {
  value: Id<"projects"> | undefined;
  onChange: (projectId: Id<"projects"> | undefined) => void;
  children: React.ReactNode;
}

export const ProjectPickerPopover = memo(function ProjectPickerPopover({
  value,
  onChange,
  children,
}: ProjectPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const projects = useQuery(api.projects.list, { status: "active" });
  const inputRef = useRef<HTMLInputElement>(null);

  useResetOnClose(open, () => setSearch(""));
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    if (!search.trim()) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [projects, search]);

  const select = useCallback((id: Id<"projects"> | undefined) => {
    onChange(id);
    setOpen(false);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      <PopoverPopup className={popoverClass} sideOffset={6}>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type project name"
          className={inputClass}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && filtered.length > 0) {
              select(filtered[0]._id);
            }
          }}
        />

        {filtered.length > 0 && (
          <>
            <div className={sectionClass}>Projects</div>
            <div className="space-y-0.5">
              {filtered.map((project) => (
                <button
                  data-row
                  key={project._id}
                  onClick={() => select(project._id)}
                  className={`${itemClass} ${value === project._id ? "!text-brand-strong" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <Folder className="size-4" style={{ color: project.color || "#6366f1" }} />
                    {project.name}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {filtered.length === 0 && (
          <div className="px-3.5 py-4 text-center text-sm text-text-faint">
            No projects found
          </div>
        )}

        {value && (
          <div className="mt-1.5">
            <button data-row onClick={() => select(undefined)} className={removeClass}>
              <IoTrash size={14} />
              Remove project
            </button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
});

/* ────────────────────────────────────────────────────────
 * PriorityPickerPopover
 * ──────────────────────────────────────────────────────── */

export type TaskPriority = "p1" | "p2" | "p3" | "p4";

const PRIORITY_ORDER: TaskPriority[] = ["p1", "p2", "p3", "p4"];

interface PriorityPickerPopoverProps {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  children: React.ReactNode;
}

export const PriorityPickerPopover = memo(function PriorityPickerPopover({
  value,
  onChange,
  children,
}: PriorityPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  const select = useCallback((p: TaskPriority) => {
    onChange(p);
    setOpen(false);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      {/* Four fixed rows, so no search box: it would only get in the way. */}
      <PopoverPopup className="w-[196px]" sideOffset={6}>
        <div className={sectionClass}>Priority</div>
        <div className="space-y-0.5">
          {PRIORITY_ORDER.map((p) => (
            <button
              data-row
              key={p}
              onClick={() => select(p)}
              className={`${itemClass} ${value === p ? "!text-brand-strong" : ""}`}
            >
              <span className="flex items-center gap-2.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                {PRIORITY_LABELS[p]}
              </span>
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
});

/* ────────────────────────────────────────────────────────
 * TimePickerPopover
 * ──────────────────────────────────────────────────────── */

interface TimePickerPopoverProps {
  value: string | undefined; // "HH:MM"
  onChange: (time: string | undefined) => void;
  children: React.ReactNode;
}

const TIME_PRESETS = (() => {
  const times: { label: string; value: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = h.toString().padStart(2, "0");
      const mm = m.toString().padStart(2, "0");
      const period = h < 12 ? "am" : "pm";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      times.push({
        label: `${h12}:${mm} ${period}`,
        value: `${hh}:${mm}`,
      });
    }
  }
  return times;
})();

export const TimePickerPopover = memo(function TimePickerPopover({
  value,
  onChange,
  children,
}: TimePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useResetOnClose(open, () => setSearch(""));
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    // Scroll to current value, or to current hour if no value set
    setTimeout(() => {
      if (!listRef.current) return;
      if (value) {
        const idx = TIME_PRESETS.findIndex((t) => t.value === value);
        if (idx >= 0) {
          listRef.current.scrollTop = Math.max(0, idx * 36 - 72);
        }
      } else {
        // Scroll to current hour
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, "0");
        const idx = TIME_PRESETS.findIndex((t) => t.value === `${hh}:00`);
        if (idx >= 0) {
          listRef.current.scrollTop = Math.max(0, idx * 36 - 72);
        }
      }
    }, 80);
  }, [open, value]);

  const filtered = search.trim()
    ? TIME_PRESETS.filter((t) => t.label.includes(search.toLowerCase()) || t.value.includes(search))
    : TIME_PRESETS;

  const select = useCallback((time: string | undefined) => {
    onChange(time);
    setOpen(false);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      <PopoverPopup className={popoverClass} sideOffset={6}>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type time: 9am, 14:30"
          className={inputClass}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && filtered.length > 0) {
              select(filtered[0].value);
            }
          }}
        />
        <div ref={listRef} className="space-y-0.5">
          {filtered.map((t) => (
            <button
              data-row
              key={t.value}
              onClick={() => select(t.value)}
              className={`${itemClass} ${value === t.value ? "!text-brand-strong" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {value && (
          <div className="mt-1.5">
            <button data-row onClick={() => select(undefined)} className={removeClass}>
              <IoTrash size={14} />
              Remove
            </button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
});

/* ────────────────────────────────────────────────────────
 * TaskChip — the clickable chip/badge used in task cards
 * ──────────────────────────────────────────────────────── */

interface TaskChipProps {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  onClick?: () => void;
}

export const TaskChip = memo(function TaskChip({ children, active, className = "", onClick }: TaskChipProps) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-100 ${
        active
          ? "bg-brand-bg text-brand hover:bg-brand-border/50"
          : "bg-black/[0.04] text-text-muted hover:bg-black/[0.07] hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
      } ${className}`}
    >
      {children}
    </span>
  );
});

/* ────────────────────────────────────────────────────────
 * Helper: format duration from minutes
 * ──────────────────────────────────────────────────────── */

export function formatDuration(minutes: number): string {
  if (minutes === 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/* ────────────────────────────────────────────────────────
 * Helper: compute duration from start/end times
 * ──────────────────────────────────────────────────────── */

export function computeDuration(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  // Handle midnight-crossing tasks (e.g., 23:00 to 01:00 = -1320 → +120)
  if (mins < 0) mins += 1440;
  return mins > 0 ? mins : undefined;
}

/* ────────────────────────────────────────────────────────
 * Helper: format time "HH:MM" to "h:mm am/pm"
 * ──────────────────────────────────────────────────────── */

export function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}
