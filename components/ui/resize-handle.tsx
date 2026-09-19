"use client";

/**
 * Invisible grab strip on a panel edge. A hairline appears on hover and while
 * dragging (the Aturno rail behaviour). Place inside a `relative` panel.
 */
export function ResizeHandle({ side, onPointerDown, active }: {
  side: "left" | "right";
  onPointerDown: (e: React.PointerEvent) => void;
  active?: boolean;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={`group/handle absolute inset-y-0 z-30 w-2 cursor-col-resize ${side === "right" ? "-right-1" : "-left-1"}`}
    >
      <div className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${active ? "bg-line-strong" : "bg-transparent group-hover/handle:bg-line-strong"}`} />
    </div>
  );
}
