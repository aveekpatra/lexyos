"use client";

import { useState, useMemo, useCallback, memo, useRef, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar01Icon,
  Clock01Icon,
  FolderLibraryIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  format, addDays, startOfWeek, endOfWeek, addWeeks, endOfMonth, getWeek,
} from "date-fns";

/* ────────────────────────────────────────────────────────
 * Shared styles
 * ──────────────────────────────────────────────────────── */

const popoverClass = "w-[260px] rounded-xl border border-line-strong bg-surface-0 p-0 shadow-3d";
const inputClass = "w-full border-b border-line bg-transparent px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-text-faint";
const itemClass = "flex w-full cursor-pointer items-center justify-between rounded-lg px-3.5 py-2 text-sm text-text-strong transition-colors duration-100 hover:bg-line";
const removeClass = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm text-[#ef4444] transition-colors duration-100 hover:bg-line";
const sectionClass = "px-3.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-text-faint";

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

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setSearch("");
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
      icon: Calendar01Icon,
    },
    {
      label: "Next week",
      detail: `W${getWeek(nextWeekStart, { weekStartsOn: 1 })}, ${format(nextWeekStart, "d")}-${format(nextWeekEnd, "d MMM")}`,
      value: format(nextWeekStart, "yyyy-MM-dd"),
      icon: Calendar01Icon,
    },
    {
      label: "This month",
      detail: format(now, "MMM"),
      value: format(endOfMonth(now), "yyyy-MM-dd"),
      icon: Calendar01Icon,
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
      <PopoverTrigger render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
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
        <div className="p-1.5">
          {filtered.map((preset) => (
            <button
              key={preset.label}
              onClick={() => select(preset.value)}
              className={itemClass}
            >
              <span className="flex items-center gap-2.5">
                {preset.icon && (
                  <HugeiconsIcon icon={preset.icon} size={14} className="text-text-muted" />
                )}
                {preset.label}
              </span>
              <span className="text-xs text-text-muted">{preset.detail}</span>
            </button>
          ))}
        </div>
        {value && (
          <div className="border-t border-line p-1.5">
            <button onClick={() => select(undefined)} className={removeClass}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
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

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setSearch("");
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
      <PopoverTrigger render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
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
        <div className="max-h-[240px] overflow-y-auto p-1.5">
          {filtered.map((preset) => (
            <button
              key={preset.minutes}
              onClick={() => select(preset.minutes)}
              className={`${itemClass} ${value === preset.minutes ? "bg-brand-bg text-brand-strong" : ""}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {value !== undefined && value > 0 && (
          <div className="border-t border-line p-1.5">
            <button onClick={() => select(undefined)} className={removeClass}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
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

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setSearch("");
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
      <PopoverTrigger render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
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
            <div className="p-1.5 pt-0">
              {filtered.map((project) => (
                <button
                  key={project._id}
                  onClick={() => select(project._id)}
                  className={`${itemClass} ${value === project._id ? "bg-brand-bg text-brand-strong" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="flex size-5 items-center justify-center rounded-md text-[10px] font-bold text-foreground"
                      style={{ backgroundColor: project.color || "#6366f1" }}
                    >
                      {project.name[0]?.toUpperCase()}
                    </span>
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
          <div className="border-t border-line p-1.5">
            <button onClick={() => select(undefined)} className={removeClass}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              Remove project
            </button>
          </div>
        )}
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

  useEffect(() => {
    if (open) {
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
    } else {
      setSearch("");
    }
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
      <PopoverTrigger render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
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
        <div ref={listRef} className="max-h-[240px] overflow-y-auto p-1.5">
          {filtered.map((t) => (
            <button
              key={t.value}
              onClick={() => select(t.value)}
              className={`${itemClass} ${value === t.value ? "bg-brand-bg text-brand-strong" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {value && (
          <div className="border-t border-line p-1.5">
            <button onClick={() => select(undefined)} className={removeClass}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
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
      className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors duration-100 ${
        active
          ? "border-blue-200 bg-blue-50 text-blue-700 shadow-3d-sm hover:border-blue-300 hover:bg-blue-100 dark:border-brand-border dark:bg-brand-bg dark:text-brand"
          : "border-line bg-surface-1 text-text-muted shadow-3d-sm hover:border-line-strong hover:bg-surface-2 hover:text-text-strong"
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
