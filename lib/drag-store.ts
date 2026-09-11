/**
 * Which task is currently being dragged (native HTML5 DnD).
 * `dragover` cannot read dataTransfer payloads, so drop targets that want to
 * preview the dragged task's real duration read it from here instead.
 */
let draggingTaskId: string | null = null;

export function setDraggingTaskId(id: string | null): void {
  draggingTaskId = id;
}

export function getDraggingTaskId(): string | null {
  return draggingTaskId;
}
