"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { menuRow, menuSectionLabel, bluePill } from "@/lib/ui/chrome";
import {
  RECURRENCE_PRESETS,
  WEEKDAYS,
  matchPreset,
  describeRecurrence,
  weekdayOf,
  type Recurrence,
  type RecurrenceSlot,
  type Weekday,
  type WeeklyRecurrence,
} from "@/convex/lib/recurrence";
import {
  IoArrowBack,
  IoTrash,
} from "react-icons/io5";

/* Shared menu material: see lib/ui/chrome.ts. */
const popoverClass = "w-[296px]";
const itemClass = `${menuRow} w-full cursor-pointer justify-between hover:text-text-strong`;
const removeClass = `${menuRow} w-full cursor-pointer !text-[#ef4444] [&_svg]:!text-[#ef4444]`;
const sectionClass = menuSectionLabel;
const fieldClass = "h-8 rounded-full bg-black/[0.04] px-3 text-[13px] text-text-strong outline-none dark:bg-white/[0.06]";
const dayChip = "flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-medium transition-colors";

const DAY_SHORT: Record<Weekday, string> = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const DAY_LONG: Record<Weekday, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type Freq = Recurrence["freq"];

interface Props {
  value: Recurrence | undefined;
  /** The task's date; used to seed weekly/monthly defaults. */
  anchorDate: string;
  onChange: (rec: Recurrence | undefined) => void;
  children: React.ReactNode;
}

function defaultFor(freq: Freq, anchor: string, prev?: Recurrence): Recurrence {
  const interval = prev?.interval;
  switch (freq) {
    case "daily": return { freq, interval };
    case "weekly": return { freq, interval, slots: [{ day: weekdayOf(anchor) }] };
    case "monthly": return { freq, interval };
    case "yearly": return { freq, interval };
  }
}

