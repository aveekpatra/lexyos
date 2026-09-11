import React from "react";

export const ResizeHandle = React.memo(function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-2.5 shrink-0 cursor-col-resize bg-transparent transition-colors"
    />
  );
});
