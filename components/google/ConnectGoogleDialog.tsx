"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "@/components/ui/dialog";
import { bluePill, softPill } from "@/lib/ui/chrome";
import {
  IoLogoGoogle,
} from "react-icons/io5";

const SNOOZE_KEY = "unifocus:google-connect:snoozed-until";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export type GoogleStatus =
  | { connected: false }
  | { connected: true; email?: string; connectedAt: number; needsReconnect: boolean; lastError?: string };

/** Live connection status; `undefined` while loading. */
export function useGoogleConnection(): GoogleStatus | undefined {
  return useQuery(api.googleConnections.status, {}) as GoogleStatus | undefined;
}

function readSnoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

/**
 * Prompts to connect Google Calendar. Opens on its own when the account is
 * missing or broken (once per day unless dismissed), and can be forced open
 * from the sidebar via `open`.
 */
export function ConnectGoogleDialog({
  open: forcedOpen,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useGoogleConnection();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [autoOpen, setAutoOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const result = params.get("google");
  const reason = params.get("reason");

  // Auto-open when not connected (or needs reconnect) and not snoozed.
  useEffect(() => {
    if (status === undefined) return;
    const broken = !status.connected || status.needsReconnect;
    setAutoOpen(broken && !readSnoozed());
  }, [status]);

  // Clear the ?google=... marker once we have shown it.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => router.replace(pathname), 4000);
    return () => clearTimeout(t);
  }, [result, pathname, router]);

  const open = forcedOpen || autoOpen;
  const close = (snooze: boolean) => {
    if (snooze) {
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    }
    setAutoOpen(false);
    onOpenChange(false);
  };

  const connected = status?.connected === true;
  const needsReconnect = connected && status.needsReconnect;

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/google/disconnect", { method: "POST" });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-lg">
            {connected && !needsReconnect ? "Google Calendar" : needsReconnect ? "Reconnect Google Calendar" : "Connect Google Calendar"}
          </DialogTitle>
          <DialogDescription>
            {connected && !needsReconnect
              ? `Connected as ${status.email ?? "your Google account"}. Tasks with a date sync both ways.`
              : needsReconnect
                ? "Google stopped accepting the saved connection. Connect again to resume syncing."
                : "Mindbook mirrors dated tasks to your calendar and pulls events back in. Nothing syncs until an account is connected."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {result === "error" && (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              Connection failed{reason ? `: ${reason}` : ""}.
            </p>
          )}
          {result === "connected" && (
            <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              Connected. First sync is running.
            </p>
          )}
          {needsReconnect && status.lastError && (
            <p className="mb-3 truncate text-[12px] text-text-faint" title={status.lastError}>{status.lastError}</p>
          )}
          <ul className="flex flex-col gap-1.5 text-[13px] text-text-secondary">
            <li>Read and write events on your calendars</li>
            <li>See which Google account is connected</li>
            <li>Tokens are stored encrypted and can be revoked here any time</li>
          </ul>
        </DialogPanel>
        <DialogFooter>
          {connected ? (
            <>
              <button onClick={disconnect} disabled={disconnecting} className={`${softPill} text-rose-600 disabled:opacity-50`}>
                {disconnecting ? "Disconnecting" : "Disconnect"}
              </button>
              <a href="/api/google/connect" className={bluePill}>
                <IoLogoGoogle className="size-3.5" />
                {needsReconnect ? "Reconnect" : "Switch account"}
              </a>
            </>
          ) : (
            <>
              <button onClick={() => close(true)} className={softPill}>Not now</button>
              <a href="/api/google/connect" className={bluePill}>
                <IoLogoGoogle className="size-3.5" />
                Connect Google
              </a>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
