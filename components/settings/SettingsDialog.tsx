"use client";

import { useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import type { IconType } from "react-icons";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { glassIconButton } from "@/lib/ui/chrome";
import {
  IoClose, IoPersonCircle, IoSettings, IoKeypad, IoCalendar, IoAlarm, IoTimer,
  IoMail, IoLink, IoSparkles, IoStatsChart, IoLogOut,
} from "react-icons/io5";
import { AccountSection } from "./sections/AccountSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { CalendarAccountsSection } from "./sections/CalendarAccountsSection";
import { DueDatesSection } from "./sections/DueDatesSection";
import { PomodoroSection } from "./sections/PomodoroSection";
import { AnalyticsSection } from "./sections/AnalyticsSection";
import { EmailForwardingSection } from "./sections/EmailForwardingSection";
import { McpSection } from "./sections/McpSection";
import { AiSection } from "./sections/AiSection";

/*
 * Full settings, as a sheet: a grey nav rail on the left (the app sidebar in
 * miniature) and a white content pane on the right. Sections are a registry,
 * so a new area is one entry plus one file under ./sections.
 */

export type SectionId =
  | "account" | "general" | "shortcuts" | "calendars"
  | "due-dates" | "pomodoro" | "analytics" | "email" | "mcp" | "ai";

const NAV: { group: string; items: { id: SectionId; label: string; icon: IconType }[] }[] = [
  { group: "You", items: [{ id: "account", label: "Account", icon: IoPersonCircle }] },
  {
    group: "App",
    items: [
      { id: "general", label: "General", icon: IoSettings },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: IoKeypad },
      { id: "calendars", label: "Calendar accounts", icon: IoCalendar },
    ],
  },
  {
    group: "Tools",
    items: [
      { id: "due-dates", label: "Due dates", icon: IoAlarm },
      { id: "pomodoro", label: "Pomodoro timer", icon: IoTimer },
      { id: "analytics", label: "Analytics", icon: IoStatsChart },
      { id: "email", label: "Email forwarding", icon: IoMail },
      { id: "mcp", label: "MCP and API access", icon: IoLink },
      { id: "ai", label: "AI assistant", icon: IoSparkles },
    ],
  },
];

const TITLES: Record<SectionId, string> = {
  account: "Account", general: "General", shortcuts: "Keyboard shortcuts", calendars: "Calendar accounts", "due-dates": "Due dates",
  pomodoro: "Pomodoro timer", analytics: "Analytics", email: "Email forwarding", mcp: "MCP and API access", ai: "AI assistant",
};

export function SettingsDialog({ open, onOpenChange, onOpenGoogle, initialSection = "general" }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenGoogle: () => void;
  initialSection?: SectionId;
}) {
  const [section, setSection] = useState<SectionId>(initialSection);
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="!max-w-[1040px] overflow-hidden !rounded-[24px] !p-0" showCloseButton={false} bottomStickOnMobile={false}>
        <div className="flex h-[min(760px,88vh)]">
          {/* Nav rail */}
          <nav className="flex w-[248px] shrink-0 flex-col bg-surface-2">
            <div className="flex items-center gap-2.5 px-4 pb-3 pt-5">
              {user?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.imageUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/[0.08] text-[12px] font-semibold text-text-secondary">{(user?.firstName ?? "?").slice(0, 1)}</span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-text-strong">{user?.firstName || user?.username || "You"}</span>
                <span className="block truncate text-[11.5px] text-text-muted">{user?.primaryEmailAddress?.emailAddress}</span>
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {NAV.map((g) => (
                <div key={g.group} className="mt-3">
                  <div className="mb-1 px-3.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-faint">{g.group}</div>
                  <div className="flex flex-col gap-0.5">
                    {g.items.map((it) => {
                      const active = section === it.id;
                      return (
                        <button
                          key={it.id}
                          onClick={() => setSection(it.id)}
                          aria-current={active ? "page" : undefined}
                          className={`flex h-9 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-[13.5px] font-medium transition-colors ${
                            active ? "bg-black/[0.07] text-text-strong dark:bg-white/[0.1]" : "text-text-secondary hover:bg-black/[0.05] hover:text-text-strong dark:hover:bg-white/[0.06]"
                          }`}
                        >
                          <it.icon className="size-[17px] shrink-0" />
                          <span className="truncate">{it.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-3 pb-3">
              <button
                onClick={() => signOut({ redirectUrl: "/" })}
                className="flex h-9 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-black/[0.05] hover:text-text-strong dark:hover:bg-white/[0.06]"
              >
                <IoLogOut className="size-[17px]" />
                Log out
              </button>
            </div>
          </nav>

          {/* Content */}
          <div className="flex min-w-0 flex-1 flex-col bg-surface-0">
            <div className="flex h-14 shrink-0 items-center justify-between px-6">
              <DialogTitle className="text-[16px] font-semibold tracking-[-0.01em] text-text-strong">{TITLES[section]}</DialogTitle>
              <button onClick={() => onOpenChange(false)} aria-label="Close" className={glassIconButton}>
                <IoClose className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <div className="mx-auto flex max-w-[640px] flex-col gap-6">
                {section === "account" && <AccountSection />}
                {section === "general" && <GeneralSection />}
                {section === "shortcuts" && <ShortcutsSection />}
                {section === "calendars" && <CalendarAccountsSection onOpenGoogle={onOpenGoogle} />}
                {section === "due-dates" && <DueDatesSection />}
                {section === "pomodoro" && <PomodoroSection />}
                {section === "analytics" && <AnalyticsSection />}
                {section === "email" && <EmailForwardingSection />}
                {section === "mcp" && <McpSection />}
                {section === "ai" && <AiSection />}
              </div>
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
