"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSettings } from "@/lib/settings";
import { localDateStr } from "@/lib/time-utils";

/** One create path for every quick-add box: applies the settings defaults. */
export function useQuickAdd() {
  const { settings } = useSettings();
  const createTask = useMutation(api.tasks.create);

  const create = useCallback(async (input: {
    title: string;
    dueDate?: string;
    projectId?: Id<"projects">;
    status?: "todo" | "planned" | "in_progress" | "review" | "done";
    dueTime?: string;
    columnId?: string;
  }) => {
    return await createTask({
      title: input.title.trim() || "New task",
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      projectId: input.projectId,
      status: input.status,
      columnId: input.columnId,
      priority: settings.general.defaultPriority,
      placeAtTop: settings.general.newTaskPosition === "top",
      userDate: localDateStr(new Date()),
    });
  }, [settings.general, createTask]);

  return { create, settings } as const;
}
