"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import KanbanCard from "./KanbanCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
} from "@/components/ui/menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreHorizontalIcon, Add01Icon } from "@hugeicons/core-free-icons";

interface KanbanColumnProps {
  section: Doc<"sections">;
  tasks: Doc<"tasks">[];
}

export default function KanbanColumn({ section, tasks }: KanbanColumnProps) {
  const updateSection = useMutation(api.sections.update);
  const removeSection = useMutation(api.sections.remove);
  const createTask = useMutation(api.tasks.create);

  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(section.name);

  async function handleAddTask() {
    if (!newTaskTitle.trim()) return;
    await createTask({
      title: newTaskTitle.trim(),
      sectionId: section._id as Id<"sections">,
    });
    setNewTaskTitle("");
    setAddingTask(false);
  }

  async function handleRename() {
    if (!renameValue.trim()) return;
    await updateSection({ id: section._id, name: renameValue.trim() });
    setRenaming(false);
  }

  return (
    <div className="flex w-72 min-w-72 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        {renaming ? (
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            size="sm"
          />
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{section.name}</h3>
            <span className="text-xs text-muted-foreground">
              {tasks.length}
            </span>
          </div>
        )}

        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon-xs" />}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem
              onClick={() => {
                setRenameValue(section.name);
                setRenaming(true);
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              variant="destructive"
              onClick={() => removeSection({ id: section._id })}
            >
              Delete section
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <KanbanCard key={task._id} task={task} />
        ))}
      </div>

      {addingTask ? (
        <div className="mt-2 flex flex-col gap-2">
          <Input
            placeholder="Task name"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddTask();
              if (e.key === "Escape") {
                setAddingTask(false);
                setNewTaskTitle("");
              }
            }}
            autoFocus
            size="sm"
          />
          <div className="flex gap-2">
            <Button size="xs" onClick={handleAddTask} disabled={!newTaskTitle.trim()}>
              Add
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setAddingTask(false);
                setNewTaskTitle("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 justify-start text-text-faint"
          onClick={() => setAddingTask(true)}
        >
          <HugeiconsIcon icon={Add01Icon} size={16} />
          Add task
        </Button>
      )}
    </div>
  );
}
