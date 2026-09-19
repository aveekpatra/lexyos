import type * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        // Aturno keyboard badge: a small round grey pill, no border, no bevel.
        "pointer-events-none inline-flex h-[18px] min-w-[18px] select-none items-center justify-center rounded-full bg-black/[0.05] px-1 font-sans text-[10px] font-medium text-text-muted dark:bg-white/[0.08] dark:text-text-secondary [&_svg:not([class*='size-'])]:size-3",
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
