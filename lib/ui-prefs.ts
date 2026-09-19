"use client";

import { useCallback, useState } from "react";
import { useSettings, type Settings } from "@/lib/settings";

type UiPrefs = Settings["ui"];
const LS = "unifocus:ui-prefs";

/*
 * UI state (sidebar collapsed, board view, sort, Timebox open) lives in
 * Convex with the rest of the settings so it follows the account. A local
 * mirror covers the first paint before Convex answers; after that Convex is
 * the truth, and every write goes to both.
 */
function readMirror(): Partial<UiPrefs> {
  try { return JSON.parse(localStorage.getItem(LS) ?? "{}") as Partial<UiPrefs>; } catch { return {}; }
}
function writeMirror(patch: Partial<UiPrefs>) {
  try { localStorage.setItem(LS, JSON.stringify({ ...readMirror(), ...patch })); } catch { /* ignore */ }
}

export function useUiPref<K extends keyof UiPrefs>(key: K): [UiPrefs[K], (v: UiPrefs[K]) => void] {
  const { settings, update, loaded } = useSettings();
  const [mirror] = useState<UiPrefs[K] | undefined>(() =>
    typeof window === "undefined" ? undefined : (readMirror()[key] as UiPrefs[K] | undefined),
  );
  // Optimistic value between click and Convex round trip.
  const [pending, setPending] = useState<UiPrefs[K] | undefined>(undefined);
  const fromDb = settings.ui[key];
  const value = pending !== undefined && pending !== fromDb ? pending : loaded ? fromDb : (mirror ?? fromDb);
  const set = useCallback((v: UiPrefs[K]) => {
    setPending(v);
    writeMirror({ [key]: v } as Partial<UiPrefs>);
    void update("ui", { [key]: v } as Partial<UiPrefs>).then(() => setPending(undefined));
  }, [key, update]);
  return [value, set];
}
