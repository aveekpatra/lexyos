"use client";

import * as React from "react";
import { motion } from "motion/react";

/**
 * The single hover capsule that SLIDES between rows instead of each row
 * toggling its own background. Reads Base UI's `[data-highlighted]` row
 * (keyboard or pointer) and, for plain button lists, the row under the
 * pointer (`[data-row]`). Rendered first and absolute, so rows (`relative`)
 * stay crisp above it. Spring is Aturno's chrome recipe.
 */
export function SlidingHighlight({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [state, setState] = React.useState({ top: 0, height: 36, shown: false });
  const hovered = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      const el =
        container.querySelector<HTMLElement>("[data-highlighted]") ??
        container.querySelector<HTMLElement>("[data-popup-open]") ??
        (hovered.current && container.contains(hovered.current) ? hovered.current : null);
      if (!el) {
        setState((s) => (s.shown ? { ...s, shown: false } : s));
        return;
      }
      // offsetTop is relative to the nearest positioned ancestor (the shell).
      setState({ top: el.offsetTop, height: el.offsetHeight, shown: true });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const onMove = (e: PointerEvent) => {
      const row = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-row]");
      hovered.current = row && container.contains(row) ? row : null;
      schedule();
    };
    const onLeave = () => { hovered.current = null; schedule(); };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-highlighted", "data-popup-open"] });
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, [containerRef]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-2 top-0 z-0 rounded-full bg-black/[0.05] dark:bg-white/[0.07]"
      initial={false}
      animate={{ y: state.top, height: state.height, opacity: state.shown ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 560, damping: 42, mass: 0.7 }}
    />
  );
}
