"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import type { FocusSession } from "@/lib/focus-store";
import { api } from "@/convex/_generated/api";

/**
 * All user settings in one typed object. Stored as a JSON blob in
 * userPreferences.prefs (shallow-merged), so adding a setting is one field
 * here plus one row in the settings sheet. Every feature is ON by default.
 */

export type Shortcut = string; // e.g. "mod+/", "shift+o", "?"

export interface Settings {
  general: {
    defaultView: "overview" | "days";
    newTaskPosition: "top" | "bottom";
    defaultDurationMin: number;
    defaultPriority: "p1" | "p2" | "p3" | "p4";
    completeParentWhenSubtasksDone: boolean;
    moveDoneToBottom: boolean;
    rolloverEnabled: boolean;
    rolloverRecurring: boolean;
    lastRollover?: string;
    allowAnalytics: boolean;
  };
  calendar: {
    weekStartsOn: 0 | 1 | 6;
    timeFormat: "12h" | "24h";
    dayStartHour: number;
    snapMinutes: 5 | 10 | 15 | 30;
    showDeclinedEvents: boolean;
    workdayThresholdEnabled: boolean;
    workdayThresholdHours: number;
  };
  email: {
    aiEnrich: boolean;
  };
  dueDates: {
    indicatorWithinDays: number;
    reminderNotifications: boolean;
  };
  pomodoro: {
    workMin: number;
    shortBreakMin: number;
    longBreakMin: number;
    roundsBeforeLongBreak: number;
    autoStartBreaks: boolean;
    autoStartNext: boolean;
    sound: boolean;
  };
  ai: {
    approval: "ask" | "auto";
    showReasoning: boolean;
    schedulingPreferences: string;
  };
  /** Per-account UI state, synced so every device opens the same way. */
  ui: {
    sidebarCollapsed: boolean;
    kanbanView: "overview" | "days";
    kanbanShowDone: boolean;
    kanbanSort: "priority" | "date" | "created" | "alpha";
    timeboxOpen: boolean;
    projectSort: "manual" | "name" | "priority" | "dueDate" | "recent";
    /** Running or paused Pomodoro, so it survives reload and follows the account. */
    focusSession: FocusSession | null;
  };
  shortcuts: {
    palette: Shortcut;
    help: Shortcut;
    overview: Shortcut;
    days: Shortcut;
    today: Shortcut;
    quickAdd: Shortcut;
    /** Close the hovered card, or the open task, as missed. */
    markMissed: Shortcut;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  general: {
    defaultView: "overview",
    newTaskPosition: "bottom",
    defaultDurationMin: 60,
    defaultPriority: "p3",
    completeParentWhenSubtasksDone: false,
    moveDoneToBottom: true,
    rolloverEnabled: false,
    rolloverRecurring: false,
    allowAnalytics: false,
  },
  calendar: {
    weekStartsOn: 1,
    timeFormat: "12h",
    dayStartHour: 7,
    snapMinutes: 15,
    showDeclinedEvents: false,
    workdayThresholdEnabled: false,
    workdayThresholdHours: 8,
  },
  email: { aiEnrich: true },
  dueDates: { indicatorWithinDays: 3, reminderNotifications: false },
  pomodoro: { workMin: 25, shortBreakMin: 5, longBreakMin: 15, roundsBeforeLongBreak: 4, autoStartBreaks: true, autoStartNext: false, sound: true },
  ai: { approval: "ask", showReasoning: false, schedulingPreferences: "" },
  ui: { sidebarCollapsed: false, kanbanView: "overview", kanbanShowDone: false, kanbanSort: "priority", timeboxOpen: true, projectSort: "manual", focusSession: null },
  shortcuts: { palette: "mod+/", help: "?", overview: "shift+o", days: "shift+d", today: "shift+t", quickAdd: "1", markMissed: "shift+m" },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeSettings(saved: unknown): Settings {
  const s = (saved ?? {}) as DeepPartial<Settings>;
  const out = {} as Settings;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    (out as unknown as Record<string, unknown>)[k] = { ...DEFAULT_SETTINGS[k], ...((s[k] as object) ?? {}) };
  }
  return out;
}

/** Live settings plus a section-scoped updater: update("calendar", { timeFormat: "24h" }). */
export function useSettings() {
  const prefs = useQuery(api.userPreferences.get, {});
  const save = useMutation(api.userPreferences.update);
  const settings = useMemo(() => mergeSettings(prefs?.prefs), [prefs]);
  const update = useCallback(
    <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => save({ prefs: { [section]: patch } }),
    [save],
  );
  return { settings, update, loaded: prefs !== undefined } as const;
}

/* ─── shortcuts ─── */

/** True when the keyboard event matches a combo like "mod+/", "shift+o", "?" or "1". */
export function matchesShortcut(e: KeyboardEvent, combo: Shortcut): boolean {
  if (!combo) return false;
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const needMod = parts.includes("mod");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const mod = e.metaKey || e.ctrlKey;
  if (needMod !== mod) return false;
  if (needAlt !== e.altKey) return false;
  // Shift is implied for shifted characters like "?"; only enforce it when named.
  if (needShift && !e.shiftKey) return false;
  if (!needShift && e.shiftKey && key.length === 1 && /[a-z0-9]/.test(key)) return false;
  return e.key.toLowerCase() === key;
}

/** Turn a keydown into a combo string, or null for a bare modifier press. */
export function comboFromEvent(e: KeyboardEvent): Shortcut | null {
  if (["Shift", "Control", "Meta", "Alt"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && !(e.key.length === 1 && /[^a-z0-9]/i.test(e.key))) parts.push("shift");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Display pieces for a combo: ["Cmd", "/"] etc. */
export function shortcutKeys(combo: Shortcut): string[] {
  return combo.split("+").map((p) => {
    if (p === "mod") return IS_MAC ? "⌘" : "Ctrl";
    if (p === "shift") return "⇧";
    if (p === "alt") return IS_MAC ? "⌥" : "Alt";
    if (p === "enter") return "↵";
    if (p === "escape") return "Esc";
    return p.length === 1 ? p.toUpperCase() : p;
  });
}

/* ─── clock ─── */

export function formatClock(time: string, fmt: Settings["calendar"]["timeFormat"]): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;
  if (fmt === "24h") return `${String(h).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}
