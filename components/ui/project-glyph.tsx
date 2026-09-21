import { cn } from "@/lib/utils";
import { IoFolderOpen } from "react-icons/io5";
import { projectIcon, DEFAULT_PROJECT_ICON } from "@/lib/ui/project-icons";

/**
 * A project's own glyph, in its own colour. Replaces the bare folder so a
 * project is recognisable at a glance in the sidebar, in menus and on its
 * board. A project that never picked one still gets the folder, which keeps
 * its open state; a chosen icon has no open state and does not need one.
 */
export function ProjectGlyph({
  icon,
  open = false,
  className,
  style,
}: {
  icon?: string | null;
  open?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const chosen = icon && icon !== DEFAULT_PROJECT_ICON;
  const Glyph = !chosen && open ? IoFolderOpen : projectIcon(icon).Icon;
  return <Glyph className={cn("size-[18px] shrink-0", className)} style={style} aria-hidden />;
}
