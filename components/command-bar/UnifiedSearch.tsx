"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { IconType } from "react-icons";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { SlidingHighlight } from "@/components/ui/sliding-highlight";
import { ProjectGlyph } from "@/components/ui/project-glyph";
import { useTheme } from "@/components/ThemeProvider";
import { useTimeboxOpen } from "@/lib/timebox-store";
import { useUiPref } from "@/lib/ui-prefs";
import { useQuickAdd } from "@/lib/quick-add";
import { format, parseISO, isValid } from "date-fns";
import {
  IoSearch, IoAdd, IoSparkles, IoFileTrayFull, IoAlertCircle, IoCalendar, IoGrid, IoTime,
  IoSunny, IoMoon, IoHelpCircle, IoLogoGoogle, IoSync, IoFolder, IoArchive, IoReturnDownBack,
  IoChevronUp, IoChevronDown, IoCheckmarkCircle, IoEllipseOutline, IoSettings,
} from "react-icons/io5";

/*
 * The one command palette (Cmd+K). Modelled on Aturno's command bar: a plain
 * opaque sheet, a tall input row, capsule rows with a round glyph, one sliding
 * highlight, grouped results, and a kbd footer. Everything a user would expect
 * to find is here: tasks by title or description, every project including
 * archived ones, views, and the small actions (theme, sync, help, Google).
 */

type Row = {
  id: string;
  group: "Actions" | "Tasks" | "Projects" | "Go to" | "Settings";
  glyph: React.ReactNode;
  title: React.ReactNode;
  subtitle?: string;
  trailing?: React.ReactNode;
  keywords: string;
  run: () => void;
};

const GROUP_ORDER: Row["group"][] = ["Actions", "Tasks", "Projects", "Go to", "Settings"];

