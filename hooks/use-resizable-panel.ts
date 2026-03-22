import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_PREFIX = "unifocus-panel-";

export function useResizablePanel(
  key: string,
  defaultWidth: number,
  minWidth = 160,
  maxWidth = 500,
  /** Offset from left edge of viewport (e.g., icon rail width) */
  offsetLeft = 48
) {
  const [width, setWidth] = useState(defaultWidth);
  const initialized = useRef(false);
  const isResizing = useRef(false);

  // Read from localStorage after mount (avoids hydration mismatch)
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          setWidth(parsed);
        }
      }
    } catch {}
  }, [key, minWidth, maxWidth]);

  // Persist to localStorage on change
  useEffect(() => {
    if (!initialized.current) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + key, String(width));
    } catch {}
  }, [key, width]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        if (!isResizing.current) return;
        const newWidth = Math.max(minWidth, Math.min(maxWidth, ev.clientX - offsetLeft));
        setWidth(newWidth);
      }
      function onUp() {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [minWidth, maxWidth, offsetLeft]
  );

  return { width, onMouseDown } as const;
}