export const RecurrencePopover = memo(function RecurrencePopover({ value, anchorDate, onChange, children }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<Recurrence | undefined>(undefined);

  // Reset panel state whenever the popover closes (render-phase adjust pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) { setCustom(false); setDraft(undefined); }
  }

  const activePreset = useMemo(() => (value ? matchPreset(value, anchorDate) : undefined), [value, anchorDate]);
  const isCustomValue = !!value && !activePreset;

  const commit = useCallback((rec: Recurrence | undefined) => {
    onChange(rec);
    setOpen(false);
  }, [onChange]);

  const openCustom = () => {
    setDraft(value ?? defaultFor("weekly", anchorDate));
    setCustom(true);
  };

  const rec = draft;

  const setFreq = (freq: Freq) => setDraft((d) => defaultFor(freq, anchorDate, d));
  const setInterval_ = (n: number) => setDraft((d) => (d ? { ...d, interval: Number.isFinite(n) && n > 1 ? Math.min(52, Math.floor(n)) : undefined } : d));
  const setUntil = (until: string) => setDraft((d) => (d ? { ...d, until: until || undefined } : d));

  const toggleDay = (day: Weekday) => setDraft((d) => {
    if (!d || d.freq !== "weekly") return d;
    const has = d.slots.some((s) => s.day === day);
    const slots = has ? d.slots.filter((s) => s.day !== day) : [...d.slots, { day }];
    return { ...d, slots: slots.length ? slots : d.slots };
  });
  const setSlot = (day: Weekday, patch: Partial<RecurrenceSlot>) => setDraft((d) => {
    if (!d || d.freq !== "weekly") return d;
    return { ...d, slots: d.slots.map((s) => (s.day === day ? { ...s, ...patch } : s)) };
  });

  const canSave = !!rec && (rec.freq !== "weekly" || rec.slots.length > 0) &&
    (rec.freq !== "weekly" || rec.slots.every((s) => !s.end || !!s.start));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} draggable={false} className="inline-flex cursor-pointer" />}>
        {children}
      </PopoverTrigger>
      <PopoverPopup className={popoverClass} sideOffset={6}>
        {!custom ? (
          <>
            <div className="space-y-0.5">
              {RECURRENCE_PRESETS.map((p) => {
                const active = activePreset === p.id;
                return (
                  <button
                    data-row
                    key={p.id}
                    onClick={() => commit(p.build(anchorDate))}
                    className={`${itemClass} ${active ? "!text-brand-strong" : ""}`}
                  >
                    {p.id === "weekly" ? `Weekly on ${DAY_LONG[weekdayOf(anchorDate)]}` : p.label}
                    {active && <Tick />}
                  </button>
                );
              })}
              <button data-row onClick={openCustom} className={`${itemClass} ${isCustomValue ? "!text-brand-strong" : ""}`}>
                <span className="flex min-w-0 flex-col items-start">
                  <span>Custom</span>
                  {isCustomValue && value && (
                    <span className="truncate text-[11px] text-text-muted">{describeRecurrence(value, anchorDate)}</span>
                  )}
                </span>
                {isCustomValue && <Tick />}
              </button>
            </div>
            {value && (
              <div className="mt-1.5">
                <button data-row onClick={() => commit(undefined)} className={removeClass}>
                  <IoTrash size={14} />
                  Stop repeating
                </button>
              </div>
            )}
          </>
        ) : rec ? (
          <div className="flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 px-1.5 py-1">
              <button onClick={() => setCustom(false)} className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.07]">
                <IoArrowBack size={14} />
              </button>
              <span className="text-[13px] font-medium text-text-strong">Custom repeat</span>
            </div>

            {/* Frequency + interval */}
            <div className={sectionClass}>Every</div>
            <div className="flex items-center gap-2 px-3.5">
              <input
                type="number"
                min={1}
                max={52}
                value={rec.interval ?? 1}
                onChange={(e) => setInterval_(e.target.valueAsNumber)}
                className={`${fieldClass} w-14`}
              />
              <div className="flex flex-1 rounded-full bg-black/[0.04] p-0.5 dark:bg-white/[0.06]">
                {(["daily", "weekly", "monthly", "yearly"] as Freq[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFreq(f)}
                    className={`flex-1 rounded-full py-1 text-[12px] transition-colors ${
                      rec.freq === f ? "bg-white font-medium text-text-strong shadow-[0_1px_3px_rgba(15,23,42,0.14)] dark:bg-white/20" : "text-text-muted hover:text-text-strong"
                    }`}
                  >
                    {{ daily: "day", weekly: "week", monthly: "month", yearly: "year" }[f]}
                  </button>
                ))}
              </div>
            </div>

            {/* Weekly: day toggles + per-day times */}
            {rec.freq === "weekly" && (
              <>
                <div className={sectionClass}>On</div>
                <div className="flex justify-between px-3.5">
                  {WEEKDAYS.map((d) => {
                    const on = rec.slots.some((s) => s.day === d);
                    return (
                      <button
                        key={d}
                        onClick={() => toggleDay(d)}
                        aria-pressed={on}
                        title={DAY_LONG[d]}
                        className={`${dayChip} ${on ? "bg-brand text-white" : "bg-black/[0.04] text-text-muted hover:bg-black/[0.08] dark:bg-white/[0.06]"}`}
                      >
                        {DAY_SHORT[d]}
                      </button>
                    );
                  })}
                </div>
                <div className={sectionClass}>Time per day</div>
                <p className="px-3.5 pb-1 text-[11px] text-text-faint">Leave blank to keep the task&apos;s own time.</p>
                <div className="flex flex-col gap-1 px-3.5">
                  {WEEKDAYS.filter((d) => rec.slots.some((s) => s.day === d)).map((d) => {
                    const slot = rec.slots.find((s) => s.day === d)!;
                    return <SlotRow key={d} slot={slot} onChange={(p) => setSlot(d, p)} />;
                  })}
                </div>
              </>
            )}

            {/* Monthly: day of month */}
            {rec.freq === "monthly" && (
              <>
                <div className={sectionClass}>On day</div>
                <div className="flex items-center gap-2 px-3.5">
                  <select
                    value={rec.day === undefined ? "anchor" : String(rec.day)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((d) => d && d.freq === "monthly"
                        ? { ...d, day: val === "anchor" ? undefined : val === "last" ? "last" : Number(val) }
                        : d);
                    }}
                    className={`${fieldClass} flex-1`}
                  >
                    <option value="anchor">Same day as the task ({Number(anchorDate.slice(8, 10))})</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                    <option value="last">Last day of the month</option>
                  </select>
                </div>
              </>
            )}

            {/* Yearly uses the task's month and day; nothing extra to choose. */}
            {rec.freq === "yearly" && (
              <p className="px-3.5 pt-3 text-[12px] text-text-muted">Repeats on the task&apos;s date each year.</p>
            )}

            {/* Until */}
            <div className={sectionClass}>Ends</div>
            <div className="flex items-center gap-2 px-3.5">
              <input
                type="date"
                value={rec.until ?? ""}
                min={anchorDate}
                onChange={(e) => setUntil(e.target.value)}
                className={`${fieldClass} flex-1`}
              />
              {rec.until && (
                <button onClick={() => setUntil("")} className="text-[12px] text-text-muted hover:text-text-strong">Never</button>
              )}
            </div>

            {/* Summary + save */}
            <div className="mt-3 flex items-center justify-between gap-2 px-3.5 pb-1 pt-1">
              <span className="min-w-0 truncate text-[12px] text-text-muted">{describeRecurrence(rec, anchorDate)}</span>
              <button
                disabled={!canSave}
                onClick={() => canSave && commit(rec)}
                className={`${bluePill} shrink-0 disabled:opacity-40`}
              >
                Save
              </button>
            </div>
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});

function SlotRow({ slot, onChange }: { slot: RecurrenceSlot; onChange: (p: Partial<RecurrenceSlot>) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 text-[12px] text-text-secondary">{DAY_LONG[slot.day].slice(0, 3)}</span>
      <input
        type="time"
        value={slot.start ?? ""}
        onChange={(e) => onChange({ start: e.target.value || undefined, ...(e.target.value ? {} : { end: undefined }) })}
        className={`${fieldClass} flex-1`}
        aria-label={`${DAY_LONG[slot.day]} start time`}
      />
      <span className="text-[12px] text-text-faint">to</span>
      <input
        type="time"
        value={slot.end ?? ""}
        disabled={!slot.start}
        onChange={(e) => onChange({ end: e.target.value || undefined })}
        className={`${fieldClass} flex-1 disabled:opacity-40`}
        aria-label={`${DAY_LONG[slot.day]} end time`}
      />
    </div>
  );
}

function Tick() {
  return <span className="ml-auto text-[10px] text-text-muted">&#10003;</span>;
}

/** Re-export for consumers that only need a label. */
export type { Recurrence, WeeklyRecurrence };
