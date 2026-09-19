"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Kbd } from "@/components/ui/kbd";
import { glassIconButton } from "@/lib/ui/chrome";
import { IoClose, IoHelpCircle } from "react-icons/io5";
import { useSettings, matchesShortcut, shortcutKeys, type Shortcut } from "@/lib/settings";

/*
 * Help as an Aturno sheet: hero glyph, one question per tab, and grouped
 * capsule lists instead of a wall of headings. Tabs slide; nothing stacks.
 */

type Tab = "shortcuts" | "board" | "ai";

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("shortcuts");
  const { settings } = useSettings();
  const sc = settings.shortcuts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[460px] overflow-hidden !rounded-[24px] !p-0" showCloseButton={false}>
        <div className="flex max-h-[82vh] flex-col">
          <div className="flex items-center justify-end px-4 pt-4">
            <button onClick={() => onOpenChange(false)} aria-label="Close" className={glassIconButton}>
              <IoClose className="size-4" />
            </button>
          </div>

          <div className="flex flex-col items-center px-6 pb-4 text-center">
            <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand">
              <IoHelpCircle className="size-7" aria-hidden />
            </div>
            <DialogTitle className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-text-strong">How Mindbook works</DialogTitle>
            <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-text-muted">
              Everything is a task. Inbox shows all of them by time, a project shows its own by status.
            </p>
            <Segmented
              layoutId="help-tabs"
              value={tab}
              onChange={setTab}
              className="mt-4"
              items={[
                { value: "shortcuts", label: "Shortcuts" },
                { value: "board", label: "Board" },
                { value: "ai", label: "Ask AI" },
              ]}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {tab === "shortcuts" && (
              <div className="space-y-4">
                <Group title="Anywhere">
                  <Row label="Search, jump, or ask AI" keys={shortcutKeys(sc.palette)} />
                  <Row label="Open this help" keys={shortcutKeys(sc.help)} />
                </Group>
                <Group title="Inbox">
                  <Row label="Overview: today, this week, next week, month" keys={shortcutKeys(sc.overview)} />
                  <Row label="Days: one column per day, endless" keys={shortcutKeys(sc.days)} />
                  <Row label="Scroll to today" keys={shortcutKeys(sc.today)} />
                  <Row label="Add a task to a column" keys={shortcutKeys(sc.quickAdd)} hint="2, 3 for the next ones" />
                </Group>
                <Group title="Add task field">
                  <Row label="Create and stay" keys={["Enter"]} />
                  <Row label="Create and open the task" keys={["Tab"]} />
                </Group>
              </div>
            )}

            {tab === "board" && (
              <div className="space-y-4">
                <Group title="Cards">
                  <Tip>Drag a card onto any column or day to move its date.</Tip>
                  <Tip>Drop a card on an hour in the Timebox to give it a time. Drag the block to move it, pull its bottom edge to change the length.</Tip>
                  <Tip>Right-click a card for priority, date, project, repeat, done, and delete without opening it.</Tip>
                  <Tip>Click the circle on a card to complete it. A repeating task rolls to its next date and keeps a done copy.</Tip>
                </Group>
                <Group title="Projects">
                  <Tip>Click a project in the sidebar to open its board, grouped by status. Overview holds its description and a context document.</Tip>
                  <Tip>Right-click a project, or hover its row, for rename, colour, archive, duplicate, and delete.</Tip>
                </Group>
                <Group title="Calendar">
                  <Tip>Pick a day in the sidebar month to jump the Inbox and the Timebox to it.</Tip>
                  <Tip>Tasks with a date appear on Google Calendar. The sync button in the sidebar pulls and pushes on demand.</Tip>
                </Group>
              </div>
            )}

            {tab === "ai" && (
              <div className="space-y-4">
                <Group title="Try saying">
                  <Say>Add a task to review PRs tomorrow at 2pm</Say>
                  <Say>Move standup to 10am and make it repeat on weekdays</Say>
                  <Say>Make this Monday morning and Thursday evening</Say>
                  <Say>What is on my plate today?</Say>
                  <Say>Plan my day</Say>
                  <Say>Create a project called Q3 Launch</Say>
                </Group>
                <Group title="Voice">
                  <Tip>The mic dictates into the input. The phone icon starts a hands-free conversation with spoken replies.</Tip>
                </Group>
              </div>
            )}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-3.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-faint">{title}</h3>
      <div className="overflow-hidden rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] [&>*+*]:border-t [&>*+*]:border-black/[0.05] dark:[&>*+*]:border-white/[0.06]">
        {children}
      </div>
    </section>
  );
}

function Row({ label, keys, hint }: { label: string; keys: string[]; hint?: string }) {
  return (
    <div className="flex min-h-10 items-center gap-3 px-3.5 py-2">
      <span className="min-w-0 flex-1 text-[13px] text-text-strong">{label}</span>
      {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
      <span className="flex shrink-0 items-center gap-0.5">
        {keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
      </span>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="px-3.5 py-2.5 text-[13px] leading-relaxed text-text-secondary">{children}</p>;
}

function Say({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3.5 py-2.5 text-[13px] text-text-strong">
      <span className="text-text-faint">&ldquo;</span>{children}<span className="text-text-faint">&rdquo;</span>
    </p>
  );
}

/** Hook to open help dialog with ? key */
export function useHelpShortcut(onOpen: () => void, combo: Shortcut = "?") {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      if (matchesShortcut(e, combo)) {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen, combo]);
}
