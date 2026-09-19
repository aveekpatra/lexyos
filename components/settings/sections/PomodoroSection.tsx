"use client";

import { Section, Row, Toggle, NumberField } from "../primitives";
import { useSettings } from "@/lib/settings";

export function PomodoroSection() {
  const { settings, update } = useSettings();
  const p = settings.pomodoro;
  return (
    <>
      <Section title="Lengths" description="Start a session from a task's right-click menu or its page. The timer floats at the bottom.">
        <Row label="Focus block">
          <NumberField value={p.workMin} min={5} max={120} step={5} suffix="min" onChange={(v) => update("pomodoro", { workMin: v })} />
        </Row>
        <Row label="Short break"><NumberField value={p.shortBreakMin} min={1} max={30} suffix="min" onChange={(v) => update("pomodoro", { shortBreakMin: v })} /></Row>
        <Row label="Long break"><NumberField value={p.longBreakMin} min={5} max={60} step={5} suffix="min" onChange={(v) => update("pomodoro", { longBreakMin: v })} /></Row>
        <Row label="Long break after" hint="Number of focus blocks"><NumberField value={p.roundsBeforeLongBreak} min={2} max={8} suffix="blocks" onChange={(v) => update("pomodoro", { roundsBeforeLongBreak: v })} /></Row>
      </Section>
      <Section title="Behaviour">
        <Row label="Start breaks automatically"><Toggle on={p.autoStartBreaks} onChange={(v) => update("pomodoro", { autoStartBreaks: v })} /></Row>
        <Row label="Start the next task after a break"><Toggle on={p.autoStartNext} onChange={(v) => update("pomodoro", { autoStartNext: v })} /></Row>
        <Row label="Sound at the end of a block"><Toggle on={p.sound} onChange={(v) => update("pomodoro", { sound: v })} /></Row>
      </Section>
    </>
  );
}
