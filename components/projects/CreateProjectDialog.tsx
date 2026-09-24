"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ProjectGlyph } from "@/components/ui/project-glyph";
import { glassIconButton, softPill, bluePill } from "@/lib/ui/chrome";
import { ProjectIconGrid } from "@/components/projects/ProjectIconGrid";
import { DEFAULT_PROJECT_ICON } from "@/lib/ui/project-icons";
import { IoClose, IoFolder, IoCheckmarkCircle, IoChevronDown } from "react-icons/io5";

export const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#71717a",
];

/*
 * One question, one screen (Aturno's case creation). The name is typed into
 * the sidebar row itself: the row's glyph opens one picker for its colour and
 * icon (chosen together, since the icon is tinted with the colour), so what
 * you edit is exactly what the sidebar will show.
 *
 * Editing an existing project is the same screen with its values in it. One
 * component rather than two, so the two cannot drift apart.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  project = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Present to edit that project in place; absent to create a new one. */
  project?: Doc<"projects"> | null;
}) {
  const createProject = useMutation(api.projects.create);
  const updateProject = useMutation(api.projects.update);
  const router = useRouter();
  const editing = !!project;

  // Re-seed whenever a different project is opened, using React's
  // adjust-state-during-render pattern rather than an effect.
  const seed = () => ({
    name: project?.name ?? "",
    description: project?.description ?? "",
    color: project?.color ?? PROJECT_COLORS[6],
    icon: project?.icon ?? DEFAULT_PROJECT_ICON,
  });
  const [draft, setDraft] = useState(seed);
  const [seededFor, setSeededFor] = useState(project?._id ?? null);
  if ((project?._id ?? null) !== seededFor) {
    setSeededFor(project?._id ?? null);
    setDraft(seed());
  }
  const { name, description, color, icon } = draft;
  const setName = (v: string) => setDraft((d) => ({ ...d, name: v }));
  const setDescription = (v: string) => setDraft((d) => ({ ...d, description: v }));
  const setColor = (v: string) => setDraft((d) => ({ ...d, color: v }));
  const setIcon = (v: string) => setDraft((d) => ({ ...d, icon: v }));
  const [saving, setSaving] = useState(false);
  const [iconsOpen, setIconsOpen] = useState(false);

  const reset = () => setDraft(seed());

  async function handleCreate() {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      if (project) {
        await updateProject({
          id: project._id, name: n, color, icon,
          description: description.trim() || undefined,
        });
        onOpenChange(false);
        return;
      }
      const id = await createProject({ name: n, color, icon, description: description.trim() || undefined });
      reset();
      onOpenChange(false);
      if (id) router.push(`/project/${id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogPopup className="max-w-[440px] overflow-hidden !rounded-[24px] !p-0" showCloseButton={false}>
        <div className="flex flex-col">
          {/* Top bar: close only, iOS style */}
          <div className="flex items-center justify-end px-4 pt-4">
            <button onClick={() => onOpenChange(false)} aria-label="Close" className={glassIconButton}>
              <IoClose className="size-4" />
            </button>
          </div>

          <div className="px-6 pb-6">
            <div className="mb-5 text-center">
              <DialogTitle className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-text-strong">
                {editing ? "Edit project" : "New project"}
              </DialogTitle>
              <p className="mx-auto mt-1 max-w-[300px] text-[13px] leading-relaxed text-text-muted">
                {editing
                  ? "Its name, look and one-liner. Tasks, board and context are untouched."
                  : "A place for one thing. Its tasks still show in Inbox, tagged with the folder."}
              </p>
            </div>

            <div className="space-y-4">
              {/* The sidebar row, editable: the glyph picks the icon, the rest is the name. */}
              <div className="flex h-11 items-center gap-1 rounded-full border border-transparent bg-black/[0.04] pl-1.5 pr-4 transition-colors focus-within:border-brand-border dark:bg-white/[0.06]">
                <Popover open={iconsOpen} onOpenChange={setIconsOpen}>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Choose colour and icon"
                        className="flex h-8 shrink-0 items-center gap-1 rounded-full pl-2 pr-1.5 transition-colors hover:bg-black/[0.05] data-popup-open:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                      />
                    }
                  >
                    <ProjectGlyph icon={icon} open className="size-[20px]" style={{ color }} />
                    <IoChevronDown className="size-3 text-text-faint" aria-hidden />
                  </PopoverTrigger>
                  <PopoverPopup align="start" sideOffset={8} className="w-[340px] !p-2">
                    {/* A colour keeps the picker open; picking an icon closes it. */}
                    <div className="mb-2 flex flex-wrap gap-1.5 px-1 pt-1">
                      {PROJECT_COLORS.map((c) => {
                        const on = color === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setColor(c)}
                            aria-label={`Colour ${c}`}
                            aria-pressed={on}
                            className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
                            style={{ backgroundColor: c, boxShadow: on ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${c}` : undefined }}
                          >
                            {on && <IoCheckmarkCircle className="size-3.5 text-white" />}
                          </button>
                        );
                      })}
                    </div>
                    <ProjectIconGrid
                      value={icon}
                      color={color}
                      onSelect={(next) => { setIcon(next); setIconsOpen(false); }}
                    />
                  </PopoverPopup>
                </Popover>
                <input
                  autoFocus
                  aria-label="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
                  placeholder="Project name"
                  className="h-full min-w-0 flex-1 bg-transparent pl-1.5 text-[14px] font-medium text-text-strong outline-none placeholder:font-normal placeholder:text-text-faint"
                />
              </div>

              <Field label="What is it for" optional>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="One line so the agent and future you know the point of it"
                  className="w-full resize-none rounded-[16px] border border-transparent bg-black/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-text-strong outline-none transition-colors placeholder:text-text-faint focus:border-brand-border dark:bg-white/[0.06]"
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 pb-6">
            <button onClick={() => onOpenChange(false)} className={cn(softPill, "h-10 px-5 text-[14px]")}>Cancel</button>
            <button onClick={handleCreate} disabled={!name.trim() || saving} className={cn(bluePill, "h-10 gap-2 px-5 text-[14px] disabled:opacity-40")}>
              {editing
                ? <ProjectGlyph icon={icon} className="size-4" />
                : <IoFolder className="size-4" />}
              {saving ? (editing ? "Saving" : "Creating") : editing ? "Save changes" : "Create project"}
            </button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 px-1 text-[12px] font-medium text-text-secondary">
        {label}
        {optional && <span className="text-text-faint">optional</span>}
      </span>
      {children}
    </label>
  );
}
