"use server";

import {
  listMessages,
  getMessageMetadata,
  getHistory,
  getProfile,
  setGmailToken,
  clearGmailToken,
  type GmailHistoryRecord,
} from "@/lib/gmail-api";
import { getGoogleAccessToken } from "./google-auth";
import { getHeader, parseEmailAddress, parseEmailAddressList } from "@/lib/gmail-utils";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { auth } from "@clerk/nextjs/server";

// --- Authenticated Convex client helper ---

let _convex: ConvexHttpClient | null = null;

async function getConvex(): Promise<ConvexHttpClient> {
  if (_convex) return _convex;
  const { getToken } = await auth();
  const token = await getToken({ template: "convex" });
  if (!token) throw new Error("No Convex token");
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  _convex = client;
  return client;
}

function clearConvex() {
  _convex = null;
}

// --- Parse raw Gmail metadata response into cache format ---

function parseMetadataToCache(raw: {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    parts?: { filename?: string }[];
    filename?: string;
    mimeType?: string;
    body?: { size?: number };
  };
}) {
  const headers = raw.payload?.headers || [];
  const from = parseEmailAddress(getHeader(headers, "From"));
  const to = parseEmailAddressList(getHeader(headers, "To"));
  const labelIds = raw.labelIds || [];

  // Check if message has attachments (any part with a filename)
  let hasAttachments = false;
  function checkParts(parts: { filename?: string; parts?: { filename?: string }[] }[] | undefined) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename) { hasAttachments = true; return; }
      if ((part as { parts?: { filename?: string }[] }).parts) {
        checkParts((part as { parts: { filename?: string }[] }).parts);
      }
    }
  }
  checkParts(raw.payload?.parts as { filename?: string; parts?: { filename?: string }[] }[] | undefined);

  return {
    gmailMessageId: raw.id,
    gmailThreadId: raw.threadId,
    labelIds,
    snippet: raw.snippet || "",
    subject: getHeader(headers, "Subject") || "(no subject)",
    fromName: from.name,
    fromEmail: from.email,
    toSummary: to.map((a) => a.name || a.email).join(", "),
    date: raw.internalDate ? parseInt(raw.internalDate) : Date.now(),
    hasAttachments,
    isUnread: labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
    historyId: raw.historyId || "",
  };
}

// --- Full sync (initial, no history cursor) ---

async function performFullSync() {
  const convex = await getConvex();

  // Get profile for initial historyId anchor
  const profile = await getProfile();

  // Paginate through all messages in Gmail (including trash/spam)
  const allMessageIds: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  do {
    const listResult = await listMessages({
      maxResults: 500,
      pageToken,
      includeSpamTrash: true,
    });
    if (listResult.messages.length > 0) {
      allMessageIds.push(...listResult.messages);
    }
    pageToken = listResult.nextPageToken;
  } while (pageToken);

  if (!allMessageIds.length) {
    // No messages in Gmail — delete everything from cache
    const now = Date.now();
    await convex.mutation(api.emails.reconcile, { validGmailMessageIds: [] });
    await convex.mutation(api.emailSyncState.upsert, {
      lastHistoryId: profile.historyId,
      lastSyncedAt: now,
      lastFullSyncAt: now,
    });
    return { method: "full" as const, count: 0, historyId: profile.historyId };
  }

  // Batch fetch metadata (in small chunks to avoid Gmail rate limits)
  const CHUNK_SIZE = 10;
  const allMessages: ReturnType<typeof parseMetadataToCache>[] = [];

  for (let i = 0; i < allMessageIds.length; i += CHUNK_SIZE) {
    const chunk = allMessageIds.slice(i, i + CHUNK_SIZE);
    const metadatas = await Promise.all(
      chunk.map((m) => getMessageMetadata(m.id))
    );
    for (const raw of metadatas) {
      allMessages.push(parseMetadataToCache(raw));
    }
  }

  // Upsert into Convex (in batches of 100 to stay within mutation size limits)
  const BATCH_SIZE = 100;
  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    await convex.mutation(api.emails.bulkUpsert, {
      messages: allMessages.slice(i, i + BATCH_SIZE),
    });
  }

  // Reconcile: delete any cached emails that no longer exist in Gmail.
  // Gmail is the single source of truth.
  const validIds = allMessages.map((m) => m.gmailMessageId);
  await convex.mutation(api.emails.reconcile, { validGmailMessageIds: validIds });

  // Save sync cursor
  const now = Date.now();
  await convex.mutation(api.emailSyncState.upsert, {
    lastHistoryId: profile.historyId,
    lastSyncedAt: now,
    lastFullSyncAt: now,
  });

  return { method: "full" as const, count: allMessages.length, historyId: profile.historyId };
}

