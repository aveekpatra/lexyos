"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import TaskDetail from "@/components/task-detail/TaskDetail";

export default function TaskPage() {
  const params = useParams<{ id: string }>();
  return <TaskDetail taskId={params.id as Id<"tasks">} />;
}
