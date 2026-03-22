import type * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border/60 bg-muted px-1.5 font-medium font-sans text-muted-foreground text-xs shadow-[0_1px_0_0_rgba(0,0,0,0.3),0_1px_2px_0_rgba(0,0,0,0.15),inset_0_1px_0_0_rgba(255,255,255,0.04)] [&_svg:not([class*='size-'])]:size-3",
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
