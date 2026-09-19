"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFocusSession, pauseFocus, resumeFocus, stopFocus, nextPhase } from "@/lib/focus-store";
import { useSettings } from "@/lib/settings";
import { IoPause, IoPlay, IoClose, IoPlaySkipForward, IoTimer } from "react-icons/io5";

/*
 * The Pomodoro capsule: floats bottom centre while a session runs. Reads the
 * lengths chosen at start, honours the auto-start and sound settings, and
 * fires a browser notification when a block ends if reminders are allowed.
 */
export function FocusTimer() {
  const session = useFocusSession();
  const { settings } = useSettings();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const firedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!session?.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [session?.running]);

  useEffect(() => {
    if (!session || !session.running) return;
    const left = session.endsAt - Date.now();
    if (left > 0 || firedFor.current === session.endsAt) return;
    firedFor.current = session.endsAt;
    if (settings.pomodoro.sound) beep();
    const finished = session.phase;
    const next = nextPhase(finished === "focus" ? settings.pomodoro.autoStartBreaks : settings.pomodoro.autoStartNext);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(finished === "focus" ? "Focus block done" : "Break over", {
        body: finished === "focus" ? `Time for a ${next === "long" ? "long" : "short"} break` : `Back to ${session.taskTitle || "work"}`,
      });
    }
  });

  if (!session) return null;
  const left = session.running ? Math.max(0, session.endsAt - now) : session.remainingMs;
  const mm = String(Math.floor(left / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const total = (session.phase === "focus" ? session.lengths.focus : session.phase === "short" ? session.lengths.short : session.lengths.long) * 60_000;
  const progress = 1 - left / total;
  const label = session.phase === "focus" ? "Focus" : session.phase === "short" ? "Short break" : "Long break";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center">
      <div className="pointer-events-auto flex h-12 items-center gap-2 rounded-full pl-2 pr-1.5 focus-pill">
        <span className="relative flex size-8 items-center justify-center">
          <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
            <circle cx="16" cy="16" r="13" className="fill-none stroke-black/[0.08] dark:stroke-white/[0.12]" strokeWidth="3" />
            <circle cx="16" cy="16" r="13" className={`fill-none ${session.phase === "focus" ? "stroke-brand" : "stroke-emerald-500"}`} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 13}`} strokeDashoffset={`${2 * Math.PI * 13 * (1 - progress)}`} />
          </svg>
          <IoTimer className="size-3.5 text-text-muted" />
        </span>
        <button onClick={() => session.taskId && router.push(`/task/${session.taskId}`)} className="min-w-0 max-w-[220px] text-left">
          <span className="block truncate text-[13px] font-medium leading-4 text-text-strong">{session.taskTitle || "Focus"}</span>
          <span className="block text-[11px] leading-4 text-text-muted">{label} · round {session.round}</span>
        </button>
        <span className="min-w-[52px] text-center text-[15px] font-semibold tabular-nums text-text-strong">{mm}:{ss}</span>
        <button onClick={() => (session.running ? pauseFocus() : resumeFocus())} aria-label={session.running ? "Pause" : "Resume"} className={circle}>
          {session.running ? <IoPause className="size-3.5" /> : <IoPlay className="size-3.5" />}
        </button>
        <button onClick={() => nextPhase(true)} aria-label="Skip" className={circle}><IoPlaySkipForward className="size-3.5" /></button>
        <button onClick={stopFocus} aria-label="Stop" className={closeCircle}><IoClose className="size-3.5" /></button>
      </div>
    </div>
  );
}

const circle = "flex size-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/[0.06] hover:text-text-strong dark:hover:bg-white/[0.1]";
/** Aturno close: a filled grey disc inside a fainter ring, both concentric. */
const closeCircle = "ml-0.5 flex size-8 items-center justify-center rounded-full bg-black/[0.07] text-text-secondary ring-[3px] ring-black/[0.04] transition-colors hover:bg-black/[0.12] hover:text-text-strong dark:bg-white/[0.1] dark:ring-white/[0.05] dark:hover:bg-white/[0.16]";

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(ctx.currentTime + 0.18);
    setTimeout(() => ctx.close(), 400);
  } catch { /* no audio */ }
}
