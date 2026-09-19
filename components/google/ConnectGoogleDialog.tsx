"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google-oauth";
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

/*
 * Google Calendar access comes from the Clerk Google sign-in. The status is
 * read from the server (which asks Clerk) and shared by every subscriber.
 */
let cached: GoogleStatus | undefined;
const listeners = new Set<(s: GoogleStatus) => void>();
let inflight: Promise<void> | null = null;

export function refreshGoogleConnection(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/google/status")
    .then((r) => r.json())
    .then((s: GoogleStatus) => { cached = s; listeners.forEach((l) => l(s)); })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

/** Live connection status; `undefined` while loading. Re-checked on focus and every 5 minutes. */
export function useGoogleConnection(): GoogleStatus | undefined {
  const [status, setStatus] = useState<GoogleStatus | undefined>(cached);
  useEffect(() => {
    listeners.add(setStatus);
    if (!cached) void refreshGoogleConnection();
    const onFocus = () => void refreshGoogleConnection();
    window.addEventListener("focus", onFocus);
    const id = setInterval(onFocus, 5 * 60 * 1000);
    return () => { listeners.delete(setStatus); window.removeEventListener("focus", onFocus); clearInterval(id); };
  }, []);
  return status;
}

/**
 * Sends the browser through Google consent for the calendar scope, on the
 * Clerk-linked Google account (or links one). Returns to `/timeline?google=connected`.
 */
export function useConnectGoogle() {
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const redirectUrl = `${window.location.origin}/timeline?google=connected`;
      const existing = user.externalAccounts.find((a) => a.provider === "google");
      const account = existing
        ? await existing.reauthorize({ additionalScopes: [GOOGLE_CALENDAR_SCOPE], redirectUrl })
        : await user.createExternalAccount({ strategy: "oauth_google", additionalScopes: [GOOGLE_CALENDAR_SCOPE], redirectUrl });
      const url = account.verification?.externalVerificationRedirectURL;
      if (url) window.location.href = url.toString();
      else setBusy(false);
    } catch (err) {
      console.error("[google] connect failed", err);
      setBusy(false);
    }
  };
  return { connect, busy };
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
  const [snoozed, setSnoozed] = useState<boolean>(() => (typeof window === "undefined" ? true : readSnoozed()));
  const { connect, busy } = useConnectGoogle();

  const result = params.get("google");
  const reason = params.get("reason");

  // Auto-open when not connected (or needs reconnect) and not snoozed.
  const autoOpen = status !== undefined && (!status.connected || status.needsReconnect) && !snoozed;

  // Clear the ?google=... marker once we have shown it, and re-check the connection.
  useEffect(() => {
    if (!result) return;
    void refreshGoogleConnection();
    const t = setTimeout(() => router.replace(pathname), 4000);
    return () => clearTimeout(t);
  }, [result, pathname, router]);

  const open = forcedOpen || autoOpen;
  const close = (snooze: boolean) => {
    if (snooze) {
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    }
    setSnoozed(true);
    onOpenChange(false);
  };

  const connected = status?.connected === true;
  const needsReconnect = connected && status.needsReconnect;

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
            <li>Uses the Google account you sign in with</li>
            <li>Revoke any time from your Google account permissions</li>
          </ul>
        </DialogPanel>
        <DialogFooter>
          {connected ? (
            <>
              <button onClick={() => close(false)} className={softPill}>Close</button>
              {needsReconnect && (
                <button onClick={connect} disabled={busy} className={`${bluePill} disabled:opacity-50`}>
                  <IoLogoGoogle className="size-3.5" />
                  {busy ? "Opening Google" : "Grant calendar access"}
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => close(true)} className={softPill}>Not now</button>
              <button onClick={connect} disabled={busy} className={`${bluePill} disabled:opacity-50`}>
                <IoLogoGoogle className="size-3.5" />
                {busy ? "Opening Google" : "Connect Google"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
