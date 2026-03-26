/**
 * Core Gmail API functions — plain server-side module (NOT "use server").
 * Import this directly from other server-side code (e.g., gmailSync.ts).
 * For client-callable server actions, use app/actions/gmail.ts instead.
 */
import "server-only";
import { getGoogleAccessToken } from "@/app/actions/google-auth";
import type {
  GmailMessage,
  GmailThread,
  GmailLabel,
  GmailListResponse,
} from "@/lib/gmail-types";
import { parseGmailMessage, buildRawEmail } from "@/lib/gmail-utils";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// --- Token threading ---
// Allows callers (e.g., gmailSync) to pre-fetch the token once and reuse it
// across many API calls, avoiding repeated auth() calls that may lose context.

let _presetToken: string | null = null;

/** Set a pre-fetched token for all subsequent gmailFetch calls in this request. */
export function setGmailToken(token: string) {
  _presetToken = token;
}

/** Clear the pre-fetched token (call at end of request). */
export function clearGmailToken() {
  _presetToken = null;
}

// --- Core fetch wrapper ---

export async function gmailFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = _presetToken ?? (await getGoogleAccessToken());
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error (${res.status}): ${text}`);
  }
  return res;
}

// --- Messages ---

export async function listMessages(opts?: {
  query?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
}): Promise<GmailListResponse> {
  const params = new URLSearchParams();
  if (opts?.query) params.set("q", opts.query);
  if (opts?.labelIds) {
    for (const id of opts.labelIds) params.append("labelIds", id);
  }
  if (opts?.pageToken) params.set("pageToken", opts.pageToken);
  params.set("maxResults", String(opts?.maxResults ?? 25));

  const res = await gmailFetch(`/messages?${params}`);
  const data = await res.json();
  return {
    messages: data.messages || [],
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate || 0,
  };
}

export async function listMessagesWithDetails(opts?: {
  query?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
}): Promise<{
  messages: GmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}> {
  const list = await listMessages(opts);
  if (!list.messages.length) {
    return { messages: [], nextPageToken: list.nextPageToken, resultSizeEstimate: 0 };
  }

  const messages = await Promise.all(
    list.messages.map((m) => getMessage(m.id))
  );

  return {
    messages,
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate,
  };
}

export async function getMessage(messageId: string): Promise<GmailMessage> {
  const res = await gmailFetch(`/messages/${messageId}?format=full`);
  const raw = await res.json();
  return parseGmailMessage(raw);
}

// --- Threads ---

export async function getThread(threadId: string): Promise<GmailThread> {
  const res = await gmailFetch(`/threads/${threadId}?format=full`);
  const raw = await res.json();
  return {
    id: raw.id,
    messages: (raw.messages || []).map(parseGmailMessage),
    snippet: raw.snippet || "",
    historyId: raw.historyId || "",
  };
}

// --- Send / Draft ---

export async function sendMessage(opts: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<GmailMessage> {
  const raw = buildRawEmail(opts);
  const payload: { raw: string; threadId?: string } = { raw };
  if (opts.threadId) payload.threadId = opts.threadId;

  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return getMessage(data.id);
}

export async function createDraft(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
}): Promise<{ id: string; messageId: string }> {
  const raw = buildRawEmail(opts);
  const message: { raw: string; threadId?: string } = { raw };
  if (opts.threadId) message.threadId = opts.threadId;

  const res = await gmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  return { id: data.id, messageId: data.message?.id || "" };
}

// --- Modify labels (archive, star, read/unread) ---

export async function modifyMessage(
  messageId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[]
): Promise<void> {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: addLabelIds || [],
      removeLabelIds: removeLabelIds || [],
    }),
  });
}

export async function batchModifyMessages(
  messageIds: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[]
): Promise<void> {
  await gmailFetch("/messages/batchModify", {
    method: "POST",
    body: JSON.stringify({
      ids: messageIds,
      addLabelIds: addLabelIds || [],
      removeLabelIds: removeLabelIds || [],
    }),
  });
}

// --- Trash / Untrash ---

export async function trashMessage(messageId: string): Promise<void> {
  await gmailFetch(`/messages/${messageId}/trash`, { method: "POST" });
}

export async function untrashMessage(messageId: string): Promise<void> {
  await gmailFetch(`/messages/${messageId}/untrash`, { method: "POST" });
}

// --- Labels ---

export async function listLabels(): Promise<GmailLabel[]> {
  const res = await gmailFetch("/labels");
  const data = await res.json();
  return (data.labels || []).map(
    (l: {
      id: string;
      name: string;
      type: string;
      messagesTotal?: number;
      messagesUnread?: number;
      color?: { textColor: string; backgroundColor: string };
    }) => ({
      id: l.id,
      name: l.name,
      type: l.type as "system" | "user",
      messagesTotal: l.messagesTotal,
      messagesUnread: l.messagesUnread,
      color: l.color,
    })
  );
}

// --- Attachments ---

export async function getAttachment(
  messageId: string,
  attachmentId: string
): Promise<string> {
  const res = await gmailFetch(
    `/messages/${messageId}/attachments/${attachmentId}`
  );
  const data = await res.json();
  return data.data; // base64url encoded
}

// --- Convenience helpers ---

export async function archiveMessage(messageId: string): Promise<void> {
  await modifyMessage(messageId, undefined, ["INBOX"]);
}

export async function archiveMessages(messageIds: string[]): Promise<void> {
  await batchModifyMessages(messageIds, undefined, ["INBOX"]);
}

export async function markAsRead(messageId: string): Promise<void> {
  await modifyMessage(messageId, undefined, ["UNREAD"]);
}

export async function markAsUnread(messageId: string): Promise<void> {
  await modifyMessage(messageId, ["UNREAD"]);
}

export async function starMessage(messageId: string): Promise<void> {
  await modifyMessage(messageId, ["STARRED"]);
}

export async function unstarMessage(messageId: string): Promise<void> {
  await modifyMessage(messageId, undefined, ["STARRED"]);
}

export async function markMessagesAsRead(messageIds: string[]): Promise<void> {
  await batchModifyMessages(messageIds, undefined, ["UNREAD"]);
}

export async function markMessagesAsUnread(messageIds: string[]): Promise<void> {
  await batchModifyMessages(messageIds, ["UNREAD"]);
}

export async function trashMessages(messageIds: string[]): Promise<void> {
  await batchModifyMessages(messageIds, ["TRASH"], ["INBOX"]);
}

export async function starMessages(messageIds: string[]): Promise<void> {
  await batchModifyMessages(messageIds, ["STARRED"]);
}

export async function unstarMessages(messageIds: string[]): Promise<void> {
  await batchModifyMessages(messageIds, undefined, ["STARRED"]);
}

// --- Metadata (lightweight, for cache sync) ---

export async function getMessageMetadata(messageId: string) {
  const res = await gmailFetch(
    `/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
  );
  return await res.json();
}

export async function getMessageMetadataBatch(
  messageIds: string[]
): Promise<unknown[]> {
  return Promise.all(messageIds.map(getMessageMetadata));
}

// --- History API (incremental sync) ---

export interface GmailHistoryRecord {
  id: string;
  messages?: { id: string; threadId: string; labelIds?: string[] }[];
  messagesAdded?: { message: { id: string; threadId: string; labelIds: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] }[];
}

export async function getHistory(
  startHistoryId: string,
  historyTypes?: string[]
): Promise<{ history: GmailHistoryRecord[]; historyId: string }> {
  const params = new URLSearchParams();
  params.set("startHistoryId", startHistoryId);
  if (historyTypes) {
    for (const t of historyTypes) params.append("historyTypes", t);
  }

  const res = await gmailFetch(`/history?${params}`);
  const data = await res.json();
  return {
    history: data.history || [],
    historyId: data.historyId || startHistoryId,
  };
}

// --- Profile ---

export async function getProfile(): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}> {
  const res = await gmailFetch("/profile");
  return await res.json();
}
