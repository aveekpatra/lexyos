"use server";

/**
 * Server actions that wrap Gmail API functions for client-side use.
 * The actual implementation lives in lib/gmail-api.ts (plain module).
 * This file only re-exports as "use server" so clients can call them as RPCs.
 */
import * as api from "@/lib/gmail-api";
import type {
  GmailMessage,
  GmailThread,
  GmailLabel,
  GmailListResponse,
} from "@/lib/gmail-types";

// Re-export the GmailHistoryRecord type for gmailSync
export type { GmailHistoryRecord } from "@/lib/gmail-api";

// --- Messages ---

export async function listMessages(opts?: {
  query?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
}): Promise<GmailListResponse> {
  return api.listMessages(opts);
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
  return api.listMessagesWithDetails(opts);
}

export async function getMessage(messageId: string): Promise<GmailMessage> {
  return api.getMessage(messageId);
}

// --- Threads ---

export async function getThread(threadId: string): Promise<GmailThread> {
  return api.getThread(threadId);
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
  return api.sendMessage(opts);
}

export async function createDraft(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
}): Promise<{ id: string; messageId: string }> {
  return api.createDraft(opts);
}

// --- Modify ---

export async function modifyMessage(
  messageId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[]
): Promise<void> {
  return api.modifyMessage(messageId, addLabelIds, removeLabelIds);
}

export async function batchModifyMessages(
  messageIds: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[]
): Promise<void> {
  return api.batchModifyMessages(messageIds, addLabelIds, removeLabelIds);
}

// --- Trash / Untrash ---

export async function trashMessage(messageId: string): Promise<void> {
  return api.trashMessage(messageId);
}

export async function untrashMessage(messageId: string): Promise<void> {
  return api.untrashMessage(messageId);
}

// --- Labels ---

export async function listLabels(): Promise<GmailLabel[]> {
  return api.listLabels();
}

// --- Attachments ---

export async function getAttachment(
  messageId: string,
  attachmentId: string
): Promise<string> {
  return api.getAttachment(messageId, attachmentId);
}

// --- Convenience helpers ---

export async function archiveMessage(messageId: string): Promise<void> {
  return api.archiveMessage(messageId);
}

export async function archiveMessages(messageIds: string[]): Promise<void> {
  return api.archiveMessages(messageIds);
}

export async function markAsRead(messageId: string): Promise<void> {
  return api.markAsRead(messageId);
}

export async function markAsUnread(messageId: string): Promise<void> {
  return api.markAsUnread(messageId);
}

export async function starMessage(messageId: string): Promise<void> {
  return api.starMessage(messageId);
}

export async function unstarMessage(messageId: string): Promise<void> {
  return api.unstarMessage(messageId);
}

export async function markMessagesAsRead(messageIds: string[]): Promise<void> {
  return api.markMessagesAsRead(messageIds);
}

export async function markMessagesAsUnread(messageIds: string[]): Promise<void> {
  return api.markMessagesAsUnread(messageIds);
}

export async function trashMessages(messageIds: string[]): Promise<void> {
  return api.trashMessages(messageIds);
}

export async function starMessages(messageIds: string[]): Promise<void> {
  return api.starMessages(messageIds);
}

export async function unstarMessages(messageIds: string[]): Promise<void> {
  return api.unstarMessages(messageIds);
}

// --- Metadata ---

export async function getMessageMetadata(messageId: string) {
  return api.getMessageMetadata(messageId);
}

export async function getMessageMetadataBatch(
  messageIds: string[]
): Promise<unknown[]> {
  return api.getMessageMetadataBatch(messageIds);
}

// --- History ---

export async function getHistory(
  startHistoryId: string,
  historyTypes?: string[]
): Promise<{ history: api.GmailHistoryRecord[]; historyId: string }> {
  return api.getHistory(startHistoryId, historyTypes);
}

// --- Profile ---

export async function getProfile(): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}> {
  return api.getProfile();
}
