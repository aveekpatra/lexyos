"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  IoAdd, IoAddCircle, IoArrowUndoCircle, IoBan, IoCalendar, IoCheckmarkCircle, IoCloseCircle, IoEllipseOutline,
  IoFlag, IoFolder, IoLink, IoPencil, IoReorderThree, IoRepeat, IoReturnDownForward, IoTime, IoGrid, IoEllipse,
} from "react-icons/io5";
import type { IconType } from "react-icons";
import { Connections } from "@/components/notes/NotesView";
import { LinkMenu } from "@/components/editor/LinkMenu";
import { findLinkTargets, useLinkSources, type LinkItem } from "@/lib/link-targets";
import { PRIORITY_LABELS, STATUS_OPTIONS } from "@/lib/constants";

/* ─── Connections, with a field to link a task or a note ─── */

export function TaskConnections({ task }: { task: Doc<"tasks"> }) {
  useLinkSources();
  const link = useMutation(api.tasks.link);
  const connect = useMutation(api.graph.connect);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = open ? findLinkTargets(query, "any", 6).filter((i) => !(i.kind === "task" && i.number === task.number)) : [];

  const pick = async (item: LinkItem) => {
    setQuery("");
    setOpen(false);
    setError(null);
    try {
      if (item.kind === "task") await link({ id: task._id, number: item.number });
      else await connect({ fromKind: "task", fromId: task._id, toKind: "note", toId: item.id });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Could not link");
    }
  };

  return (
    <Connections kind="task" id={task._id}>
      <div className="relative">
        <div className="flex h-9 items-center gap-3 rounded-full px-3 text-[13px] transition-colors focus-within:bg-hover">
          <IoLink className="size-4 shrink-0 text-text-faint" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value.replace(/^#/, "")); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); return; }
              if (e.key === "Enter" && items[0]) { e.preventDefault(); void pick(items[0]); }
            }}
            placeholder="Link a task (#554) or a note"
            className="min-w-0 flex-1 bg-transparent text-text-secondary outline-none placeholder:text-text-faint"
          />
        </div>
        {open && items.length > 0 && (
          <div className="absolute left-0 top-10 z-30">
            <LinkMenu items={items} onPick={(i) => void pick(i)} />
          </div>
        )}
        {error && <p className="px-3 pt-1 text-[12px] text-[#ef4444]">{error}</p>}
      </div>
    </Connections>
  );
}

/* ─── Activity: the task's whole journey, Linear-style ─── */

type TaskEvent = Doc<"taskEvents">;

const day = (v: unknown) => (typeof v === "string" ? format(parseISO(v), "EEE, MMM d") : "");
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const field = (v: unknown, key: string) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined);

function daysBetween(a: string, b: string) {
  return differenceInCalendarDays(parseISO(b), parseISO(a));
}

