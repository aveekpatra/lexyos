"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { UserButton } from "@clerk/nextjs";
import type { IconType } from "react-icons";
import { useGoogleConnection } from "@/components/google/ConnectGoogleDialog";
import { Kbd } from "@/components/ui/kbd";
import { SidebarGlyph } from "@/components/ui/sidebar-glyph";
import { Folder } from "@/components/ui/folder";
import { MiniCalendar } from "@/components/sidebar/MiniCalendar";
import { getOverdueTasks } from "@/lib/task-utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { Menu, MenuTrigger, MenuPopup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { useUiPref } from "@/lib/ui-prefs";
import type { Settings } from "@/lib/settings";
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup } from "@/components/ui/context-menu";
import { useTheme } from "@/components/ThemeProvider";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { ProjectMenuItems, DeleteProjectDialog } from "@/components/projects/ProjectActions";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { ResizeHandle } from "@/components/ui/resize-handle";
import {
  IoAdd,
  IoCloudOffline,
  IoEllipsisHorizontal,
  IoFileTrayFull,
  IoHelpCircle,
  IoMoon,
  IoSearch,
  IoSunny,
  IoSync,
  IoChevronDown,
  IoChevronUp,
  IoAlertCircle,
  IoSettings,
  IoSwapVertical,
} from "react-icons/io5";

/*
 * The rail is a recessed panel on the desk. It follows Aturno's sidebar:
 * 36px capsule rows, 14px text, 18px icons, the search field as a recessed
 * capsule, plain circular soft controls (no glass on a light panel), and a
 * collapsed mode that is a single column of 36px circles.
 */

const PRIORITY_RANK: Record<string, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };
const PROJECT_SORTS: { value: Settings["ui"]["projectSort"]; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "name", label: "Name" },
  { value: "priority", label: "Priority" },
  { value: "dueDate", label: "Due date" },
  { value: "recent", label: "Recently created" },
];
function sortProjects(list: Doc<"projects">[], by: Settings["ui"]["projectSort"]): Doc<"projects">[] {
  const out = [...list];
  switch (by) {
    case "name": return out.sort((a, b) => a.name.localeCompare(b.name));
    case "priority": return out.sort((a, b) => (PRIORITY_RANK[a.priority ?? "p4"] ?? 4) - (PRIORITY_RANK[b.priority ?? "p4"] ?? 4) || a.sortOrder - b.sortOrder);
    case "dueDate": return out.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.sortOrder - b.sortOrder);
    case "recent": return out.sort((a, b) => b._creationTime - a._creationTime);
    default: return out.sort((a, b) => a.sortOrder - b.sortOrder);
  }
}

/* Row and control geometry, one source. */
const ROW = "flex h-9 w-full items-center rounded-full text-[14px] font-medium transition-colors";
const ROW_IDLE = "text-text-secondary hover:bg-black/[0.05] hover:text-text-strong dark:hover:bg-white/[0.06]";
const ROW_ACTIVE = "bg-black/[0.07] text-text-strong dark:bg-white/[0.1]";
const CIRCLE = "flex size-9 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-black/[0.05] hover:text-text-strong disabled:opacity-50 dark:hover:bg-white/[0.06]";

