"use client";

import { useMemo, useState } from "react";
import { searchProjectIcons } from "@/lib/ui/project-icons";
import { IoSearch } from "react-icons/io5";

/**
 * The icon set, in a grey island with a search that matches meaning as well as
 * name, so "gym" finds the barbell. Shared by project creation and the project
 * rail so the choice looks and behaves the same in both.
 */
export function ProjectIconGrid({
  value,
  color,
  onSelect,
}: {
  value: string | undefined;
  color: string;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const icons = useMemo(() => searchProjectIcons(query), [query]);

  return (
    <div className="rounded-[16px] bg-black/[0.04] p-2 dark:bg-white/[0.06]">
      <div className="mb-1.5 flex h-8 items-center gap-2 rounded-full bg-surface-0 px-3 dark:bg-white/[0.06]">
        <IoSearch className="size-3.5 shrink-0 text-text-faint" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons"
          className="w-0 min-w-0 flex-1 bg-transparent text-[13px] text-text-strong outline-none placeholder:text-text-faint"
        />
      </div>
      {icons.length === 0 ? (
        <div className="px-2 py-6 text-center text-[13px] text-text-faint">No icons match</div>
      ) : (
        <div className="grid max-h-[152px] grid-cols-8 gap-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {icons.map((i) => {
            const on = value === i.name;
            return (
              <button
                key={i.name}
                type="button"
                onClick={() => onSelect(i.name)}
                aria-label={i.label}
                aria-pressed={on}
                title={i.label}
                className={`flex size-8 items-center justify-center rounded-full transition-colors ${
                  on ? "" : "text-text-secondary hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                }`}
                style={on ? { backgroundColor: `${color}1f`, color } : undefined}
              >
                <i.Icon className="size-4" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
