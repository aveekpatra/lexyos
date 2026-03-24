"use client";

import { ReactNode, lazy, Suspense, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InboxIcon,
  Calendar01Icon,
  FolderLibraryIcon,
  Settings01Icon,
  Clock01Icon,
  HelpCircleIcon,
  Search01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@/components/ui/tooltip";

const FloatingPill = lazy(() => import("@/components/command-bar/FloatingPill"));

const NAV_ITEMS = [
  { icon: InboxIcon, label: "Inbox", href: "/timeline" },
  { icon: Calendar01Icon, label: "Planner", href: "/planner" },
  { icon: FolderLibraryIcon, label: "Projects", href: "/projects" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex h-svh overflow-hidden">
      {/* Icon rail */}
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-[#1f1f25] bg-[#0c0c0f] py-3">
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

        <div className="my-2 h-px w-6 bg-[#1f1f28]" />
        <SyncButton />

        <div className="flex-1" />

        <nav className="flex flex-col items-center gap-1">
          <RailButton icon={Settings01Icon} label="Settings" />
          <RailButton icon={Clock01Icon} label="Activity" />
          <RailButton icon={HelpCircleIcon} label="Help" />
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Floating AI pill — always visible */}
      <Suspense fallback={null}>
        <FloatingPill />
      </Suspense>
    </div>
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
            className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
              isActive
                ? "bg-[#1f1f28] text-white"
                : "text-[#52525b] hover:bg-[#18181d] hover:text-[#a1a1aa]"
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
      const { fetchGoogleEventsForSync } = await import("@/app/actions/calendarSync");
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Sync 30 days back and 60 days forward
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
      setLastSync(new Date());
    } catch (err) {
      console.error("Manual sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [syncing, bulkUpsert, removeDeleted]);

  const tooltipText = lastSync
    ? `Last synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — Click to sync`
    : syncing ? "Syncing…" : "Sync with Google Calendar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
              syncing
                ? "text-[#a78bfa]"
                : "text-[#52525b] hover:bg-[#18181d] hover:text-[#a1a1aa]"
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
