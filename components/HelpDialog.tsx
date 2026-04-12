"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogHeader,
  DialogPanel,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-lg">Help</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-6">
            {/* AI Agent */}
            <Section title="AI Agent">
              <p className="mb-3 text-sm text-text-secondary">
                Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> to focus the AI bar. Ask it anything in natural language.
              </p>
              <SubSection title="Tasks">
                <HelpItem text="Create tasks" example={`"Add a task to review PRs tomorrow at 2pm"`} />
                <HelpItem text="Update tasks" example={`"Move standup to 10am"`} />
                <HelpItem text="Complete / delete tasks" example={`"Mark groceries as done"`} />
                <HelpItem text="Search tasks" example={`"What's on my plate today?"`} />
                <HelpItem text="Plan your day" example={`"Plan my day" or "When am I free?"`} />
              </SubSection>
              <SubSection title="Projects">
                <HelpItem text="Create projects" example={`"Create a project called Q3 Launch"`} />
                <HelpItem text="Update / archive projects" example={`"Rename project to Beta Launch"`} />
                <HelpItem text="Move tasks to projects" example={`"Move that task to Q3 Launch"`} />
              </SubSection>
              <SubSection title="Email">
                <HelpItem text="Search emails" example={`"Show unread emails from John"`} />
                <HelpItem text="Read emails" example={`"What did Sarah say about the meeting?"`} />
                <HelpItem text="Send emails" example={`"Email Alex saying I'll be late"`} />
                <HelpItem text="Reply to emails" example={`"Reply saying sounds good"`} />
                <HelpItem text="Archive / trash / star" example={`"Archive that email"`} />
              </SubSection>
              <SubSection title="Voice">
                <HelpItem text="Press the mic icon to dictate — speech fills the input" />
                <HelpItem text="Press the phone icon for call mode — hands-free conversation with voice responses" />
              </SubSection>
            </Section>

            {/* Global Shortcuts */}
            <Section title="Global Shortcuts">
              <ShortcutRow keys={["Ctrl", "K"]} label="Focus AI bar" />
            </Section>

            {/* Inbox Shortcuts */}
            <Section title="Inbox">
              <ShortcutRow keys={["Shift", "O"]} label="Overview (day buckets)" />
              <ShortcutRow keys={["Shift", "D"]} label="Day view" />
              <ShortcutRow keys={["Shift", "W"]} label="Week view" />
              <ShortcutRow keys={["Shift", "M"]} label="Month view" />
              <ShortcutRow keys={["1"]} label="Add task to first column" extra="2, 3... for other columns" />
            </Section>

            {/* Planner Shortcuts */}
            <Section title="Planner">
              <ShortcutRow keys={["T"]} label="Jump to today" />
              <ShortcutRow keys={["C"]} label="Add new task" />
              <p className="mt-1 text-xs text-text-faint">Drag tasks onto the time grid to schedule them. Resize blocks to change duration.</p>
            </Section>

            {/* Mail Shortcuts */}
            <Section title="Mail">
              <ShortcutRow keys={["J"]} label="Next email" extra="or Arrow Down" />
              <ShortcutRow keys={["K"]} label="Previous email" extra="or Arrow Up" />
              <ShortcutRow keys={["E"]} label="Archive" />
              <ShortcutRow keys={["S"]} label="Star / unstar" />
              <ShortcutRow keys={["#"]} label="Trash" />
              <ShortcutRow keys={["Shift", "I"]} label="Mark as read" />
              <ShortcutRow keys={["Shift", "U"]} label="Mark as unread" />
              <ShortcutRow keys={["C"]} label="Compose new email" />
              <ShortcutRow keys={["X"]} label="Select / deselect" />
              <ShortcutRow keys={["/"]} label="Focus search" />
              <ShortcutRow keys={["Esc"]} label="Close thread / clear selection" />
            </Section>

            {/* General Tips */}
            <Section title="Tips">
              <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
                <li>Right-click any task or email for quick actions</li>
                <li>Drag and drop tasks between columns to reschedule</li>
                <li>Drag projects in the sidebar to reorder them</li>
                <li>Click the sync button to manually sync Calendar and Gmail</li>
              </ul>
            </Section>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-text-faint">{title}</h3>
      {children}
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <h4 className="mb-1.5 text-[13px] font-medium text-text-secondary">{title}</h4>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function HelpItem({ text, example }: { text: string; example?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-text-secondary">{text}</span>
      {example && <span className="text-xs text-text-faint">{example}</span>}
    </div>
  );
}

function ShortcutRow({ keys, label, extra }: { keys: string[]; label: string; extra?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <div className="flex items-center gap-1.5">
        {extra && <span className="mr-1 text-xs text-text-faint">{extra}</span>}
        <div className="flex items-center gap-0.5">
          {keys.map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Hook to open help dialog with ? key */
export function useHelpShortcut(onOpen: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