// --- Incremental sync (delta via History API) ---

async function performIncrementalSync(startHistoryId: string) {
  const convex = await getConvex();

  let result;
  try {
    result = await getHistory(startHistoryId, [
      "messageAdded",
      "messageDeleted",
      "labelAdded",
      "labelRemoved",
    ]);
  } catch (err) {
    // History expired (404) — fall back to full sync
    if (err instanceof Error && err.message.includes("404")) {
      // Clear sync state and do full sync
      await convex.mutation(api.emailSyncState.clear, {});
      return performFullSync();
    }
    throw err;
  }

  const { history, historyId } = result;

  // Process history records
  const newMessageIds = new Set<string>();
  const deletedMessageIds = new Set<string>();
  const labelUpdates: Map<string, { id: string; labelIds: string[] }> = new Map();

  for (const record of history) {
    // Messages added
    if (record.messagesAdded) {
      for (const added of record.messagesAdded) {
        newMessageIds.add(added.message.id);
        deletedMessageIds.delete(added.message.id);
      }
    }

    // Messages deleted
    if (record.messagesDeleted) {
      for (const deleted of record.messagesDeleted) {
        deletedMessageIds.add(deleted.message.id);
        newMessageIds.delete(deleted.message.id);
      }
    }

    // Labels added/removed — we just re-fetch metadata for affected messages
    if (record.labelsAdded) {
      for (const item of record.labelsAdded) {
        if (!deletedMessageIds.has(item.message.id)) {
          labelUpdates.set(item.message.id, {
            id: item.message.id,
            labelIds: item.message.labelIds,
          });
        }
      }
    }
    if (record.labelsRemoved) {
      for (const item of record.labelsRemoved) {
        if (!deletedMessageIds.has(item.message.id)) {
          labelUpdates.set(item.message.id, {
            id: item.message.id,
            labelIds: item.message.labelIds,
          });
        }
      }
    }
  }

  // Fetch metadata for new messages
  if (newMessageIds.size > 0) {
    const ids = Array.from(newMessageIds);
    const metadatas = await Promise.all(
      ids.map((id) => getMessageMetadata(id))
    );
    const parsed = metadatas.map(parseMetadataToCache);
    if (parsed.length > 0) {
      await convex.mutation(api.emails.bulkUpsert, { messages: parsed });
    }
  }

  // Delete removed messages
  if (deletedMessageIds.size > 0) {
    await convex.mutation(api.emails.bulkDelete, {
      gmailMessageIds: Array.from(deletedMessageIds),
    });
  }

  // Update labels for changed messages
  if (labelUpdates.size > 0) {
    const updates = Array.from(labelUpdates.values()).map((item) => ({
      gmailMessageId: item.id,
      labelIds: item.labelIds,
      isUnread: item.labelIds.includes("UNREAD"),
      isStarred: item.labelIds.includes("STARRED"),
    }));
    await convex.mutation(api.emails.bulkUpdateLabels, { updates });
  }

  // Update sync cursor
  await convex.mutation(api.emailSyncState.upsert, {
    lastHistoryId: historyId,
    lastSyncedAt: Date.now(),
  });

  return {
    method: "incremental" as const,
    added: newMessageIds.size,
    deleted: deletedMessageIds.size,
    labelUpdates: labelUpdates.size,
    historyId,
  };
}

// --- Main sync entry point ---

export async function syncGmail(forceFullSync = false): Promise<{
  synced: boolean;
  method: "full" | "incremental";
  error?: string;
}> {
  try {
    // Check auth
    const { userId } = await auth();
    if (!userId) return { synced: false, method: "full", error: "Not authenticated" };

    // Pre-fetch the Google OAuth token BEFORE any Convex calls,
    // because ConvexHttpClient calls may interfere with the request context.
    const googleToken = await getGoogleAccessToken();
    setGmailToken(googleToken);

    try {
      const convex = await getConvex();
      const syncState = await convex.query(api.emailSyncState.get, {});

      if (!syncState?.lastHistoryId || forceFullSync) {
        // Full sync: first time or manually forced
        const result = await performFullSync();
        return { synced: true, method: result.method };
      } else {
        // Incremental sync: fast, uses History API
        const result = await performIncrementalSync(syncState.lastHistoryId);
        return { synced: true, method: result.method };
      }
    } finally {
      clearGmailToken();
      clearConvex();
    }
  } catch (err) {
    console.error("Gmail sync error:", err);
    return {
      synced: false,
      method: "full",
      error: err instanceof Error ? err.message : "Sync failed",
    };
  }
}