export function UnifiedSearch({ open, onOpenChange, onAskAI, onNewProject, onOpenHelp, onOpenGoogle, onOpenSettings }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAskAI: (query: string) => void;
  onNewProject: () => void;
  onOpenHelp: () => void;
  onOpenGoogle: () => void;
  onOpenSettings: () => void;
}) {
  const router = useRouter();
  const tasks = useQuery(api.tasks.list, {});
  const projects = useQuery(api.projects.list, {});
  const { create: quickCreate } = useQuickAdd();
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const { theme, toggleTheme } = useTheme();
  const [timeboxOpen, setTimeboxOpen] = useTimeboxOpen();
  const [, setKanbanView] = useUiPref("kanbanView");

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const close = () => { setQuery(""); setActive(0); onOpenChange(false); };
  const go = (fn: () => void) => () => { close(); fn(); };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const projectById = new Map((projects ?? []).map((p) => [p._id, p]));

    // Actions that use the query itself
    out.push({
      id: "new-task", group: "Actions",
      glyph: <Glyph icon={IoAdd} tone="brand" />,
      title: q ? <>New task <span className="text-text-muted">&ldquo;{query.trim()}&rdquo;</span></> : "New task",
      keywords: "new task add create",
      run: go(async () => {
        const id = await quickCreate({ title: query.trim() || "New task", dueDate: format(new Date(), "yyyy-MM-dd") });
        if (id) router.push(`/task/${id}`);
      }),
    });
    if (q) {
      out.push({
        id: "ask-ai", group: "Actions",
        glyph: <Glyph icon={IoSparkles} tone="brand" />,
        title: <>Ask AI <span className="text-text-muted">&ldquo;{query.trim()}&rdquo;</span></>,
        keywords: "ask ai agent",
        run: go(() => onAskAI(query.trim())),
      });
    }
    out.push({ id: "new-project", group: "Actions", glyph: <Glyph icon={IoFolder} tone="brand" />, title: "New project", keywords: "new project create folder", run: go(onNewProject) });

    // Tasks: title and description, open ones first
    if (q) {
      const hits = (tasks ?? [])
        .filter((t) => !t.parentTaskId && (t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)))
        .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
        .slice(0, 8);
      for (const t of hits) {
        const p = t.projectId ? projectById.get(t.projectId) : undefined;
        const done = t.status === "done";
        out.push({
          id: `task-${t._id}`, group: "Tasks",
          glyph: (
            <button
              onClick={(e) => { e.stopPropagation(); void toggleComplete({ id: t._id, userDate: format(new Date(), "yyyy-MM-dd") }); }}
              aria-label={done ? "Mark as not done" : "Mark as done"}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-faint hover:text-text-strong"
            >
              {done ? <IoCheckmarkCircle className="size-[18px] text-brand" /> : <IoEllipseOutline className="size-[18px]" />}
            </button>
          ),
          title: <span className={done ? "line-through text-text-muted" : ""}>{t.title}</span>,
          subtitle: p ? p.name : undefined,
          trailing: t.dueDate && isValid(parseISO(t.dueDate)) ? <span className="text-[11.5px] tabular-nums text-text-faint">{format(parseISO(t.dueDate), "MMM d")}</span> : undefined,
          keywords: "",
          run: go(() => router.push(`/task/${t._id}`)),
        });
      }
    }

    // Projects: all of them, archived marked
    for (const p of (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))) {
      out.push({
        id: `project-${p._id}`, group: "Projects",
        glyph: <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.06]"><ProjectGlyph icon={p.icon} className="size-[18px]" style={{ color: p.color }} /></span>,
        title: p.name,
        subtitle: p.description || undefined,
        trailing: p.status === "archived" ? <span className="inline-flex items-center gap-1 text-[11px] text-text-faint"><IoArchive className="size-3" />Archived</span> : undefined,
        keywords: "",
        run: go(() => router.push(`/project/${p._id}`)),
      });
    }

    // Views
    const nav: Row[] = [
      { id: "go-inbox", group: "Go to", glyph: <Glyph icon={IoFileTrayFull} />, title: "Inbox", keywords: "inbox home board", run: go(() => router.push("/timeline")) },
      { id: "go-overdue", group: "Go to", glyph: <Glyph icon={IoAlertCircle} />, title: "Overdue", keywords: "overdue late", run: go(() => router.push("/timeline?view=overdue")) },
      { id: "go-today", group: "Go to", glyph: <Glyph icon={IoCalendar} />, title: "Today", subtitle: "Days view on today", keywords: "today days calendar", run: go(() => router.push(`/timeline?date=${format(new Date(), "yyyy-MM-dd")}`)) },
      { id: "go-overview", group: "Go to", glyph: <Glyph icon={IoGrid} />, title: "Overview", subtitle: "Today, this week, next week, month", keywords: "overview week month", run: go(() => { router.push("/timeline"); setKanbanView("overview"); }) },
      { id: "toggle-timebox", group: "Go to", glyph: <Glyph icon={IoTime} />, title: timeboxOpen ? "Hide Timebox" : "Show Timebox", keywords: "timebox schedule time grid", run: go(() => setTimeboxOpen(!timeboxOpen)) },
    ];
    // Settings
    const settings: Row[] = [
      { id: "theme", group: "Settings", glyph: <Glyph icon={theme === "dark" ? IoSunny : IoMoon} />, title: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", keywords: "theme dark light mode appearance", run: go(toggleTheme) },
      { id: "sync", group: "Settings", glyph: <Glyph icon={IoSync} />, title: "Sync Google Calendar now", keywords: "sync google calendar refresh", run: go(() => { fetch("/api/sync/pull-calendar", { method: "POST" }).catch(() => {}); fetch("/api/sync/process-queue", { method: "POST" }).catch(() => {}); }) },
      { id: "google", group: "Settings", glyph: <Glyph icon={IoLogoGoogle} />, title: "Google Calendar connection", keywords: "google connect account calendar", run: go(onOpenGoogle) },
      { id: "settings", group: "Settings", glyph: <Glyph icon={IoSettings} />, title: "Settings", keywords: "settings preferences options", run: go(onOpenSettings) },
      { id: "help", group: "Settings", glyph: <Glyph icon={IoHelpCircle} />, title: "Help and shortcuts", keywords: "help shortcuts keyboard", run: go(onOpenHelp) },
    ];
    const matches = (r: Row) => !q || r.keywords.includes(q) || String(typeof r.title === "string" ? r.title : "").toLowerCase().includes(q);
    out.push(...nav.filter(matches), ...settings.filter(matches));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, tasks, projects, theme, timeboxOpen]);

  const grouped = useMemo(() => GROUP_ORDER.map((g) => ({ g, items: rows.filter((r) => r.group === g) })).filter((x) => x.items.length), [rows]);
  const flat = useMemo(() => grouped.flatMap((x) => x.items), [grouped]);
  const activeId = flat[Math.min(active, flat.length - 1)]?.id;

  // Keep the active row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); flat[Math.min(active, flat.length - 1)]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(true); }}>
      <DialogPopup className="max-w-[600px] overflow-hidden !rounded-[24px] !p-0" showCloseButton={false} bottomStickOnMobile={false}>
        <div className="flex max-h-[70vh] flex-col" onKeyDown={onKeyDown}>
          {/* Input row */}
          <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-5 dark:border-white/[0.08]">
            <IoSearch className="size-5 shrink-0 text-text-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder="Search tasks and projects, or type a command"
              className="h-[52px] flex-1 bg-transparent text-[15px] text-text-strong outline-none placeholder:text-text-faint"
            />
            {q && (
              <kbd className="inline-flex h-[18px] items-center rounded-full bg-black/[0.05] px-1.5 text-[10px] font-medium text-text-muted dark:bg-white/[0.08]">esc</kbd>
            )}
          </div>

          {/* Results */}
          <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-py-2 px-1.5 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <SlidingHighlight containerRef={listRef} />
            {flat.length === 0 && <p className="py-10 text-center text-sm text-text-muted">Nothing matches.</p>}
            {grouped.map(({ g, items }) => (
              <div key={g}>
                <div className="px-3 pb-1 pt-3 text-[12px] font-medium text-text-faint">{g}</div>
                {items.map((r) => (
                  <button
                    key={r.id}
                    data-id={r.id}
                    data-row
                    data-highlighted={r.id === activeId ? "" : undefined}
                    onMouseEnter={() => setActive(flat.indexOf(r))}
                    onClick={r.run}
                    className="relative z-10 flex h-11 w-full cursor-default items-center gap-3 rounded-full px-2 text-left outline-none"
                  >
                    {r.glyph}
                    <span className="min-w-0 flex-1 truncate text-[14px] text-text-strong">
                      {r.title}
                      {r.subtitle && <span className="ml-2 text-[12px] text-text-muted">{r.subtitle}</span>}
                    </span>
                    {r.trailing && <span className="shrink-0 pr-1">{r.trailing}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center gap-4 border-t border-black/[0.06] px-5 py-2.5 text-[12px] text-text-muted dark:border-white/[0.08]">
            <span className="inline-flex items-center gap-1.5">
              <Key><IoChevronUp className="size-3" /></Key><Key><IoChevronDown className="size-3" /></Key> navigate
            </span>
            <span className="inline-flex items-center gap-1.5"><Key><IoReturnDownBack className="size-3" /></Key> open</span>
            <span className="inline-flex items-center gap-1.5"><Key>esc</Key> close</span>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function Glyph({ icon: Icon, tone }: { icon: IconType; tone?: "brand" }) {
  return (
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tone === "brand" ? "bg-brand/10 text-brand" : "bg-black/[0.05] text-text-muted dark:bg-white/[0.08]"}`}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-black/[0.05] px-1 text-[10px] font-medium dark:bg-white/[0.08]">{children}</kbd>;
}

export type { Doc };
