"use client";

// This file exports addRecentCommand which is used by CommandBar.tsx.
// The UI rendering is now done inline in CommandBar.tsx via CommandItem.

const STORAGE_KEY = "unifocus-recent-commands";
const MAX_RECENT = 5;

export function addRecentCommand(command: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const filtered = existing.filter((c: string) => c !== command);
    const updated = [command, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
