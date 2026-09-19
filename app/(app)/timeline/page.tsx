"use client";

import { Suspense } from "react";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import { TimeboxPanel } from "@/components/timebox/TimeboxPanel";

export default function TimelinePage() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <Suspense fallback={null}>
        <KanbanBoard />
      </Suspense>
      <TimeboxPanel />
    </div>
  );
}
