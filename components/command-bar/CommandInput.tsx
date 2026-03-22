"use client";

// This file is no longer used — CommandBar.tsx uses coss ui CommandInput directly.
// Kept for backward compatibility if needed.

import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";

interface CommandInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

export default function CommandInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: CommandInputProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <HugeiconsIcon icon={Search01Icon} size={16} className="shrink-0 text-muted-foreground" />
      <input
        placeholder="Ask AI to create events, tasks, plan your day..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && value.trim()) {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={disabled}
        autoFocus
        className="h-9 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
