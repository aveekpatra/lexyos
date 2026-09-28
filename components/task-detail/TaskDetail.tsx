"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { RecurrencePopover } from "@/components/tasks/RecurrencePopover";
import { normalizeRecurrence, describeRecurrence, shortRecurrenceLabel } from "@/convex/lib/recurrence";
import {
  DatePickerPopover,
  TimePickerPopover,
  DurationPickerPopover,
  ProjectPickerPopover,
  computeDuration,
  formatDuration,
} from "@/components/tasks/TaskPropertyPopovers";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { RailHeading, PropertyRow, Dot, RadialProgress } from "@/components/ui/property-rail";
import {
  softPill as pill,
  emptyPill as pillEmpty,
  glassIconButton,
  glassAction,
  bluePill,
} from "@/lib/ui/chrome";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { syncTaskUpdateToGoogle, syncTaskDeletionToGoogle, syncCompletionResultToGoogle } from "@/lib/google-sync";
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_OPTIONS } from "@/lib/constants";
import { useSettings, formatClock } from "@/lib/settings";
import { startFocus } from "@/lib/focus-store";
import {
  IoAdd,
  IoArrowBack,
  IoBan,
  IoCalendar,
  IoCheckmarkCircle,
  IoEllipsisHorizontal,
  IoOpen,
  IoRepeat,
  IoTrash,
  IoTimer,
} from "react-icons/io5";
import { ProjectGlyph } from "@/components/ui/project-glyph";
import { isMissed, useMarkMissed, MissedMark } from "@/components/tasks/outcome";

/*
 * Task page, Linear issue layout on the Liquid Glass two-layer model:
 * - Content layer: title, description document, sub-issues. Flat, scrolls.
 * - Floating layer: a glass header (back, breadcrumb, complete, menu) over a
 *   smoothstep scrim so content dissolves under it instead of clipping.
 * - Properties rail: one label + one value pill per row, identical geometry
 *   whether the field is filled (soft pill) or empty (dashed pill).
 *
 * The description is a real document. It holds the context an agent needs to
 * pick the task up later, and it is stored as Markdown so the AI reads exactly
 * what is written here.
 */

const DESCRIPTION_PLACEHOLDER =
  "What is this about, why it matters, links, decisions, what done looks like. Type '#' for a heading, '-' for a list, '[ ]' for a checklist.";

