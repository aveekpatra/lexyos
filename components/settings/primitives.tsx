"use client";

import { useEffect, useState } from "react";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/kbd";
import { softPill } from "@/lib/ui/chrome";
import { comboFromEvent, shortcutKeys, type Shortcut } from "@/lib/settings";
import { IoCheckmarkCircle, IoChevronDown } from "react-icons/io5";

/* Settings vocabulary: one card per group, one 48px row per setting, and a
   small set of controls (toggle, select, number, shortcut recorder) that all
   share the soft capsule geometry. */

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 px-3.5">
        <h3 className="text-[13px] font-semibold text-text-strong">{title}</h3>
        {description && <p className="text-[12px] text-text-muted">{description}</p>}
      </div>
      <div className="overflow-hidden rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] [&>*+*]:border-t [&>*+*]:border-black/[0.05] dark:[&>*+*]:border-white/[0.06]">
        {children}
      </div>
    </section>
  );
}

export function Row({ label, hint, icon, children, stacked }: {
  label: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; children?: React.ReactNode; stacked?: boolean;
}) {
  return (
    <div className={`flex ${stacked ? "flex-col items-stretch gap-2" : "min-h-12 items-center gap-3"} px-3.5 py-2.5`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-text-muted dark:bg-white/[0.08]">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-text-strong">{label}</span>
          {hint && <span className="block text-[11.5px] leading-snug text-text-muted">{hint}</span>}
        </span>
      </div>
      {children && <div className={`flex shrink-0 items-center ${stacked ? "" : ""}`}>{children}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${on ? "bg-brand" : "bg-black/[0.1] dark:bg-white/[0.14]"}`}
    >
      <span className={`size-6 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

export function Select<T extends string | number>({ value, options, onChange, width = "w-[150px]" }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; width?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu>
      <MenuTrigger render={<button className={`${softPill} ${width} justify-between !bg-surface-0 shadow-3d-sm dark:!bg-white/[0.06]`} />}>
        <span className="truncate">{current?.label ?? String(value)}</span>
        <IoChevronDown className="size-3.5 shrink-0 text-text-faint" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-[200px]">
        {options.map((o) => (
          <MenuItem key={String(o.value)} onClick={() => onChange(o.value)}>
            {o.label}
            {o.value === value && <IoCheckmarkCircle className="ml-auto size-3.5" />}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

export function NumberField({ value, onChange, min = 0, max = 999, step = 1, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-0 pl-3 pr-2 text-xs shadow-3d-sm dark:bg-white/[0.06]">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => { const n = e.target.valueAsNumber; if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n))); }}
        className="w-10 bg-transparent text-right font-medium text-text-strong outline-none"
      />
      {suffix && <span className="text-text-muted">{suffix}</span>}
    </label>
  );
}

export function TextField({ value, onChange, placeholder, onCommit }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onCommit?: () => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit?.(); (e.target as HTMLInputElement).blur(); } }}
      placeholder={placeholder}
      className="h-9 w-full rounded-full border border-transparent bg-black/[0.04] px-3.5 text-[13px] text-text-strong outline-none placeholder:text-text-faint focus:border-brand-border dark:bg-white/[0.06]"
    />
  );
}

export function TextArea({ value, onChange, placeholder, onCommit, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onCommit?: () => void; rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      placeholder={placeholder}
      className="w-full resize-none rounded-[14px] border border-transparent bg-black/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-text-strong outline-none placeholder:text-text-faint focus:border-brand-border dark:bg-white/[0.06]"
    />
  );
}

export function Keys({ combo }: { combo: Shortcut }) {
  return <span className="inline-flex items-center gap-0.5">{shortcutKeys(combo).map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>;
}

/** Click to record the next key press. Escape cancels. */
export function ShortcutRecorder({ value, fallback, onChange }: { value: Shortcut; fallback: Shortcut; onChange: (v: Shortcut) => void }) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); return; }
      const combo = comboFromEvent(e);
      if (!combo) return;
      onChange(combo);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={() => setRecording(true)}
        className={`inline-flex h-7 min-w-[72px] items-center justify-center gap-0.5 rounded-full px-2.5 text-xs shadow-3d-sm transition-colors ${recording ? "bg-brand/10 text-brand" : "bg-surface-0 dark:bg-white/[0.06]"}`}
      >
        {recording ? "Press keys" : <Keys combo={value} />}
      </button>
      {value !== fallback && (
        <button onClick={() => onChange(fallback)} className="text-[11px] text-text-faint hover:text-text-strong">Reset</button>
      )}
    </span>
  );
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: "brand" | "muted" | "green" }) {
  const cls = tone === "brand" ? "bg-brand/10 text-brand" : tone === "green" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-black/[0.05] text-text-muted dark:bg-white/[0.08]";
  return <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold ${cls}`}>{children}</span>;
}
