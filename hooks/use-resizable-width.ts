"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize width for a side panel, persisted per key. Uses pointer
 * deltas so it works for a panel on either side; `side` says which edge the
 * handle sits on (dragging away from the panel grows it).
 */
export function useResizableWidth(key: string, opts: { initial: number; min: number; max: number; side: "left" | "right" }) {
  const { initial, min, max, side } = opts;
  const storageKey = `unifocus:width:${key}`;
  const [width, setWidth] = useState(initial);
  const [resizing, setResizing] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const v = parseInt(localStorage.getItem(storageKey) ?? "", 10);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after mount so SSR and first paint agree
      if (!Number.isNaN(v)) setWidth(Math.max(min, Math.min(max, v)));
    } catch {}
  }, [storageKey, min, max]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    let next = startW;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      next = Math.max(min, Math.min(max, side === "right" ? startW + delta : startW - delta));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
      try { localStorage.setItem(storageKey, String(next)); } catch {}
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [width, min, max, side, storageKey]);

  return { width, resizing, onPointerDown } as const;
}
