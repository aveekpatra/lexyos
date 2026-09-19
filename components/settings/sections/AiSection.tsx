"use client";

import { useState } from "react";
import { Section, Row, Toggle, TextArea } from "../primitives";
import { Segmented } from "@/components/ui/segmented";
import { useSettings } from "@/lib/settings";

export function AiSection() {
  const { settings, update } = useSettings();
  const a = settings.ai;
  const [prefs, setPrefs] = useState<string | null>(null);
  const value = prefs ?? a.schedulingPreferences;

  return (
    <>
      <Section title="Changes" description="How much the assistant may do without asking.">
        <Row label="Before editing your tasks" hint={a.approval === "ask" ? "Shows the change and waits for a yes" : "Applies valid changes immediately, including deletes"}>
          <Segmented layoutId="ai-approval" size="sm" value={a.approval} onChange={(v) => update("ai", { approval: v })} items={[{ value: "ask", label: "Ask first" }, { value: "auto", label: "Just do it" }]} />
        </Row>
        <Row label="Show reasoning" hint="See how it thinks before it answers. Slightly slower.">
          <Toggle on={a.showReasoning} onChange={(v) => update("ai", { showReasoning: v })} />
        </Row>
      </Section>
      <Section title="Scheduling preferences" description="Plain words the assistant reads before it plans your day. Explicit requests always win.">
        <div className="px-3.5 py-3">
          <TextArea rows={5} value={value} onChange={setPrefs} onCommit={() => { if (prefs !== null && prefs !== a.schedulingPreferences) update("ai", { schedulingPreferences: prefs }); }}
            placeholder={"Deep work before noon. No meetings after 6pm. Gym Monday, Wednesday, Friday at 7am. Keep Friday afternoons empty."} />
        </div>
      </Section>
    </>
  );
}
