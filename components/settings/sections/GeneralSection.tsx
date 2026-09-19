"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section, Row, Toggle, Select, NumberField } from "../primitives";
import { Segmented } from "@/components/ui/segmented";
import { useTheme } from "@/components/ThemeProvider";
import { useSettings } from "@/lib/settings";
import { useTimeboxOpen } from "@/lib/timebox-store";
import { PRIORITY_LABELS } from "@/lib/constants";
import { softPill } from "@/lib/ui/chrome";
import { localDateStr } from "@/lib/time-utils";
import { IoSunny, IoMoon } from "react-icons/io5";

export function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const { settings, update } = useSettings();
  const g = settings.general;
  const c = settings.calendar;
  const [timeboxOpen, setTimeboxOpen] = useTimeboxOpen();
  const rollover = useMutation(api.tasks.rolloverOverdue);
  const [rolled, setRolled] = useState<number | null>(null);

  return (
    <>
      <Section title="Appearance">
        <Row label="Theme">
          <Segmented layoutId="settings-theme" size="sm" value={theme} onChange={(v) => setTheme(v)}
            items={[{ value: "light", icon: <IoSunny className="size-3.5" />, title: "Light" }, { value: "dark", icon: <IoMoon className="size-3.5" />, title: "Dark" }]} />
        </Row>
      </Section>

      <Section title="Inbox" description="How the board opens and what sits beside it.">
        <Row label="Default view">
          <Segmented layoutId="settings-view" size="sm" value={g.defaultView} onChange={(v) => { update("general", { defaultView: v }); try { localStorage.setItem("unifocus:kanban:view", v); } catch {} }}
            items={[{ value: "overview", label: "Overview" }, { value: "days", label: "Days" }]} />
        </Row>
        <Row label="Timebox panel" hint="The day grid beside the board">
          <Toggle on={timeboxOpen} onChange={setTimeboxOpen} />
        </Row>
      </Section>

      <Section title="New tasks" description="Defaults applied when you add a task.">
        <Row label="Add new tasks to the">
          <Select value={g.newTaskPosition} onChange={(v) => update("general", { newTaskPosition: v })} options={[{ value: "top", label: "Top of the list" }, { value: "bottom", label: "Bottom of the list" }]} width="w-[170px]" />
        </Row>
        <Row label="Default duration" hint="Used when a task gets a time without an end">
          <Select value={g.defaultDurationMin} onChange={(v) => update("general", { defaultDurationMin: v })}
            options={[15, 30, 45, 60, 90, 120].map((m) => ({ value: m, label: m < 60 ? `${m} min` : `${m / 60} h` }))} width="w-[120px]" />
        </Row>
        <Row label="Default priority">
          <Select value={g.defaultPriority} onChange={(v) => update("general", { defaultPriority: v })}
            options={(["p1", "p2", "p3", "p4"] as const).map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} width="w-[120px]" />
        </Row>
      </Section>

      <Section title="Task rollover" description="Move what you did not finish onto today, once a day.">
        <Row label="Roll over incomplete tasks" hint={g.lastRollover ? `Last run ${g.lastRollover}` : "Off: overdue tasks stay on their date and show in Overdue"}>
          <Toggle on={g.rolloverEnabled} onChange={(v) => update("general", { rolloverEnabled: v })} />
        </Row>
        <Row label="Include repeating tasks">
          <Toggle on={g.rolloverRecurring} disabled={!g.rolloverEnabled} onChange={(v) => update("general", { rolloverRecurring: v })} />
        </Row>
        <Row label="Run now" hint="Moves every overdue task to today">
          <button onClick={async () => { const n = await rollover({ today: localDateStr(new Date()), includeRecurring: g.rolloverRecurring }); setRolled(n); update("general", { lastRollover: localDateStr(new Date()) }); }} className={softPill}>
            {rolled === null ? "Roll over" : `Moved ${rolled}`}
          </button>
        </Row>
      </Section>

      <Section title="After completing a task">
        <Row label="Move completed tasks to the bottom">
          <Toggle on={g.moveDoneToBottom} onChange={(v) => update("general", { moveDoneToBottom: v })} />
        </Row>
        <Row label="Complete the parent when every sub-issue is done">
          <Toggle on={g.completeParentWhenSubtasksDone} onChange={(v) => update("general", { completeParentWhenSubtasksDone: v })} />
        </Row>
      </Section>

      <Section title="Calendar and board" description="Week, clock, and grid behaviour everywhere.">
        <Row label="Start week on">
          <Select value={c.weekStartsOn} onChange={(v) => update("calendar", { weekStartsOn: v })} options={[{ value: 1, label: "Monday" }, { value: 6, label: "Saturday" }, { value: 0, label: "Sunday" }]} width="w-[130px]" />
        </Row>
        <Row label="Time format">
          <Segmented layoutId="settings-clock" size="sm" value={c.timeFormat} onChange={(v) => update("calendar", { timeFormat: v })} items={[{ value: "12h", label: "12 hour" }, { value: "24h", label: "24 hour" }]} />
        </Row>
        <Row label="Timebox opens at" hint="First hour shown on days other than today">
          <Select value={c.dayStartHour} onChange={(v) => update("calendar", { dayStartHour: v })} options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: c.timeFormat === "24h" ? `${String(h).padStart(2, "0")}:00` : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}` }))} width="w-[110px]" />
        </Row>
        <Row label="Time increments" hint="Drag and resize snap in the Timebox">
          <Select value={c.snapMinutes} onChange={(v) => update("calendar", { snapMinutes: v })} options={[5, 10, 15, 30].map((m) => ({ value: m as 5 | 10 | 15 | 30, label: `${m} minutes` }))} width="w-[130px]" />
        </Row>
        <Row label="Show declined Google events">
          <Toggle on={c.showDeclinedEvents} onChange={(v) => update("calendar", { showDeclinedEvents: v })} />
        </Row>
      </Section>

      <Section title="Workday" description="Warn when a day holds more than you can do.">
        <Row label="Daily workload limit">
          <Toggle on={c.workdayThresholdEnabled} onChange={(v) => update("calendar", { workdayThresholdEnabled: v })} />
        </Row>
        <Row label="Threshold">
          <NumberField value={c.workdayThresholdHours} min={1} max={16} suffix="hours" onChange={(v) => update("calendar", { workdayThresholdHours: v })} />
        </Row>
      </Section>

      <Section title="Privacy">
        <Row label="Anonymous usage analytics" hint="Nothing is collected today and there is no tracker in the app. The switch is here for when one exists.">
          <Toggle on={g.allowAnalytics} onChange={(v) => update("general", { allowAnalytics: v })} />
        </Row>
      </Section>
    </>
  );
}
