import type * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        // Light: white pill with subtle bottom border (mech-key feel) — Akiflow style
        // Dark: muted slab with inner highlight
        "pointer-events-none inline-flex h-[18px] min-w-[18px] select-none items-center justify-center gap-1 rounded-[5px] border border-line bg-surface-1 px-1.5 font-sans text-[10.5px] font-semibold text-text-muted shadow-[0_1px_0_0_rgba(26,26,34,0.08),0_1.5px_0_0_rgba(26,26,34,0.04)] dark:border-white/10 dark:bg-white/5 dark:text-text-secondary dark:shadow-[0_1px_0_0_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.06)] [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

export function KbdGroup({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}
