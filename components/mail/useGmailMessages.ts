import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { syncGmail } from "@/app/actions/gmailSync";
import { listLabels } from "@/app/actions/gmail";
import type { GmailLabel } from "@/lib/gmail-types";

export function useGmailMessages(opts: {
  labelFilter?: string;
  searchQuery?: string;
}) {
  // Read from Convex cache (reactive — auto-updates when mutations fire)
  const cachedEmails = opts.searchQuery
    ? useQuery(api.emails.search, { query: opts.searchQuery })
    : useQuery(api.emails.list, {
        labelFilter: opts.labelFilter || undefined,
      });

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const hasSynced = useRef(false);

  // Sync on mount (once)
  useEffect(() => {
    if (hasSynced.current) return;
    hasSynced.current = true;
    performSync();
  }, []);

  const performSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncGmail();
      console.log("[Gmail sync]", result);
      if (!result.synced && result.error) {
        setSyncError(result.error);
      }
    } catch (err) {
      console.error("[Gmail sync] exception:", err);
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  return {
    messages: cachedEmails ?? [],
    loading: cachedEmails === undefined,
    syncing,
    syncError,
    refresh: performSync,
  };
}

export function useGmailLabels() {
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listLabels()
      .then(setLabels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { labels, loading };
}

export function useUnreadCount() {
  return useQuery(api.emails.unreadCount) ?? 0;
}
