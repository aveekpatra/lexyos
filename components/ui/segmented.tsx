"use client";

import { motion } from "motion/react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Apple "Liquid Glass" segmented control — a recessed capsule track with a
 * single white thumb that slides between options (Framer-Motion shared layout).
 * Used for the task-column view switchers. `layoutId` must be unique per
 * instance so multiple switchers don't share one animated thumb.
 */
export interface SegmentedItem<T extends string> {
  value: T;
  /** Short text label (e.g. "Overview", "W") */
  label?: React.ReactNode;
  /** Optional leading icon node */
  icon?: React.ReactNode;
  /** Accessible label when only an icon is shown */
  title?: string;
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  layoutId,
  size = "md",
  className,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  size?: "sm" | "md";
  className?: string;
}): React.ReactElement {
  const track =
    size === "sm"
      ? "h-7 p-0.5 gap-0.5"
      : "h-8 p-0.5 gap-0.5";
  const seg =
    size === "sm"
      ? "h-6 px-2 text-[11.5px]"
      : "h-7 px-2.5 text-xs";

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center rounded-full bg-black/[0.05] dark:bg-white/[0.07]",
        track,
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors duration-150 outline-none",
              seg,
              active
                ? "text-foreground"
                : "text-foreground/55 hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 560, damping: 42 }}
                className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.14)] dark:bg-white/20"
              />
            )}
            {item.icon && <span className="relative z-10 inline-flex">{item.icon}</span>}
            {item.label != null && <span className="relative z-10">{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
