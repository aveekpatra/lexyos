"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Auto-growing textarea that commits on blur or ⌘/Ctrl+Enter.
 * Used by the task and project detail screens for inline-editable fields.
 */
export function AutoTextarea({
  value,
  onChange,
  onCommit,
  placeholder,
  className = "",
  minRows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.blur();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      className={`w-full resize-none overflow-hidden rounded-lg bg-transparent px-2 py-1 outline-none transition-colors placeholder:text-text-faint hover:bg-black/[0.02] focus:bg-black/[0.03] dark:hover:bg-white/[0.03] dark:focus:bg-white/[0.05] ${className}`}
    />
  );
}
