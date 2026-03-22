"use client";

// This file is no longer used — actions are rendered inline in CommandBar.tsx.
// Kept for backward compatibility if needed.

import { AIAction } from "@/app/actions/ai";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkSquare01Icon } from "@hugeicons/core-free-icons";

interface ActionCardProps {
  action: AIAction;
}

export default function ActionCard({ action }: ActionCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
      <HugeiconsIcon icon={CheckmarkSquare01Icon} size={16} className="opacity-60" />
      <span>{action.summary}</span>
    </div>
  );
}
