"use client";

import { useSyncExternalStore } from "react";
import { useUiPref } from "@/lib/ui-prefs";

/**
 * Timebox panel state shared by the Inbox header (toggle) and the panel.
 * Open state is an account setting (synced); the viewed date resets to today on load.
 */
const listeners = new Set<() => void>();
let date = "";
const emit = () => listeners.forEach((l) => l());
const store = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  getDate(): string { return date; },
  setDate(next: string) { date = next; emit(); },
};

export function useTimeboxOpen(): [boolean, (open: boolean) => void] {
  return useUiPref("timeboxOpen");
}

export function useTimeboxDate(): [string, (d: string) => void] {
  const d = useSyncExternalStore(store.subscribe, store.getDate, () => "");
  return [d, store.setDate];
}
