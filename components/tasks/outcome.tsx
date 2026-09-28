"use client";

/**
 * "Missed": a task closed without happening. Stored as status "done" plus
 * outcome "missed" (see convex/schema.ts), so it leaves Overdue and never
 * rolls forward, but reads differently from done everywhere it shows.
 */

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { syncCompletionResultToGoogle } from "@/lib/google-sync";

export const isMissed = (task: Pick<Doc<"tasks">, "status" | "outcome">) =>
  task.status === "done" && task.outcome === "missed";

/** Close a task as missed (a repeating one records the miss and moves on). */
export function useMarkMissed() {
  const markMissed = useMutation(api.tasks.markMissed);
  return useCallback(async (task: Doc<"tasks">, reason?: string) => {
    const result = await markMissed({ id: task._id, reason, userDate: format(new Date(), "yyyy-MM-dd") });
    try { await syncCompletionResultToGoogle(task, result, false, true); } catch (err) { console.warn("Google sync failed:", err); }
    return result;
  }, [markMissed]);
}

/** The completion circle's missed state: a muted ring with a slash through it. */
export function MissedMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-faint" aria-hidden>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 12.5L12.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