export default function TaskDetail({ taskId }: { taskId: Id<"tasks"> }) {
  const router = useRouter();
  const task = useQuery(api.tasks.getById, { id: taskId });
  const projects = useQuery(api.projects.list, { status: "active" });
  const subtasks = useQuery(api.tasks.getSubtasks, { parentTaskId: taskId });

  const updateTask = useMutation(api.tasks.update);
  const createTask = useMutation(api.tasks.create);
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const removeTask = useMutation(api.tasks.remove);
  const markMissed = useMarkMissed();
  const reviseMissed = useMutation(api.tasks.markMissed);

  const [newSubtask, setNewSubtask] = useState("");
  const [numberCopied, setNumberCopied] = useState(false);
  const { settings } = useSettings();
  // Title draft keyed by task id, so switching tasks falls back to the query value.
  const [titleDraft, setTitleDraft] = useState<{ id: string; title: string } | null>(null);
  const title = titleDraft && task && titleDraft.id === task._id ? titleDraft.title : task?.title ?? "";

  // Update Convex, then push the same change through to Google Calendar.
  const syncUpdate = useCallback(
    async (args: Record<string, unknown>) => {
      if (!task) return;
      await updateTask(args as Parameters<typeof updateTask>[0]);
      try {
        const result = await syncTaskUpdateToGoogle(task, args);
        if (result) {
          await updateTask({ id: task._id, googleEventId: result.googleEventId, googleCalendarId: result.googleCalendarId });
        }
      } catch (err) {
        console.warn("Google sync failed:", err);
      }
    },
    [task, updateTask],
  );

  const commitTitle = useCallback(() => {
    const next = title.trim();
    if (!task || !next || next === task.title) return;
    syncUpdate({ id: task._id, title: next });
  }, [task, title, syncUpdate]);

  const commitDescription = useCallback(
    (md: string) => {
      if (!task || md === (task.description ?? "")) return;
      syncUpdate(md ? { id: task._id, description: md } : { id: task._id, clearDescription: true });
    },
    [task, syncUpdate],
  );

  const handleToggleComplete = useCallback(async () => {
    if (!task) return;
    const wasDone = task.status === "done";
    const result = await toggleComplete({ id: task._id, userDate: format(new Date(), "yyyy-MM-dd") });
    try { await syncCompletionResultToGoogle(task, result, wasDone); } catch (err) { console.warn("Google sync failed:", err); }
  }, [task, toggleComplete]);

  const handleDelete = useCallback(async () => {
    if (!task) return;
    try { await syncTaskDeletionToGoogle(task); } catch (err) { console.warn("Google delete sync failed:", err); }
    await removeTask({ id: task._id });
    router.push(task.projectId ? `/project/${task.projectId}` : "/timeline");
  }, [task, removeTask, router]);

  const handleAddSubtask = useCallback(async () => {
    const t = newSubtask.trim();
    if (!t) return;
    setNewSubtask("");
    await createTask({
      title: t,
      parentTaskId: taskId,
      projectId: task?.projectId,
      dueDate: task?.dueDate,
      userDate: format(new Date(), "yyyy-MM-dd"),
    });
  }, [newSubtask, createTask, taskId, task?.dueDate, task?.projectId]);

  const project = useMemo(() => projects?.find((p) => p._id === task?.projectId) ?? null, [projects, task?.projectId]);
  const status = STATUS_OPTIONS.find((s) => s.value === task?.status) ?? STATUS_OPTIONS[0];
  const priority = task?.priority ?? "p3";
  const anchorDate = task?.dueDate || task?.scheduledDate || format(new Date(), "yyyy-MM-dd");
  const recurrence = normalizeRecurrence(task?.recurrence, anchorDate);
  const durationMin = computeDuration(task?.scheduledStartTime, task?.scheduledEndTime);
  const isDone = task?.status === "done";
  const missed = !!task && isMissed(task);
  const startTime = task?.scheduledStartTime || task?.dueTime;
  const doneSubs = subtasks?.filter((s) => s.status === "done").length ?? 0;

  if (task === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-8 pt-24">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-1/3 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (task === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-faint">
        <p className="text-[15px]">Task not found</p>
        <button onClick={() => router.push("/timeline")} className={glassAction}>Back to Inbox</button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Floating header: glass controls over a smoothstep scrim */}
      <div aria-hidden className="task-header-scrim pointer-events-none absolute inset-x-0 top-0 z-10 h-24" />
      <header className="absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-2 px-4">
        <button
          onClick={() => router.push(project ? `/project/${project._id}` : "/timeline")}
          aria-label="Back"
          className={glassIconButton}
        >
          <IoArrowBack className="size-3.5" />
        </button>

        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
          <button onClick={() => router.push("/timeline")} className="shrink-0 rounded-full px-2 py-1 font-medium text-text-muted transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]">
            Inbox
          </button>
          {project && (
            <>
              <span className="text-text-faint">/</span>
              <button
                onClick={() => router.push(`/project/${project._id}`)}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 font-medium text-text-muted transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
              >
                <ProjectGlyph icon={project.icon} className="size-3.5" style={{ color: project.color }} />
                <span className="truncate">{project.name}</span>
              </button>
            </>
          )}
          <span className="text-text-faint">/</span>
          <span className="shrink-0 px-2 font-medium text-text-faint">{missed ? "Missed" : isDone ? "Done" : status.label}</span>
          {/* Stable task number: click to copy it for a message or an agent */}
          {task.number !== undefined && (
            <button
              onClick={() => {
                void navigator.clipboard.writeText(`#${task.number}`);
                setNumberCopied(true);
                setTimeout(() => setNumberCopied(false), 1200);
              }}
              title="Copy task number"
              className="shrink-0 rounded-full px-2 py-1 font-medium tabular-nums text-text-faint transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
            >
              {numberCopied ? "Copied" : `#${task.number}`}
            </button>
          )}
        </nav>

        {!isDone && (
          <button
            onClick={() => startFocus({ taskId: task._id, taskTitle: task.title, lengths: { focus: settings.pomodoro.workMin, short: settings.pomodoro.shortBreakMin, long: settings.pomodoro.longBreakMin, rounds: settings.pomodoro.roundsBeforeLongBreak } })}
            className={glassAction}
          >
            <IoTimer className="size-3.5" />
            Focus
          </button>
        )}
        {missed ? (
          <button onClick={handleToggleComplete} title="Reopen" className={glassAction}>
            <MissedMark size={14} />
            Missed
          </button>
        ) : (
          <button onClick={handleToggleComplete} className={isDone ? bluePill : glassAction}>
            <IoCheckmarkCircle className="size-3.5" />
            {isDone ? "Done" : recurrence ? "Complete occurrence" : "Mark done"}
          </button>
        )}

        <Menu>
          <MenuTrigger render={<button aria-label="Task options" className={glassIconButton} />}>
            <IoEllipsisHorizontal className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            {task.htmlLink && (
              <MenuItem onClick={() => window.open(task.htmlLink!, "_blank", "noopener")}>
                <IoOpen className="size-4" />
                Open in Google Calendar
              </MenuItem>
            )}
            <MenuItem onClick={() => navigator.clipboard.writeText(window.location.href)}>
              Copy link
            </MenuItem>
            {!isDone && (
              <MenuItem onClick={() => void markMissed(task)}>
                <IoBan className="size-4" />
                {recurrence ? "Mark this one missed" : "Mark missed"}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem onClick={handleDelete} className="text-[#ef4444]">
              <IoTrash className="size-4" />
              Delete task
            </MenuItem>
          </MenuPopup>
        </Menu>
      </header>

      {/* Content layer */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-8 pb-28 pt-20 lg:grid-cols-[minmax(0,1fr)_296px] lg:gap-14">
          {/* Document */}
          <main className="flex min-w-0 flex-col">
            <AutoTextarea
              value={title}
              onChange={(v) => setTitleDraft({ id: task._id, title: v })}
              onCommit={commitTitle}
              placeholder="Task title"
              className={`text-[26px] font-semibold leading-[1.3] tracking-[-0.015em] ${missed ? "text-text-muted" : isDone ? "text-text-muted line-through decoration-text-faint" : "text-text-strong"}`}
            />

            {/* Missed: why it did not happen, kept as context for later */}
            {missed && (
              <div className="mt-3 flex h-9 items-center gap-2.5 rounded-full bg-black/[0.04] px-3 text-[13px] dark:bg-white/[0.06]">
                <MissedMark size={14} />
                <span className="shrink-0 font-medium text-text-secondary">Missed</span>
                <input
                  key={`${task._id}:${task.missedReason ?? ""}`}
                  defaultValue={task.missedReason ?? ""}
                  onBlur={(e) => {
                    const reason = e.currentTarget.value.trim();
                    if (reason !== (task.missedReason ?? "")) void reviseMissed({ id: task._id, reason });
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  placeholder="Why? (optional)"
                  className="min-w-0 flex-1 bg-transparent text-text-secondary outline-none placeholder:text-text-faint"
                />
              </div>
            )}

            <div className="mt-5 px-2">
              <MarkdownEditor
                docKey={task._id}
                value={task.description ?? ""}
                onCommit={commitDescription}
                placeholder={DESCRIPTION_PLACEHOLDER}
              />
            </div>

            {/* Sub-issues */}
            <section className="mt-10 rounded-[16px] bg-black/[0.03] p-2 dark:bg-white/[0.05]">
              <div className="mb-1 flex items-center justify-between px-3 py-1">
                <h2 className="text-[13px] font-semibold text-text-strong">Sub-issues</h2>
                {subtasks && subtasks.length > 0 && (
                  <span className="flex items-center gap-2 text-[12px] tabular-nums text-text-muted">
                    {doneSubs} of {subtasks.length} done
                    <RadialProgress value={doneSubs} total={subtasks.length} size={22} stroke={3} label="" />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {(settings.general.moveDoneToBottom ? [...(subtasks ?? [])].sort((a, b) => Number(a.status === "done") - Number(b.status === "done")) : subtasks ?? []).map((s) => <SubtaskRow key={s._id} task={s} />)}
                <div className="flex h-9 items-center gap-3 rounded-full px-3 text-[13px] transition-colors focus-within:bg-hover">
                  <IoAdd className="size-4 shrink-0 text-text-faint" />
                  <input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddSubtask(); }
                    }}
                    placeholder="Add sub-issue"
                    className="min-w-0 flex-1 bg-transparent text-text-secondary outline-none placeholder:text-text-faint"
                  />
                </div>
              </div>
            </section>
          </main>

          {/* Properties rail */}
          <aside className="flex flex-col gap-3 lg:pt-2 [&>section:not(.meta)]:rounded-[16px] [&>section:not(.meta)]:bg-black/[0.03] [&>section:not(.meta)]:p-2 dark:[&>section:not(.meta)]:bg-white/[0.05]">
            <section>
              <RailHeading>Properties</RailHeading>
              <div className="flex flex-col gap-1">
                <PropertyRow label="Status">
                  <Menu>
                    <MenuTrigger render={<button className={pill} />}>
                      <Dot color={status.color} />
                      {status.label}
                    </MenuTrigger>
                    <MenuPopup align="start">
                      {STATUS_OPTIONS.map((s) => (
                        <MenuItem key={s.value} onClick={() => syncUpdate({ id: task._id, status: s.value })}>
                          <Dot color={s.color} />
                          {s.label}
                          {task.status === s.value && <Tick />}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                </PropertyRow>

                <PropertyRow label="Priority">
                  <Menu>
                    <MenuTrigger render={<button className={pill} />}>
                      <Dot color={PRIORITY_COLORS[priority]} />
                      {PRIORITY_LABELS[priority]}
                    </MenuTrigger>
                    <MenuPopup align="start">
                      {(["p1", "p2", "p3", "p4"] as const).map((p) => (
                        <MenuItem key={p} onClick={() => syncUpdate({ id: task._id, priority: p })}>
                          <Dot color={PRIORITY_COLORS[p]} />
                          {PRIORITY_LABELS[p]}
                          {priority === p && <Tick />}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                </PropertyRow>

                <PropertyRow label="Project">
                  <ProjectPickerPopover
                    value={task.projectId}
                    onChange={(id) => syncUpdate(id ? { id: task._id, projectId: id } : { id: task._id, clearProjectId: true })}
                  >
                    <button className={project ? pill : pillEmpty}>
                      {project && <Dot color={project.color} />}
                      <span className="max-w-[160px] truncate">{project?.name ?? "No project"}</span>
                    </button>
                  </ProjectPickerPopover>
                </PropertyRow>
              </div>
            </section>

            <section>
              <RailHeading>Schedule</RailHeading>
              <div className="flex flex-col gap-1">
                <PropertyRow label="Date">
                  <DatePickerPopover
                    value={task.dueDate || undefined}
                    onChange={(d) =>
                      syncUpdate(d ? { id: task._id, dueDate: d } : { id: task._id, clearDueDate: true, userDate: format(new Date(), "yyyy-MM-dd") })
                    }
                  >
                    <button className={task.dueDate ? pill : pillEmpty}>
                      {task.dueDate ? format(parseISO(task.dueDate), "EEE, MMM d") : "No date"}
                    </button>
                  </DatePickerPopover>
                </PropertyRow>

                <PropertyRow label="Time">
                  <TimePickerPopover
                    value={startTime || undefined}
                    onChange={(t) => syncUpdate(t ? { id: task._id, dueTime: t } : { id: task._id, clearDueTime: true, clearScheduledStartTime: true, clearScheduledEndTime: true })}
                  >
                    <button className={startTime ? pill : pillEmpty}>
                      {startTime ? formatClock(startTime, settings.calendar.timeFormat) : "All day"}
                    </button>
                  </TimePickerPopover>
                </PropertyRow>

                <PropertyRow label="Duration">
                  <DurationPickerPopover
                    value={durationMin}
                    onChange={(minutes) => {
                      if (!minutes) { syncUpdate({ id: task._id, clearScheduledEndTime: true }); return; }
                      const start = startTime || "09:00";
                      const [h, m] = start.split(":").map(Number);
                      const endMin = Math.min(23 * 60 + 59, h * 60 + m + minutes);
                      const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
                      syncUpdate({ id: task._id, dueTime: start, scheduledStartTime: start, scheduledEndTime: end });
                    }}
                  >
                    <button className={durationMin ? pill : pillEmpty}>
                      {durationMin ? formatDuration(durationMin) : "No duration"}
                    </button>
                  </DurationPickerPopover>
                </PropertyRow>

                <PropertyRow label="Repeat">
                  <RecurrencePopover
                    value={recurrence}
                    anchorDate={anchorDate}
                    onChange={(rec) => syncUpdate(rec ? { id: task._id, recurrence: rec } : { id: task._id, clearRecurrence: true })}
                  >
                    <button className={recurrence ? pill : pillEmpty} title={recurrence ? describeRecurrence(recurrence, anchorDate) : undefined}>
                      {recurrence && <IoRepeat className="size-3.5" />}
                      {recurrence ? shortRecurrenceLabel(recurrence) : "Does not repeat"}
                    </button>
                  </RecurrencePopover>
                </PropertyRow>
              </div>
            </section>

            <section>
              <RailHeading>Calendar</RailHeading>
              {task.googleEventId ? (
                <a
                  href={task.htmlLink ?? "#"}
                  target="_blank"
                  rel="noopener"
                  className={`${pill} w-fit ${task.htmlLink ? "" : "pointer-events-none"}`}
                >
                  <IoCalendar className="size-3.5" />
                  On Google Calendar
                  {task.htmlLink && <IoOpen className="size-3 text-text-faint" />}
                </a>
              ) : (
                <p className="px-3 text-[12px] text-text-faint">
                  {task.dueDate ? "Will appear on Google Calendar after the next sync." : "Set a date to put this on the calendar."}
                </p>
              )}
            </section>

            <section className="meta flex flex-col gap-1 px-3 pt-2 text-[12px] text-text-faint">
              <span title={format(new Date(task._creationTime), "PPpp")}>
                Created {formatDistanceToNow(task._creationTime, { addSuffix: true })}
              </span>
              {task.completedAt && (
                <span title={format(new Date(task.completedAt), "PPpp")}>
                  {missed ? "Missed" : "Completed"} {formatDistanceToNow(task.completedAt, { addSuffix: true })}
                </span>
              )}
              {task.lastSyncedAt && (
                <span title={format(new Date(task.lastSyncedAt), "PPpp")}>
                  Synced {formatDistanceToNow(task.lastSyncedAt, { addSuffix: true })}
                </span>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Tick() {
  return <IoCheckmarkCircle className="ml-auto size-3.5" />;
}

/* ─── Sub-issue row: capsule, same 36px as rail rows ─── */
function SubtaskRow({ task }: { task: Doc<"tasks"> }) {
  const router = useRouter();
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const isDone = task.status === "done";
  const color = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.p4;

  return (
    <div className="group flex h-9 items-center gap-3 rounded-full px-3 transition-colors hover:bg-hover">
      <button
        onClick={async () => {
          const wasDone = task.status === "done";
          const result = await toggleComplete({ id: task._id, userDate: format(new Date(), "yyyy-MM-dd") });
          try { await syncCompletionResultToGoogle(task, result, wasDone); } catch (err) { console.warn("Google sync failed:", err); }
        }}
        aria-label={isDone ? "Mark as not done" : "Mark as done"}
        className="flex size-4 shrink-0 items-center justify-center rounded-full transition-colors"
        style={{ border: `1.5px solid ${isDone ? "var(--brand)" : color}`, backgroundColor: isDone ? "var(--brand)" : "transparent" }}
      >
        {isDone && <IoCheckmarkCircle className="size-2.5 text-white" />}
      </button>
      <button
        onClick={() => router.push(`/task/${task._id}`)}
        className={`min-w-0 flex-1 truncate text-left text-[13px] transition-colors ${
          isDone ? "text-text-faint line-through" : "text-text-secondary group-hover:text-foreground"
        }`}
      >
        {task.title}
      </button>
      {task.dueDate && (
        <span className="shrink-0 text-[12px] text-text-faint">{format(parseISO(task.dueDate), "MMM d")}</span>
      )}
    </div>
  );
}
