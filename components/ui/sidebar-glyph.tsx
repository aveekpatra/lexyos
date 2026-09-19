import { cn } from "@/lib/utils";

/**
 * Custom sidebar-toggle glyph (SF Symbols "sidebar.left" idea) drawn to the
 * Ionicons grid: 512 viewBox, currentColor, big rounded corners. HOLLOW on
 * purpose — an outlined window with the sidebar divider — the filled version
 * read as a heavy blob at 18px next to the round workspace tile.
 */
export function SidebarGlyph({ className, side = "left" }: { className?: string; side?: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth={36}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {/* Window frame. */}
      <rect x="48" y="88" width="416" height="336" rx="72" />
      {/* Sidebar divider. */}
      <path d={side === "left" ? "M192 88v336" : "M320 88v336"} />
    </svg>
  );
}
