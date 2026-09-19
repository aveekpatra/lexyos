"use client";

import { useSyncExternalStore } from "react";

/**
 * Timebox panel state shared by the Inbox header (toggle) and the panel.
 * Open state persists; the viewed date resets to today on load.
 */
const OPEN_KEY = "unifocus:timebox:open";
const listeners = new Set<() => void>();
let date = "";
const emit = () => listeners.forEach((l) => l());

const store = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  getOpen(): boolean { try { return localStorage.getItem(OPEN_KEY) !== "false"; } catch { return true; } },
  getServerOpen(): boolean { return true; },
  setOpen(next: boolean) { try { localStorage.setItem(OPEN_KEY, String(next)); } catch {} emit(); },
  getDate(): string { return date; },
  setDate(next: string) { date = next; emit(); },
};

export function useTimeboxOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(store.subscribe, store.getOpen, store.getServerOpen);
  return [open, store.setOpen];
}

export function useTimeboxDate(): [string, (d: string) => void] {
  const d = useSyncExternalStore(store.subscribe, store.getDate, () => "");
  return [d, store.setDate];
}
