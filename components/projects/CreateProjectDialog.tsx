"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Folder } from "@/components/ui/folder";
import { glassIconButton, softPill, bluePill } from "@/lib/ui/chrome";
import { IoClose, IoFolder, IoCheckmark } from "react-icons/io5";

export const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#71717a",
];

/*
 * One question, one screen (Aturno's case creation): a hero glyph that takes
 * the colour you pick, a name, an optional one-liner, and a live preview of
 * the sidebar row so the choice means something before you commit.
 */
export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createProject = useMutation(api.projects.create);
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[6]);
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setDescription(""); setColor(PROJECT_COLORS[6]); };

  async function handleCreate() {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      const id = await createProject({ name: n, color, description: description.trim() || undefined });
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
            {/* Hero: the glyph previews the colour */}
            <div className="mb-6 flex flex-col items-center text-center">
              <div
                className="mb-4 flex size-14 items-center justify-center rounded-full transition-colors duration-200"
                style={{ backgroundColor: `${color}1f`, color }}
              >
                <IoFolder className="size-7" aria-hidden />
              </div>
              <DialogTitle className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-text-strong">New project</DialogTitle>
              <p className="mt-1 max-w-[300px] text-[13px] leading-relaxed text-text-muted">
                A place for one thing. Its tasks still show in Inbox, tagged with the folder.
              </p>
            </div>

            <div className="space-y-4">
              <Field label="Name">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
                  placeholder="University admission"
                  className="h-10 w-full rounded-full border border-transparent bg-black/[0.04] px-4 text-[14px] text-text-strong outline-none transition-colors placeholder:text-text-faint focus:border-brand-border dark:bg-white/[0.06]"
                />
              </Field>
              <Field label="What is it for" optional>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="One line so the agent and future you know the point of it"
                  className="w-full resize-none rounded-[16px] border border-transparent bg-black/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-text-strong outline-none transition-colors placeholder:text-text-faint focus:border-brand-border dark:bg-white/[0.06]"
                />
              </Field>
              <Field label="Colour">
                <div className="flex flex-wrap gap-2">
                  {PROJECT_COLORS.map((c) => {
                    const on = color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        aria-label={`Colour ${c}`}
                        aria-pressed={on}
                        className="flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
                        style={{ backgroundColor: c, boxShadow: on ? `0 0 0 2px var(--surface-0), 0 0 0 4px ${c}` : undefined }}
                      >
                        {on && <IoCheckmark className="size-4 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Live preview of the sidebar row */}
              <div>
                <span className="mb-1.5 flex items-baseline gap-1.5 px-1 text-[12px] font-medium text-text-secondary">
                  Preview
                  <span className="text-text-faint">how it will look in the sidebar</span>
                </span>
                <div className="flex h-9 items-center gap-2.5 rounded-full bg-black/[0.05] px-3.5 text-[14px] font-medium text-text-strong dark:bg-white/[0.08]">
                  <Folder open className="size-[18px]" style={{ color }} />
                  <span className={`min-w-0 flex-1 truncate ${name.trim() ? "" : "text-text-faint"}`}>{name.trim() || "Project name"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 pb-5">
            <button onClick={() => onOpenChange(false)} className={softPill}>Cancel</button>
            <button onClick={handleCreate} disabled={!name.trim() || saving} className={`${bluePill} disabled:opacity-40`}>
              <IoFolder className="size-3.5" />
              {saving ? "Creating" : "Create project"}
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
