"use client";

// This file is no longer used — AI response is rendered inline in CommandBar.tsx.
// Kept for backward compatibility if needed.

import { HugeiconsIcon } from "@hugeicons/react";
import { AiMagicIcon, Loading03Icon } from "@hugeicons/core-free-icons";

interface AIResponseProps {
  message: string | null;
  loading: boolean;
}

export default function AIResponse({ message, loading }: AIResponseProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 px-4 py-4">
        <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Thinking...</span>
      </div>
    );
  }

  if (!message) return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <HugeiconsIcon icon={AiMagicIcon} size={16} className="mt-0.5 shrink-0 text-primary" />
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {message}
      </p>
    </div>
  );
}