export function Sidebar({ onOpenSearch, onOpenHelp, onOpenGoogle, onOpenSettings }: {
  onOpenSearch: () => void;
  onOpenHelp: () => void;
  onOpenGoogle: () => void;
  onOpenSettings: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const allProjects = useQuery(api.projects.list, {});
  const [projectSort, setProjectSort] = useUiPref("projectSort");
  const tasks = useQuery(api.tasks.list, {});
  const overdueCount = useMemo(() => getOverdueTasks(tasks ?? []).filter((t) => !t.parentTaskId).length, [tasks]);
  const isOverdueView = pathname === "/timeline" && searchParams.get("view") === "overdue";
  const projects = useMemo(
    () => sortProjects((allProjects ?? []).filter((p) => p.status === "active"), projectSort),
    [allProjects, projectSort],
  );
  const archived = useMemo(
    () => [...(allProjects ?? [])].filter((p) => p.status === "archived").sort((a, b) => a.sortOrder - b.sortOrder),
    [allProjects],
  );
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [toDelete, setToDelete] = useState<Doc<"projects"> | null>(null);
  const [collapsed, setCollapsed] = useUiPref("sidebarCollapsed");
  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);
  const { width, resizing, onPointerDown } = useResizableWidth("sidebar", { initial: 260, min: 248, max: 400, side: "right" });

  const inProject = pathname.startsWith("/project/");
  const gutter = collapsed ? "px-2.5" : "px-3";

  return (
    <aside
      className={`relative flex shrink-0 flex-col bg-surface-2 ${resizing ? "" : "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"}`}
      style={{ width: collapsed ? 60 : width }}
    >
      {!collapsed && <ResizeHandle side="right" onPointerDown={onPointerDown} active={resizing} />}
      {/* Wordmark + collapse */}
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? "justify-center" : "gap-2.5"} ${gutter}`}>
        {collapsed ? (
          <Circle label="Expand sidebar" onClick={toggleCollapsed}>
            <SidebarGlyph className="size-[18px]" />
          </Circle>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2.5 pl-3 text-[14px] font-medium text-text-strong">
              <UserButton appearance={{ elements: { avatarBox: { width: 22, height: 22 } } }} />
              <span className="truncate">Lexyos</span>
            </span>
            <Circle label="Collapse sidebar" onClick={toggleCollapsed}>
              <SidebarGlyph className="size-[18px]" />
            </Circle>
          </>
        )}
      </div>

      {/* Search: a recessed capsule, the same height as a row */}
      <div className={`shrink-0 pb-1 ${gutter}`}>
        {collapsed ? (
          <Circle label="Search or ask AI" onClick={onOpenSearch}>
            <IoSearch className="size-[18px]" />
          </Circle>
        ) : (
          <button
            onClick={onOpenSearch}
            className="flex h-9 w-full items-center gap-2.5 rounded-full bg-black/[0.05] pl-3.5 pr-2 text-left text-[13px] font-medium text-text-muted transition-colors hover:bg-black/[0.08] hover:text-text-secondary dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
          >
            <IoSearch className="size-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">Search or ask AI</span>
            <span className="flex shrink-0 items-center gap-0.5"><Kbd>&#8984;</Kbd><Kbd>/</Kbd></span>
          </button>
        )}
      </div>

      {/* Primary nav */}
      <nav className={`flex shrink-0 flex-col gap-0.5 pt-1 ${gutter}`}>
        <NavRow
          icon={IoFileTrayFull}
          label="Inbox"
          collapsed={collapsed}
          active={!inProject && !isOverdueView && (pathname === "/timeline" || pathname.startsWith("/task"))}
          onClick={() => router.push("/timeline")}
        />
        <NavRow
          icon={IoAlertCircle}
          label="Overdue"
          collapsed={collapsed}
          active={isOverdueView}
          onClick={() => router.push("/timeline?view=overdue")}
          badge={overdueCount}
          badgeTone="danger"
        />
      </nav>

      {/* Month picker: the calendar maths come from react-day-picker */}
      {!collapsed && (
        <div className="mt-4 shrink-0 px-3">
          <MiniCalendar />
        </div>
      )}

      {/* Projects */}
      <div className={`mt-5 flex min-h-0 flex-1 flex-col ${gutter}`}>
        <div className={`group/head flex h-8 shrink-0 items-center ${collapsed ? "justify-center" : "gap-1 pl-3.5 pr-1"}`}>
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-secondary">Projects</span>
          )}
          {!collapsed && (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    aria-label="Sort projects"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-text-faint opacity-0 transition-[opacity,background-color,color] hover:bg-black/[0.05] hover:text-text-strong focus-visible:opacity-100 group-hover/head:opacity-100 data-popup-open:opacity-100 dark:hover:bg-white/[0.06]"
                  />
                }
              >
                <IoSwapVertical className="size-4" />
              </MenuTrigger>
              <MenuPopup align="start" className="w-[190px]">
                <MenuRadioGroup value={projectSort} onValueChange={(v) => setProjectSort(v as Settings["ui"]["projectSort"])}>
                  <MenuGroupLabel>Sort projects</MenuGroupLabel>
                  {PROJECT_SORTS.map((o) => <MenuRadioItem key={o.value} value={o.value}>{o.label}</MenuRadioItem>)}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setNewProjectOpen(true)}
                  aria-label="New project"
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-text-faint transition-[opacity,background-color,color] hover:bg-black/[0.05] hover:text-text-strong dark:hover:bg-white/[0.06] ${collapsed ? "" : "opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"}`}
                />
              }
            >
              <IoAdd className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="right">New project</TooltipPopup>
          </Tooltip>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {projects.map((p) => (
            <ProjectRow
              key={p._id}
              project={p}
              collapsed={collapsed}
              active={pathname === `/project/${p._id}`}
              onOpen={() => router.push(`/project/${p._id}`)}
              onRequestDelete={() => setToDelete(p)}
            />
          ))}
          {!collapsed && projects.length === 0 && (
            <button onClick={() => setNewProjectOpen(true)} className={`${ROW} ${ROW_IDLE} gap-2.5 px-3.5 text-text-faint`}>
              <IoAdd className="size-[18px]" />
              New project
            </button>
          )}

          {archived.length > 0 && !collapsed && (
            <div className="mt-3">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="flex h-8 w-full items-center gap-1.5 pl-3.5 pr-2 text-[12px] font-semibold text-text-faint hover:text-text-secondary"
              >
                <span className="flex-1 text-left">Archived</span>
                <span className="tabular-nums">{archived.length}</span>
                {showArchived ? <IoChevronUp className="size-3.5" /> : <IoChevronDown className="size-3.5" />}
              </button>
              {showArchived && archived.map((p) => (
                <ProjectRow
                  key={p._id}
                  project={p}
                  collapsed={false}
                  active={pathname === `/project/${p._id}`}
                  onOpen={() => router.push(`/project/${p._id}`)}
                  onRequestDelete={() => setToDelete(p)}
                  muted
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer: plain soft circles */}
      <div className={`flex shrink-0 items-center gap-1 py-2.5 ${collapsed ? "flex-col px-2.5" : "px-3"}`}>
        <SyncButton onOpenGoogle={onOpenGoogle} />
        <ThemeToggleButton />
        <Circle label="Help" onClick={onOpenHelp}>
          <IoHelpCircle className="size-[18px]" />
        </Circle>
        <Circle label="Settings" onClick={onOpenSettings}>
          <IoSettings className="size-[18px]" />
        </Circle>
        {collapsed && (
          <div className="mt-1 flex size-9 items-center justify-center">
            <UserButton appearance={{ elements: { avatarBox: { width: 24, height: 24 } } }} />
          </div>
        )}
      </div>

      <CreateProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <DeleteProjectDialog
        project={toDelete}
        open={!!toDelete}
        onOpenChange={(o) => { if (!o) setToDelete(null); }}
        afterDelete={() => { if (toDelete && pathname === `/project/${toDelete._id}`) router.push("/timeline"); }}
      />
    </aside>
  );
}

/* ─── Rows ─── */

function NavRow({ icon: Icon, label, active, collapsed, onClick, badge, badgeTone }: {
  icon: IconType; label: string; active: boolean; collapsed: boolean; onClick: () => void;
  badge?: number; badgeTone?: "danger";
}) {
  const showBadge = !!badge && badge > 0;
  const button = (
    <button onClick={onClick} aria-current={active ? "page" : undefined} className={`relative ${ROW} ${active ? ROW_ACTIVE : ROW_IDLE} ${collapsed ? "justify-center" : "gap-2.5 pl-3.5 pr-2"}`}>
      <Icon className={`size-[18px] shrink-0 ${badgeTone === "danger" && showBadge ? "text-[#ef4444]" : ""}`} />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!collapsed && showBadge && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${badgeTone === "danger" ? "bg-[#ef4444]/10 text-[#ef4444]" : "bg-black/[0.06] text-text-secondary"}`}>{badge}</span>
      )}
      {collapsed && showBadge && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#ef4444]" />}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ProjectRow({ project, active, collapsed, onOpen, onRequestDelete, muted }: {
  project: Doc<"projects">; active: boolean; collapsed: boolean;
  onOpen: () => void; onRequestDelete: () => void; muted?: boolean;
}) {
  const update = useMutation(api.projects.update);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renaming) requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }, [renaming]);

  const commitRename = () => {
    const n = draft.trim();
    setRenaming(false);
    if (n && n !== project.name) update({ id: project._id, name: n });
    else setDraft(project.name);
  };

  const dot = <Folder open={active} className="size-[18px]" style={{ color: project.color, opacity: muted ? 0.5 : 1 }} />;

  if (collapsed) {
    return (
      <ContextMenu>
        <ContextMenuTrigger>
          <Tooltip>
            <TooltipTrigger render={<button onClick={onOpen} className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE} justify-center`} />}>
              {dot}
            </TooltipTrigger>
            <TooltipPopup side="right">{project.name}</TooltipPopup>
          </Tooltip>
        </ContextMenuTrigger>
        <ContextMenuPopup className="w-[200px]">
          <ProjectMenuItems project={project} showOpen onRequestDelete={onRequestDelete} />
        </ContextMenuPopup>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className={`group/row relative ${ROW} ${active ? ROW_ACTIVE : ROW_IDLE} ${muted ? "text-text-faint" : ""}`}>
          {renaming ? (
            <div className="flex h-full w-full items-center gap-2.5 pl-3.5 pr-2">
              {dot}
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") { setDraft(project.name); setRenaming(false); }
                }}
                className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-text-strong outline-none"
              />
            </div>
          ) : (
            <>
              <button onClick={onOpen} onDoubleClick={() => setRenaming(true)} className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-3.5 pr-9 text-left">
                {dot}
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </button>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      aria-label={`${project.name} options`}
                      className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-text-faint opacity-0 transition-[opacity,background-color,color] hover:bg-black/[0.06] hover:text-text-strong focus-visible:opacity-100 group-hover/row:opacity-100 data-popup-open:opacity-100 dark:hover:bg-white/[0.08]"
                    />
                  }
                >
                  <IoEllipsisHorizontal className="size-4" />
                </MenuTrigger>
                <MenuPopup align="start" className="w-[200px]">
                  <ProjectMenuItems project={project} onRename={() => setRenaming(true)} onRequestDelete={onRequestDelete} />
                </MenuPopup>
              </Menu>
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuPopup className="w-[200px]">
        <ProjectMenuItems project={project} showOpen onRename={() => setRenaming(true)} onRequestDelete={onRequestDelete} />
      </ContextMenuPopup>
    </ContextMenu>
  );
}

