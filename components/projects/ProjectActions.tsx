"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import {
  Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { softPill } from "@/lib/ui/chrome";
import {
  IoArchive,
  IoCopy,
  IoCreate,
  IoOpen,
  IoPencil,
  IoTrash,
} from "react-icons/io5";

/**
 * The one set of project actions, rendered inside any Menu or ContextMenu:
 * sidebar row menu, sidebar right-click, project header menu. Delete asks first.
 */
export function ProjectMenuItems({
  project,
  onRename,
  onRequestEdit,
  onRequestDelete,
  showOpen = false,
}: {
  project: Doc<"projects">;
  onRename?: () => void;
  /** Opens the same dialog that created the project, with its values in it. */
  onRequestEdit?: () => void;
  onRequestDelete: () => void;
  showOpen?: boolean;
}) {
  const router = useRouter();
  const update = useMutation(api.projects.update);
  const duplicate = useMutation(api.projects.duplicate);
  const archived = project.status === "archived";

  return (
    <>
      {showOpen && (
        <MenuItem onClick={() => router.push(`/project/${project._id}`)}>
          <IoOpen />
          Open
        </MenuItem>
      )}
      {onRename && (
        <MenuItem onClick={onRename}>
          <IoCreate />
          Rename
        </MenuItem>
      )}
      {onRequestEdit && (
        <MenuItem onClick={onRequestEdit}>
          <IoPencil />
          Edit project
        </MenuItem>
      )}
      <MenuItem onClick={() => duplicate({ id: project._id })}>
        <IoCopy />
        Duplicate
      </MenuItem>
      <MenuItem onClick={() => update({ id: project._id, status: archived ? "active" : "archived" })}>
        <IoArchive />
        {archived ? "Restore" : "Archive"}
      </MenuItem>
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={onRequestDelete}>
        <IoTrash />
        Delete
      </MenuItem>
    </>
  );
}

/** Confirmation before a project is removed. Tasks survive and lose the project. */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  afterDelete,
}: {
  project: Doc<"projects"> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  afterDelete?: () => void;
}) {
  const remove = useMutation(api.projects.remove);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!project) return;
    setBusy(true);
    try {
      await remove({ id: project._id });
      onOpenChange(false);
      afterDelete?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-[17px]">Delete {project?.name ?? "project"}?</DialogTitle>
          <DialogDescription>
            Its tasks are kept and moved to Inbox with no project. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className={softPill}>Cancel</button>
          <button
            onClick={confirm}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#ef4444] px-3.5 text-xs font-medium text-white shadow-[0_1px_3px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.2)] transition-colors hover:bg-[#dc2626] active:translate-y-px disabled:opacity-50"
          >
            <IoTrash className="size-3.5" />
            {busy ? "Deleting" : "Delete project"}
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