export function TaskActivity({ task }: { task: Doc<"tasks"> }) {
  const raw = useQuery(api.tasks.history, { id: task._id });
  const projects = useQuery(api.projects.list, {});
  const events = useMemo(() => collapse(raw ?? []), [raw]);

  const slip = useMemo(() => {
    const moves = events.filter((e) => e.field === "day");
    const pushes = moves.filter((m) => str(m.from) && str(m.to) && str(m.to)! > str(m.from)!).length;
    if (!pushes) return null;
    const first = str(field(events.find((e) => e.field === "created")?.to, "day")) ?? str(moves[0]?.from);
    let text = `Pushed ${pushes} time${pushes === 1 ? "" : "s"}`;
    if (first && task.dueDate) {
      const d = daysBetween(first, task.dueDate);
      if (d > 0) text += ` · ${d} day${d === 1 ? "" : "s"} later than first planned`;
    }
    return text;
  }, [events, task.dueDate]);

  const describe = (e: TaskEvent): { icon: IconType; text: string; tone?: string } => {
    switch (e.field) {
      case "created": {
        const d = str(field(e.to, "day"));
        return { icon: IoAddCircle, text: `Created${d ? ` for ${day(d)}` : ""}` };
      }
      case "day": {
        const a = str(e.from), b = str(e.to);
        if (a && b) {
          const d = daysBetween(a, b);
          const delta = d === 0 ? "" : d > 0 ? `, ${d} day${d === 1 ? "" : "s"} later` : `, ${-d} day${d === -1 ? "" : "s"} earlier`;
          return { icon: IoCalendar, text: `Moved from ${day(a)} to ${day(b)}${delta}`, tone: d > 0 ? "text-orange-500" : "text-emerald-500" };
        }
        return b ? { icon: IoCalendar, text: `Scheduled for ${day(b)}` } : { icon: IoCalendar, text: "Date removed" };
      }
      case "time": {
        const f = (v: unknown) => str(v)?.split("-").join(" to ");
        const a = f(e.from), b = f(e.to);
        return { icon: IoTime, text: a && b ? `Time changed from ${a} to ${b}` : b ? `Time set to ${b}` : "Time removed" };
      }
      case "priority": {
        const l = (v: unknown) => PRIORITY_LABELS[str(v) as keyof typeof PRIORITY_LABELS] ?? "none";
        return { icon: IoFlag, text: `Priority ${l(e.from)} to ${l(e.to)}` };
      }
      case "status": {
        const label = (v: unknown) => STATUS_OPTIONS.find((s) => s.value === v)?.label ?? "none";
        if (e.to === "done") return { icon: IoCheckmarkCircle, text: "Completed", tone: "text-emerald-500" };
        if (e.from === "done") return { icon: IoArrowUndoCircle, text: "Reopened" };
        return { icon: IoEllipseOutline, text: `Status ${label(e.from)} to ${label(e.to)}` };
      }
      case "outcome":
        return e.to === "missed" ? { icon: IoBan, text: "Marked missed", tone: "text-rose-500" } : { icon: IoEllipse, text: "No longer missed" };
      case "occurrence": {
        const missed = field(e.from, "missed") === true;
        const d = str(field(e.from, "day"));
        const next = str(e.to);
        return { icon: missed ? IoCloseCircle : IoCheckmarkCircle, text: `${missed ? "Missed" : "Done"} for ${d ? day(d) : "that day"}${next ? `, next on ${day(next)}` : ""}`, tone: missed ? "text-rose-500" : "text-emerald-500" };
      }
      case "title": return { icon: IoPencil, text: str(e.from) ? `Renamed from “${str(e.from)}”` : "Renamed" };
      case "projectId": {
        const p = projects?.find((x) => x._id === e.to);
        return { icon: IoFolder, text: e.to ? `Moved to ${p?.name ?? "a project"}` : "Removed from its project" };
      }
      case "recurrence":
        return { icon: IoRepeat, text: e.to == null ? "Stopped repeating" : e.from == null ? "Set to repeat" : "Repeat rule changed" };
      case "parentTaskId": return { icon: IoReturnDownForward, text: e.to ? "Made a subtask" : "No longer a subtask" };
      case "columnId": return { icon: IoGrid, text: "Moved to another column" };
      case "description": return { icon: IoReorderThree, text: "Description edited" };
      case "mention": {
        const label = str(field(e.to, "label"));
        return { icon: IoLink, text: label ? `Mentioned ${label}` : "Removed a mention" };
      }
      case "mentionedIn": return { icon: IoLink, text: `Mentioned in “${str(field(e.to, "label")) ?? "a note"}”` };
      case "link": {
        const n = typeof e.to === "number" ? e.to : undefined, m = typeof e.from === "number" ? e.from : undefined;
        return { icon: IoLink, text: n !== undefined ? `Linked to #${n}` : m !== undefined ? `Unlinked from #${m}` : "Link changed" };
      }
      default: return { icon: IoEllipse, text: e.field };
    }
  };

  const who = (a: string) => ({ mac: "on Mac", agent: "by the agent", google: "from Google Calendar", system: "automatically" } as Record<string, string>)[a] ?? "on the web";
  const hasCreated = events.some((e) => e.field === "created");

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2 px-3">
        <h2 className="text-[13px] font-semibold text-text-strong">Activity</h2>
        {slip && <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-500">{slip}</span>}
      </div>
      <ol className="flex flex-col px-3">
        {!hasCreated && (
          <Line icon={IoAdd} text="Created" meta={format(task._creationTime, "MMM d, HH:mm")} last={events.length === 0} />
        )}
        {events.map((e, i) => {
          const d = describe(e);
          return <Line key={e._id} icon={d.icon} tone={d.tone} text={d.text} meta={`${who(e.actor)} · ${format(e.at, "MMM d, HH:mm")}`} last={i === events.length - 1} />;
        })}
      </ol>
    </section>
  );
}

function Line({ icon: Icon, text, meta, tone, last }: { icon: IconType; text: string; meta: string; tone?: string; last: boolean }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.06]">
          <Icon className={`size-3.5 ${tone ?? "text-text-muted"}`} />
        </span>
        {!last && <span className="w-px flex-1 bg-line" />}
      </div>
      <div className={`min-w-0 pt-0.5 ${last ? "" : "pb-4"}`}>
        <p className="text-[13px] text-text-secondary">{text}</p>
        <p className="text-[11px] text-text-faint">{meta}</p>
      </div>
    </li>
  );
}

/** Note edits save as you type; one line per burst is enough. */
function collapse(events: TaskEvent[]): TaskEvent[] {
  const out: TaskEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (prev && prev.field === e.field && prev.actor === e.actor && (e.field === "description" || e.field === "title") && e.at - prev.at < 10 * 60_000) {
      out[out.length - 1] = { ...e, from: prev.from };
    } else out.push(e);
  }
  return out;
}

