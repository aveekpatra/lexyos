import { cn } from "@/lib/utils";
// Ionicons FILLED folder pair — the same solid, rounded family as the main
// nav glyphs in app-sidebar, so the case tree reads as one system.
import { IoFolder, IoFolderOpen } from "react-icons/io5";

export function Folder({
  open = false,
  className,
  style,
}: {
  open?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Glyph = open ? IoFolderOpen : IoFolder;
  return (
    <Glyph className={cn("size-[18px] shrink-0", className)} style={style} aria-hidden />
  );
}