/* ─── Controls ─── */

function Circle({ label, onClick, disabled, children }: {
  label: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button onClick={onClick} disabled={disabled} aria-label={label} className={CIRCLE} />}>
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Circle label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme}>
      {theme === "dark" ? <IoSunny className="size-[18px]" /> : <IoMoon className="size-[18px]" />}
    </Circle>
  );
}

function SyncButton({ onOpenGoogle }: { onOpenGoogle: () => void }) {
  const google = useGoogleConnection();
  const googleReady = google?.connected === true && !google.needsReconnect;
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const bulkUpsert = useMutation(api.tasks.bulkUpsertFromGoogle);
  const removeDeleted = useMutation(api.tasks.removeDeletedGoogleEvents);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { runCalendarSync } = await import("@/lib/calendar-sync-client");
      const now = new Date();
      const result = await runCalendarSync(
        { from: new Date(now.getTime() - 30 * 86400000), to: new Date(now.getTime() + 60 * 86400000) },
        { bulkUpsert, removeDeleted },
      );
      if (!result.complete) console.warn("Calendar sync incomplete; calendars failed:", result.failedCalendarIds);
      try { await fetch("/api/sync/push-all", { method: "POST" }); } catch (err) { console.warn("Push-all failed:", err); }
      setLastSync(new Date());
    } catch (err) {
      console.error("Manual sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [syncing, bulkUpsert, removeDeleted]);

  if (google !== undefined && !googleReady) {
    return (
      <Circle label={google.connected ? "Google Calendar needs reconnecting" : "Connect Google Calendar"} onClick={onOpenGoogle}>
        <IoCloudOffline className="size-[18px]" />
      </Circle>
    );
  }
  const label = lastSync
    ? `Last synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, click to sync`
    : syncing ? "Syncing" : `Sync Google Calendar${google?.connected && google.email ? ` (${google.email})` : ""}`;
  return (
    <Circle label={label} onClick={handleSync} disabled={syncing}>
      <IoSync className={`size-[18px] ${syncing ? "animate-spin" : ""}`} />
    </Circle>
  );
}
