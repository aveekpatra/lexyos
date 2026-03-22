import React from "react";

export const ResizeHandle = React.memo(function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-[#7c3aed]/30 active:bg-[#7c3aed]/50 transition-colors"
    />
  );
});
