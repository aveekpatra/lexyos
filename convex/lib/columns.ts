/**
 * Project board columns. Every project starts from the default template;
 * the user or an agent can rename, recolour, add, remove, and reorder. A
 * task sits in `columnId` when that column still exists, otherwise in the
 * column whose status matches, otherwise in the first column.
 */
export type TaskStatus = "todo" | "planned" | "in_progress" | "review" | "done";
export type BoardColumn = { id: string; name: string; color: string; status?: TaskStatus };

export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "todo", name: "Todo", color: "#94a3b8", status: "todo" },
  { id: "planned", name: "Planned", color: "#3b82f6", status: "planned" },
  { id: "in_progress", name: "In Progress", color: "#f59e0b", status: "in_progress" },
  { id: "review", name: "Review", color: "#8b5cf6", status: "review" },
  { id: "done", name: "Done", color: "#22c55e", status: "done" },
];

export function projectColumns(project: { columns?: BoardColumn[] | null } | null | undefined): BoardColumn[] {
  return project?.columns && project.columns.length > 0 ? project.columns : DEFAULT_COLUMNS;
}

export function columnForTask(task: { columnId?: string | null; status: TaskStatus }, columns: BoardColumn[]): BoardColumn {
  if (task.status === "done") {
    const doneCol = columns.find((c) => c.status === "done");
    if (doneCol) return doneCol;
  }
  const byId = task.columnId ? columns.find((c) => c.id === task.columnId) : undefined;
  if (byId) return byId;
  return columns.find((c) => c.status === task.status) ?? columns[0];
}

/** Status a task should take when dropped into a column. */
export function statusForColumn(col: BoardColumn, current: TaskStatus): TaskStatus {
  if (col.status) return col.status;
  return current === "done" ? "todo" : current;
}

export function newColumnId(name: string, existing: BoardColumn[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "column";
  let id = base, n = 2;
  while (existing.some((c) => c.id === id)) id = `${base}_${n++}`;
  return id;
}

export const COLUMN_PALETTE = ["#94a3b8", "#3b82f6", "#f59e0b", "#8b5cf6", "#22c55e", "#ef4444", "#14b8a6", "#ec4899", "#f97316", "#64748b"];
