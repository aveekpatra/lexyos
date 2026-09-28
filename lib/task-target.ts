import type { Doc } from "@/convex/_generated/dataModel";

/**
 * The task a single-key shortcut acts on: the card under the pointer, or
 * failing that the task whose page is open. Module state, like drag-store,
 * so a card can claim it on hover without re-rendering anything.
 */
let hovered: Doc<"tasks"> | null = null;
let open: Doc<"tasks"> | null = null;

export function setHoveredTask(task: Doc<"tasks"> | null): void {
  hovered = task;
}

/** Clear the hover claim, but only if this task still holds it. */
export function releaseHoveredTask(id: string): void {
  if (hovered?._id === id) hovered = null;
}

/** Keep a held claim current when the task changes under the pointer. */
export function refreshHoveredTask(task: Doc<"tasks">): void {
  if (hovered?._id === task._id) hovered = task;
}

export function setOpenTask(task: Doc<"tasks"> | null): void {
  open = task;
}

export function targetTask(): Doc<"tasks"> | null {
  return hovered ?? open;
}
