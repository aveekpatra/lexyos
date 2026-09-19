"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useSettings, type Settings } from "@/lib/settings";

type UiPrefs = Settings["ui"];
const LS = "unifocus:ui-prefs";

/*
 * UI state (sidebar collapsed, board view, sort, Timebox open) lives in
 * Convex with the rest of the settings so it follows the account. A local
 * mirror covers the first paint before Convex answers; after that Convex is
 * the truth, and every write goes to both. The mirror is read through
 * useSyncExternalStore so server and client render the same first frame.
 */
const listeners = new Set<() => void>();
function readMirror(): Partial<UiPrefs> {
  try { return JSON.parse(localStorage.getItem(LS) ?? "{}") as Partial<UiPrefs>; } catch { return {}; }
}
const EMPTY: Partial<UiPrefs> = {};
let snapshot: Partial<UiPrefs> | null = null;
const mirror = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  get(): Partial<UiPrefs> { if (!snapshot) snapshot = readMirror(); return snapshot; },
  getServer(): Partial<UiPrefs> { return EMPTY; },
  write(patch: Partial<UiPrefs>) {
    snapshot = { ...mirror.get(), ...patch };
    try { localStorage.setItem(LS, JSON.stringify(snapshot)); } catch { /* ignore */ }
    listeners.forEach((l) => l());
  },
};

export function useUiPref<K extends keyof UiPrefs>(key: K): [UiPrefs[K], (v: UiPrefs[K]) => void] {
  const { settings, update, loaded } = useSettings();
  const mirrored = useSyncExternalStore(mirror.subscribe, mirror.get, mirror.getServer)[key] as UiPrefs[K] | undefined;
  // Optimistic value between click and Convex round trip.
  const [pending, setPending] = useState<UiPrefs[K] | undefined>(undefined);
  const fromDb = settings.ui[key];
  const value = pending !== undefined && pending !== fromDb ? pending : loaded ? fromDb : (mirrored ?? fromDb);
  const set = useCallback((v: UiPrefs[K]) => {
    setPending(v);
    mirror.write({ [key]: v } as Partial<UiPrefs>);
    void update("ui", { [key]: v } as Partial<UiPrefs>).then(() => setPending(undefined));
  }, [key, update]);
  return [value, set];
}
