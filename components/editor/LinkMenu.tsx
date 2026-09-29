"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IoCheckmarkCircle, IoDocumentText, IoEllipseOutline } from "react-icons/io5";
import { findLinkTargets, type LinkItem } from "@/lib/link-targets";
import { frostedMenuSurface } from "@/lib/ui/chrome";

export type LinkMenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

/**
 * The picker behind "#", "@", "[[" and Cmd-K. Typing in the editor drives it;
 * with `searchable` (Cmd-K on a selection) it has its own field.
 */
export const LinkMenu = forwardRef<LinkMenuHandle, {
  items: LinkItem[];
  onPick: (item: LinkItem) => void;
  searchable?: boolean;
  onClose?: () => void;
}>(function LinkMenu({ items: typed, onPick, searchable = false, onClose }, ref) {
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const items = searchable ? findLinkTargets(query, "any") : typed;
  const field = useRef<HTMLInputElement>(null);

  // A new list starts at its first row (adjusting state during render).
  const listKey = items.map((i) => (i.kind === "task" ? `t${i.number}` : `n${i.id}`)).join(",");
  const [seen, setSeen] = useState(listKey);
  if (seen !== listKey) {
    setSeen(listKey);
    setSelected(0);
  }

  useEffect(() => { if (searchable) field.current?.focus(); }, [searchable]);

  const handle = (key: string): boolean => {
    if (key === "ArrowUp") { setSelected((s) => (s + items.length - 1) % Math.max(items.length, 1)); return true; }
    if (key === "ArrowDown") { setSelected((s) => (s + 1) % Math.max(items.length, 1)); return true; }
    if (key === "Enter" || key === "Tab") {
      const item = items[selected];
      if (!item) return false;
      onPick(item);
      return true;
    }
    if (key === "Escape") { onClose?.(); return true; }
    return false;
  };

  useImperativeHandle(ref, () => ({ onKeyDown: (event) => (items.length ? handle(event.key) : false) }));

  if (!items.length && !searchable) return null;

  return (
    <div className={`${frostedMenuSurface} w-[320px] rounded-[20px] p-1.5`} onMouseDown={(e) => { if (e.target !== field.current) e.preventDefault(); }}>
      {searchable && (
        <input
          ref={field}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (handle(e.key)) e.preventDefault(); }}
          placeholder="Link to a task or note"
          className="mb-1 h-9 w-full rounded-full bg-black/[0.04] px-3.5 text-[13px] text-foreground outline-none placeholder:text-text-faint dark:bg-white/[0.06]"
        />
      )}
      {items.map((item, i) => (
        <button
          key={item.kind === "task" ? `t${item.number}` : `n${item.id}`}
          type="button"
          onMouseEnter={() => setSelected(i)}
          onClick={() => onPick(item)}
          className={`flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-[13px] text-foreground ${i === selected ? "bg-black/[0.06] dark:bg-white/[0.1]" : ""}`}
        >
          {item.kind === "task" ? (
            <>
              {item.done ? <IoCheckmarkCircle className="size-4 shrink-0 text-brand" /> : <IoEllipseOutline className="size-4 shrink-0 text-brand" />}
              <span className="shrink-0 font-mono text-[12px] text-text-faint">#{item.number}</span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </>
          ) : (
            <>
              <IoDocumentText className="size-4 shrink-0 text-violet-500" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </>
          )}
        </button>
      ))}
      {searchable && !items.length && <p className="px-3.5 py-2 text-[12px] text-text-faint">Nothing matches</p>}
    </div>
  );
});
