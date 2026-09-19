"use client";

import { Section, Row, ShortcutRecorder } from "../primitives";
import { useSettings, DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

const ITEMS: { key: keyof Settings["shortcuts"]; label: string; hint: string }[] = [
  { key: "palette", label: "Search and commands", hint: "Open the palette from anywhere" },
  { key: "help", label: "Help", hint: "Open the help sheet" },
  { key: "overview", label: "Overview", hint: "Inbox: today, this week, next week, month" },
  { key: "days", label: "Days", hint: "Inbox: one column per day" },
  { key: "today", label: "Scroll to today", hint: "Inbox, Days view" },
  { key: "quickAdd", label: "Add to first column", hint: "Then 2, 3, and so on for the next columns" },
];

export function ShortcutsSection() {
  const { settings, update } = useSettings();
  return (
    <>
      <Section title="In-app shortcuts" description="Click a shortcut to record a new one. Escape cancels. Shortcuts pause while you type in a field.">
        {ITEMS.map((it) => (
          <Row key={it.key} label={it.label} hint={it.hint}>
            <ShortcutRecorder
              value={settings.shortcuts[it.key]}
              fallback={DEFAULT_SETTINGS.shortcuts[it.key]}
              onChange={(v) => update("shortcuts", { [it.key]: v } as Partial<Settings["shortcuts"]>)}
            />
          </Row>
        ))}
      </Section>
      <Section title="Fixed">
        <Row label="Create task from the add field" hint="Enter adds and stays, Tab adds and opens the task" />
        <Row label="Close a sheet or menu" hint="Escape" />
      </Section>
    </>
  );
}
