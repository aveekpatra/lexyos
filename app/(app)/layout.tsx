"use client";

import { ReactNode, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InboxIcon,
  Calendar01Icon,
  FolderLibraryIcon,
  Mail01Icon,
  Settings01Icon,
  Clock01Icon,
  HelpCircleIcon,
  Search01Icon,
  Refresh01Icon,
  Sun01Icon,
  Moon02Icon,
} from "@hugeicons/core-free-icons";
import { useTheme } from "@/components/ThemeProvider";
import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@/components/ui/tooltip";

import FloatingPill from "@/components/command-bar/FloatingPill";
import { ThemeSyncer } from "@/components/ThemeSyncer";

const NAV_ITEMS = [
  { icon: InboxIcon, label: "Inbox", href: "/timeline" },
  { icon: Calendar01Icon, label: "Planner", href: "/planner" },
  { icon: FolderLibraryIcon, label: "Projects", href: "/projects" },
  { icon: Mail01Icon, label: "Mail", href: "/mail" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex h-svh overflow-hidden">
      {/* Icon rail */}
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-line bg-surface-0 py-3">
        <div className="mb-4">
          <UserButton
            appearance={{
              elements: { avatarBox: { width: 28, height: 28 } },
            }}
          />
        </div>

        <nav className="flex flex-col items-center gap-1">
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

        <div className="my-2 h-px w-6 bg-line" />
        <SyncButton />

        <div className="flex-1" />

        <nav className="flex flex-col items-center gap-1">
          <ThemeToggleButton />
          <RailButton icon={Settings01Icon} label="Settings" />
          <RailButton icon={Clock01Icon} label="Activity" />
          <RailButton icon={HelpCircleIcon} label="Help" />
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Sync theme preference to Convex */}
      <ThemeSyncer />
      {/* Floating AI pill — always visible, no lazy/suspense to prevent re-mount on nav */}
      <FloatingPill />
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
            className="flex size-9 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-surface-1 hover:text-text-secondary"
          />
        }
      >
        <HugeiconsIcon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={18} />
      </TooltipTrigger>
      <TooltipPopup side="right">{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipPopup>
    </Tooltip>
  );
}

function RailButton({
  icon,
  label,
  isActive,
  onClick,
}: {
  icon: typeof InboxIcon;
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
            className={`flex size-9 items-center justify-center rounded-lg transition-all ${
              isActive
                ? "border border-blue-200 bg-blue-100 text-blue-700 shadow-3d dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-400"
                : "border border-transparent text-text-faint hover:border-line hover:bg-surface-1 hover:text-text-secondary hover:shadow-3d-sm"
            }`}
          />
        }
      >
        <HugeiconsIcon icon={icon} size={18} />
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
      // Sync Calendar first, then Email (sequential to avoid Gmail rate limits)
      const { fetchGoogleEventsForSync } = await import("@/app/actions/calendarSync");
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date();
      const timeMin = new Date(now.getTime() - 30 * 86400000).toISOString();
      const timeMax = new Date(now.getTime() + 60 * 86400000).toISOString();
      const events = await fetchGoogleEventsForSync(timeMin, timeMax, tz);
      if (events.length > 0) {
        await bulkUpsert({ events });
      }
      const knownIds = events.map((e) => e.googleEventId);
      await removeDeleted({
        knownGoogleEventIds: knownIds,
        syncRangeStart: timeMin.slice(0, 10),
        syncRangeEnd: timeMax.slice(0, 10),
      });
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
            className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
              syncing
                ? "text-brand"
                : "text-text-faint hover:bg-surface-1 hover:text-text-secondary"
            }`}
          />
        }
      >
        <HugeiconsIcon
          icon={Refresh01Icon}
          size={18}
          className={syncing ? "animate-spin" : ""}
        />
      </TooltipTrigger>
      <TooltipPopup side="right">{tooltipText}</TooltipPopup>
    </Tooltip>
  );
}
