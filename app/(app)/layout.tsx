"use client";

import { ReactNode, useState, useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { IconType } from "react-icons";
import {
  IoFileTrayFull,
  IoCalendar,
  IoAlbums,
  IoMail,
  IoSettingsSharp,
  IoTime,
  IoHelpCircle,
  IoSyncSharp,
  IoSunny,
  IoMoon,
} from "react-icons/io5";
import { useTheme } from "@/components/ThemeProvider";
import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@/components/ui/tooltip";

import FloatingPill from "@/components/command-bar/FloatingPill";
import { ThemeSyncer } from "@/components/ThemeSyncer";
import { HelpDialog, useHelpShortcut } from "@/components/HelpDialog";

const NAV_ITEMS: { icon: IconType; label: string; href: string }[] = [
  { icon: IoFileTrayFull, label: "Inbox", href: "/timeline" },
  { icon: IoCalendar, label: "Planner", href: "/planner" },
  { icon: IoAlbums, label: "Projects", href: "/projects" },
  { icon: IoMail, label: "Mail", href: "/mail" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  useHelpShortcut(useCallback(() => setHelpOpen(true), []));

  // Sync: pull calendar changes + process pending sync queue on start and every 2 minutes
  useEffect(() => {
    const runSync = () => {
      fetch("/api/sync/pull-calendar", { method: "POST" }).catch(() => {});
      fetch("/api/sync/process-queue", { method: "POST" }).catch(() => {});
    };
    runSync();
    const interval = setInterval(runSync, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-svh gap-1.5 overflow-hidden bg-layout-shell p-1.5">
      {/* Icon rail — a floating island on the desk */}
      <aside className="flex w-14 shrink-0 flex-col items-center rounded-[24px] bg-surface-0 py-3 island">
        <div className="mb-4">
          <UserButton
            appearance={{
              elements: { avatarBox: { width: 28, height: 28 } },
            }}
          />
        </div>

        <nav className="flex flex-col items-center gap-1.5">
          {NAV_ITEMS.map((item) => (
            <RailButton
              key={item.label}
              icon={item.icon}
              label={item.label}
              isActive={pathname === item.href}
              onClick={() => router.push(item.href)}
            />
          ))}
        </nav>

        <div className="my-2.5 h-px w-6 bg-line" />
        <SyncButton />

        <div className="flex-1" />

        <nav className="flex flex-col items-center gap-1.5">
          <ThemeToggleButton />
          <RailButton icon={IoSettingsSharp} label="Settings" />
          <RailButton icon={IoTime} label="Activity" />
          <RailButton icon={IoHelpCircle} label="Help  ?" onClick={() => setHelpOpen(true)} />
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden rounded-[24px] bg-surface-0 island">
        {children}
      </main>

      {/* Sync theme preference to Convex */}
      <ThemeSyncer />
      {/* Floating AI pill — always visible, no lazy/suspense to prevent re-mount on nav */}
      <FloatingPill />
      {/* Help dialog */}
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={toggleTheme}
            className="flex size-9 items-center justify-center rounded-[13px] text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
          />
        }
      >
        {theme === "dark" ? <IoSunny size={18} /> : <IoMoon size={18} />}
      </TooltipTrigger>
      <TooltipPopup side="right">{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipPopup>
    </Tooltip>
  );
}

function RailButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: IconType;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            className={`flex size-9 items-center justify-center rounded-[13px] transition-colors ${
              isActive
                ? "bg-black/[0.06] text-foreground dark:bg-white/[0.1]"
                : "text-text-faint hover:bg-hover hover:text-text-secondary"
            }`}
          />
        }
      >
        <Icon size={19} />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const bulkUpsert = useMutation(api.tasks.bulkUpsertFromGoogle);
  const removeDeleted = useMutation(api.tasks.removeDeletedGoogleEvents);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      // Sync Calendar first, then Email (sequential to avoid Gmail rate limits).
      // runCalendarSync serializes with the planner's own sync and never infers
      // deletions from a partial fetch.
      const { runCalendarSync } = await import("@/lib/calendar-sync-client");
      const now = new Date();
      const result = await runCalendarSync(
        { from: new Date(now.getTime() - 30 * 86400000), to: new Date(now.getTime() + 60 * 86400000) },
        { bulkUpsert, removeDeleted },
      );
      if (!result.complete) {
        console.warn("Calendar sync incomplete; calendars failed:", result.failedCalendarIds);
      }
      // Also push unlinked local tasks to Google Calendar
      try {
        await fetch("/api/sync/push-all", { method: "POST" });
      } catch (err) {
        console.warn("Push-all failed:", err);
      }

      // Sync Email
      const { syncGmail } = await import("@/app/actions/gmailSync");
      const emailResult = await syncGmail(true);
      if (!emailResult.synced && emailResult.error) {
        console.warn("Email sync error:", emailResult.error);
      }
      setLastSync(new Date());
    } catch (err) {
      console.error("Manual sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [syncing, bulkUpsert, removeDeleted]);

  const tooltipText = lastSync
    ? `Last synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — Click to sync`
    : syncing ? "Syncing…" : "Sync Google Calendar & Email";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`flex size-9 items-center justify-center rounded-[13px] transition-colors ${
              syncing
                ? "text-brand"
                : "text-text-faint hover:bg-hover hover:text-text-secondary"
            }`}
          />
        }
      >
        <IoSyncSharp size={18} className={syncing ? "animate-spin" : ""} />
      </TooltipTrigger>
      <TooltipPopup side="right">{tooltipText}</TooltipPopup>
    </Tooltip>
  );
}
