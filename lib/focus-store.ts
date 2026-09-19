"use client";

import { useSyncExternalStore } from "react";

/**
 * Pomodoro session state, app-wide. One session at a time, optionally tied
 * to a task. Phases run focus, short break, focus ... and a long break after
 * the configured number of rounds. Lengths come from settings at start time.
 */
export type Phase = "focus" | "short" | "long";

export interface FocusSession {
  taskId: string | null;
  taskTitle: string;
  phase: Phase;
  /** Epoch ms when the current phase ends (while running). */
  endsAt: number;
  /** Remaining ms (while paused). */
  remainingMs: number;
  running: boolean;
  round: number;
  lengths: { focus: number; short: number; long: number; rounds: number };
}

let session: FocusSession | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const store = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  get: () => session,
  getServer: () => null as FocusSession | null,
};

export function startFocus(input: { taskId: string | null; taskTitle: string; lengths: FocusSession["lengths"] }) {
  const ms = input.lengths.focus * 60_000;
  session = { taskId: input.taskId, taskTitle: input.taskTitle, phase: "focus", endsAt: Date.now() + ms, remainingMs: ms, running: true, round: 1, lengths: input.lengths };
  emit();
}

export function pauseFocus() {
  if (!session || !session.running) return;
  session = { ...session, running: false, remainingMs: Math.max(0, session.endsAt - Date.now()) };
  emit();
}

export function resumeFocus() {
  if (!session || session.running) return;
  session = { ...session, running: true, endsAt: Date.now() + session.remainingMs };
  emit();
}

export function stopFocus() { session = null; emit(); }

/** Advance to the next phase. Returns the phase entered. */
export function nextPhase(autoStart: boolean): Phase | null {
  if (!session) return null;
  let phase: Phase;
  let round = session.round;
  if (session.phase === "focus") {
    phase = round % session.lengths.rounds === 0 ? "long" : "short";
  } else {
    phase = "focus";
    round += 1;
  }
  const ms = (phase === "focus" ? session.lengths.focus : phase === "short" ? session.lengths.short : session.lengths.long) * 60_000;
  session = { ...session, phase, round, remainingMs: ms, endsAt: Date.now() + ms, running: autoStart };
  emit();
  return phase;
}

export function useFocusSession(): FocusSession | null {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}
