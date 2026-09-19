"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section, Row, Tag } from "../primitives";
import { useGoogleConnection } from "@/components/google/ConnectGoogleDialog";
import { softPill, bluePill } from "@/lib/ui/chrome";
import { formatDistanceToNow } from "date-fns";
import { IoLogoGoogle, IoLogoApple, IoLogoMicrosoft, IoSync } from "react-icons/io5";

export function CalendarAccountsSection({ onOpenGoogle }: { onOpenGoogle: () => void }) {
  const google = useGoogleConnection();
  const syncStates = useQuery(api.calendarEvents.getSyncState, {});
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const connected = google?.connected === true;

  const syncNow = async () => {
    setSyncing(true);
    try { await Promise.all([fetch("/api/sync/pull-calendar", { method: "POST" }), fetch("/api/sync/process-queue", { method: "POST" })]); }
    finally { setSyncing(false); }
  };
  const disconnect = async () => {
    setDisconnecting(true);
    try { await fetch("/api/google/disconnect", { method: "POST" }); } finally { setDisconnecting(false); }
  };

  return (
    <>
      <Section title="Connected" description="Dated tasks go to your calendar. Events come back as tasks.">
        <Row
          label={connected ? (google.email ?? "Google Calendar") : "Google Calendar"}
          hint={connected ? (google.needsReconnect ? "Google rejected the saved connection. Reconnect to resume." : `Connected ${formatDistanceToNow(google.connectedAt, { addSuffix: true })}`) : "Not connected"}
          icon={<IoLogoGoogle className="size-4" />}
        >
          <span className="flex items-center gap-1.5">
            {connected && !google.needsReconnect ? (
              <>
                <button onClick={syncNow} disabled={syncing} className={`${softPill} disabled:opacity-50`}><IoSync className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />Sync</button>
                <button onClick={onOpenGoogle} className={softPill}>Details</button>
                <button onClick={disconnect} disabled={disconnecting} className={`${softPill} text-rose-600 disabled:opacity-50`}>{disconnecting ? "Removing" : "Remove"}</button>
              </>
            ) : (
              <a href="/api/google/connect" className={bluePill}><IoLogoGoogle className="size-3.5" />{connected ? "Reconnect" : "Connect"}</a>
            )}
          </span>
        </Row>
        {connected && (syncStates ?? []).map((s) => (
          <Row key={s._id} label={s.calendarName ?? s.googleCalendarId} hint={`Last pulled ${formatDistanceToNow(s.lastSyncedAt, { addSuffix: true })}`}
            icon={<span className="size-3 rounded-full" style={{ backgroundColor: s.calendarColor ?? "#71717a" }} />} />
        ))}
      </Section>

      <Section title="Add another" description="One Google account today. Other providers are on the list.">
        <Row label="Apple Calendar" hint="Via iCloud CalDAV" icon={<IoLogoApple className="size-4" />}><Tag>Planned</Tag></Row>
        <Row label="Outlook" hint="Microsoft 365 and Outlook.com" icon={<IoLogoMicrosoft className="size-4" />}><Tag>Planned</Tag></Row>
      </Section>
    </>
  );
}
