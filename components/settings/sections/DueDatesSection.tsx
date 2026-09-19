"use client";

import { Section, Row, Toggle, Select } from "../primitives";
import { useSettings } from "@/lib/settings";

export function DueDatesSection() {
  const { settings, update } = useSettings();
  const d = settings.dueDates;
  return (
    <>
      <Section title="Indicator" description="When the date chip on a card turns amber.">
        <Row label="Highlight tasks due within">
          <Select value={d.indicatorWithinDays} onChange={(v) => update("dueDates", { indicatorWithinDays: v })}
            options={[0, 1, 2, 3, 5, 7, 14].map((n) => ({ value: n, label: n === 0 ? "Only today" : `${n} ${n === 1 ? "day" : "days"}` }))} width="w-[130px]" />
        </Row>
      </Section>
      <Section title="Reminders" description="Browser notifications before a task is due. Needs permission when first turned on.">
        <Row label="Reminder notifications">
          <Toggle on={d.reminderNotifications} onChange={async (v) => {
            if (v && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
            update("dueDates", { reminderNotifications: v });
          }} />
        </Row>
      </Section>
    </>
  );
}
