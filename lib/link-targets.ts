"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

/** Something text can link to: a task (by number) or a note (by title). */
export type LinkItem =
  | { kind: "task"; number: number; title: string; done: boolean }
  | { kind: "note"; id: string; title: string };

/** "#" looks up task numbers; "@" and "[[" look up tasks and notes by title. */
export type LinkTrigger = "number" | "any";

/*
 * The editor's suggestion plugins read these synchronously, so the latest
 * query results live in module state, kept fresh by useLinkSources().
 */
const source: { tasks: Doc<"tasks">[]; notes: { _id: string; title: string }[] } = { tasks: [], notes: [] };

export function useLinkSources() {
  const tasks = useQuery(api.tasks.listOpen, {});
  const notes = useQuery(api.notes.titles, {});
  useEffect(() => { if (tasks) source.tasks = tasks; }, [tasks]);
  useEffect(() => { if (notes) source.notes = notes; }, [notes]);
}

export function findLinkTargets(raw: string, trigger: LinkTrigger, limit = 8): LinkItem[] {
  const query = raw.trim();
  const lower = query.toLowerCase();
  const numeric = /^\d+$/.test(query);
  let tasks = source.tasks.filter((t) => t.number !== undefined);
  if (trigger === "number" || numeric) {
    tasks = tasks
      .filter((t) => String(t.number).startsWith(query))
      .sort((a, b) => Number(String(b.number) === query) - Number(String(a.number) === query) || (b.number ?? 0) - (a.number ?? 0));
  } else if (!query) {
    tasks = [...tasks].sort((a, b) => b._creationTime - a._creationTime);
  } else {
    tasks = tasks
      .filter((t) => t.title.toLowerCase().includes(lower))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(lower)) - Number(a.title.toLowerCase().startsWith(lower)) || b._creationTime - a._creationTime);
  }
  const out: LinkItem[] = [];
  if (trigger === "any" && !numeric) {
    const notes = source.notes.filter((n) => n.title && (!query || n.title.toLowerCase().includes(lower)));
    for (const n of notes.slice(0, tasks.length ? Math.ceil(limit / 2) : limit)) out.push({ kind: "note", id: n._id, title: n.title });
  }
  for (const t of tasks.slice(0, limit - out.length)) out.push({ kind: "task", number: t.number!, title: t.title, done: t.status === "done" });
  // A number that is not open (done, or archived) still links.
  if (numeric && !out.some((i) => i.kind === "task" && String(i.number) === query)) {
    out.unshift({ kind: "task", number: Number(query), title: `Task #${query}`, done: false });
  }
  return out;
}
