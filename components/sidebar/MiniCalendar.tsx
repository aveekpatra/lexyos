"use client";

import { useMemo, useState } from "react";
import { DayPicker, type ChevronProps } from "react-day-picker";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { format, parseISO, isValid } from "date-fns";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";
import { useTimeboxDate } from "@/lib/timebox-store";
import { localDateStr } from "@/lib/time-utils";
import { useSettings } from "@/lib/settings";

/*
 * Month picker under the nav. react-day-picker does the calendar maths
 * (locales, week start, keyboard, outside days); we only give it our capsule
 * geometry. Picking a day opens the Inbox Days view on that date and points
 * the Timebox at it. Days with open tasks carry a dot.
 */

function Chevron({ orientation, className }: ChevronProps) {
  const Icon = orientation === "left" ? IoChevronBack : IoChevronForward;
  return <Icon className={`size-3.5 ${className ?? ""}`} />;
}

export function MiniCalendar() {
  const router = useRouter();
  const params = useSearchParams();
  const [, setTimeboxDate] = useTimeboxDate();
  const tasks = useQuery(api.tasks.list, {});
  const selectedStr = params.get("date");
  const selected = selectedStr && isValid(parseISO(selectedStr)) ? parseISO(selectedStr) : undefined;
  const [month, setMonth] = useState<Date>(selected ?? new Date());
  const { settings } = useSettings();

  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks ?? []) {
      if (t.status === "done" || t.parentTaskId) continue;
      const d = t.dueDate || t.scheduledDate;
      if (d) set.add(d);
    }
    return set;
  }, [tasks]);

  const pick = (d: Date | undefined) => {
    if (!d) return;
    const ds = localDateStr(d);
    setTimeboxDate(ds);
    router.push(`/timeline?date=${ds}`);
  };

  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={pick}
      month={month}
      onMonthChange={setMonth}
      weekStartsOn={settings.calendar.weekStartsOn}
      showOutsideDays
      fixedWeeks
      components={{ Chevron }}
      modifiers={{ busy: (d) => busy.has(localDateStr(d)) }}
      modifiersClassNames={{ busy: "day-busy" }}
      formatters={{ formatWeekdayName: (d) => format(d, "EEEEE") }}
      classNames={{
        root: "mini-cal select-none",
        months: "relative",
        month: "flex flex-col gap-1",
        month_caption: "flex h-8 items-center pl-1.5",
        caption_label: "text-[12px] font-semibold text-text-strong",
        nav: "absolute right-0 top-0 flex h-8 items-center gap-0.5",
        button_previous: "flex size-7 items-center justify-center rounded-full text-text-faint transition-colors hover:bg-black/[0.05] hover:text-text-strong disabled:opacity-30 dark:hover:bg-white/[0.06]",
        button_next: "flex size-7 items-center justify-center rounded-full text-text-faint transition-colors hover:bg-black/[0.05] hover:text-text-strong disabled:opacity-30 dark:hover:bg-white/[0.06]",
        month_grid: "w-full border-collapse",
        weekdays: "",
        weekday: "h-6 text-center text-[10px] font-medium text-text-faint",
        week: "",
        day: "p-0 text-center",
        day_button: "relative mx-auto flex size-7 items-center justify-center rounded-full text-[12px] font-medium text-text-secondary transition-colors hover:bg-black/[0.05] hover:text-text-strong dark:hover:bg-white/[0.06]",
        today: "[&>button]:font-bold [&>button]:text-text-strong",
        selected: "[&>button]:bg-text-strong [&>button]:text-white [&>button]:hover:bg-text-strong dark:[&>button]:bg-white dark:[&>button]:text-black",
        outside: "[&>button]:text-text-faint/60",
        hidden: "invisible",
      }}
    />
  );
}
