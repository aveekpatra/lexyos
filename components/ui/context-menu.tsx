"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type React from "react";
import { cn } from "@/lib/utils";
import { MenuPopup } from "@/components/ui/menu";

// Re-export the Root and Trigger from ContextMenu
export const ContextMenu: typeof ContextMenuPrimitive.Root =
  ContextMenuPrimitive.Root;

export function ContextMenuTrigger({
  className,
  ...props
}: ContextMenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.Trigger
      className={cn("outline-none", className)}
      data-slot="context-menu-trigger"
      {...props}
    />
  );
}

// Re-export MenuPopup and all menu items — they work with ContextMenu too
export { MenuPopup as ContextMenuPopup } from "@/components/ui/menu";
export { MenuItem as ContextMenuItem } from "@/components/ui/menu";
export { MenuSeparator as ContextMenuSeparator } from "@/components/ui/menu";
export { MenuGroup as ContextMenuGroup } from "@/components/ui/menu";
export { MenuGroupLabel as ContextMenuGroupLabel } from "@/components/ui/menu";
export { MenuShortcut as ContextMenuShortcut } from "@/components/ui/menu";
