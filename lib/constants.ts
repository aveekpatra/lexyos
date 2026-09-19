export const PRIORITY_COLORS: Record<string, string> = {
  p1: "#e11d48", p2: "#2563eb", p3: "#38bdf8", p4: "#94a3b8",
};
export const PRIORITY_LABELS: Record<string, string> = {
  p1: "Urgent", p2: "High", p3: "Medium", p4: "Low",
};

export const STATUS_OPTIONS = [
  { value: "todo", label: "Todo", color: "#94a3b8" },
  { value: "planned", label: "Planned", color: "#3b82f6" },
  { value: "in_progress", label: "In Progress", color: "#f59e0b" },
  { value: "review", label: "Review", color: "#8b5cf6" },
  { value: "done", label: "Done", color: "#22c55e" },
] as const;

export type TaskStatus = (typeof STATUS_OPTIONS)[number]["value"];

// Recurrence presets and labels live in convex/lib/recurrence.ts (shared with Convex and the AI tools).
