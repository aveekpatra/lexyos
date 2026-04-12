"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Letter } from "react-letter";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Archive01Icon,
  Delete02Icon,
  Mail01Icon,
  Task01Icon,
  MailReply01Icon,
  MailReplyAll01Icon,
  Forward01Icon,
  Attachment01Icon,
  StarIcon,
  Link01Icon,
} from "@hugeicons/core-free-icons";
import type { GmailThread as GmailThreadType, GmailMessage } from "@/lib/gmail-types";
import { relativeDate, formatFileSize } from "@/lib/gmail-utils";
import { getThread, archiveMessage, trashMessage, markAsRead, markAsUnread, starMessage, unstarMessage, getAttachment } from "@/app/actions/gmail";

interface MailThreadProps {
  threadId: string;
  onBack: () => void;
  onReply: (message: GmailMessage) => void;
  onReplyAll: (message: GmailMessage) => void;
  onForward: (message: GmailMessage) => void;
  onConvertToTask: (message: GmailMessage, thread: GmailThreadType) => void;
  onRefreshList: () => void;
}

export default function MailThread({
  threadId,
  onBack,
  onReply,
  onReplyAll,
  onForward,
  onConvertToTask,
  onRefreshList,
}: MailThreadProps) {
  const updateLabels = useMutation(api.emails.updateLabels);
  const [thread, setThread] = useState<GmailThreadType | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setThread(null);
    getThread(threadId)
      .then((t) => {
        setThread(t);
        // Expand the last message by default
        if (t.messages.length > 0) {
          setExpandedIds(new Set([t.messages[t.messages.length - 1].id]));
        }
        // Mark all unread messages as read
        for (const msg of t.messages) {
          if (msg.isUnread) {
            updateLabels({
              gmailMessageId: msg.id,
              removeLabelIds: ["UNREAD"],
            }).catch(() => {});
            markAsRead(msg.id).catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [threadId, updateLabels]);

  const toggleExpand = useCallback((msgId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const threadAction = useCallback(
    async (
      addLabels: string[] | undefined,
      removeLabels: string[] | undefined,
      gmailAction: (msgId: string) => Promise<void>
    ) => {
      if (!thread) return;
      for (const msg of thread.messages) {
        updateLabels({
          gmailMessageId: msg.id,
          addLabelIds: addLabels,
          removeLabelIds: removeLabels,
        }).catch(() => {});
      }
      onBack();
      for (const msg of thread.messages) {
        gmailAction(msg.id).catch(() => {});
      }
    },
    [thread, onBack, updateLabels]
  );

  const handleArchive = useCallback(
    () => threadAction(undefined, ["INBOX"], archiveMessage),
    [threadAction]
  );

  const handleTrash = useCallback(
    () => threadAction(["TRASH"], ["INBOX"], trashMessage),
    [threadAction]
  );

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="h-4 w-48 animate-pulse rounded bg-line" />
        </div>
        <div className="flex-1 p-6">
          <div className="mb-6 h-6 w-2/3 animate-pulse rounded bg-line/60" />
          <div className="mb-4 h-4 w-1/3 animate-pulse rounded bg-line/40" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-line/30" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-line/30" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-line/30" />
          </div>
        </div>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-text-faint">
        Failed to load thread
      </div>
    );
  }

  const subject = thread.messages[0]?.subject || "(no subject)";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-line/60 hover:text-foreground"
          title="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={1.5} />
        </button>

        <h2 className="ml-2 min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
          {subject}
        </h2>

        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={Archive01Icon} label="Archive" onClick={handleArchive} />
          <ToolbarButton icon={Delete02Icon} label="Trash" onClick={handleTrash} />
          <ToolbarButton
            icon={Mail01Icon}
            label="Mark unread"
            onClick={() => {
              const last = thread.messages[thread.messages.length - 1];
              if (last) {
                updateLabels({ gmailMessageId: last.id, addLabelIds: ["UNREAD"] }).catch(() => {});
                markAsUnread(last.id).catch(() => {});
              }
            }}
          />
          <ToolbarButton
            icon={Task01Icon}
            label="Convert to task"
            onClick={() => {
              const last = thread.messages[thread.messages.length - 1];
              if (last) onConvertToTask(last, thread);
            }}
          />
        </div>
      </div>

      {/* Thread content — always light so HTML emails render correctly */}
      <div className="email-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Messages */}
        <div className="flex flex-col divide-y divide-gray-200 pb-24">
          {thread.messages.map((msg, i) => (
            <ThreadMessage
              key={msg.id}
              message={msg}
              isExpanded={expandedIds.has(msg.id)}
              onToggle={() => toggleExpand(msg.id)}
              onReply={() => onReply(msg)}
              onReplyAll={() => onReplyAll(msg)}
              onForward={() => onForward(msg)}
              onToggleStar={async () => {
                if (msg.isStarred) {
                  updateLabels({ gmailMessageId: msg.id, removeLabelIds: ["STARRED"] }).catch(() => {});
                  await unstarMessage(msg.id).catch(() => {});
                } else {
                  updateLabels({ gmailMessageId: msg.id, addLabelIds: ["STARRED"] }).catch(() => {});
                  await starMessage(msg.id).catch(() => {});
                }
                // Refresh thread to reflect change
                getThread(threadId).then(setThread).catch(() => {});
              }}
              onMarkUnread={async () => {
                updateLabels({ gmailMessageId: msg.id, addLabelIds: ["UNREAD"] }).catch(() => {});
                await markAsUnread(msg.id).catch(() => {});
              }}
              onCopyLink={() => {
                const url = `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`;
                navigator.clipboard.writeText(url);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Toolbar button ---

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: typeof Archive01Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-line/60 hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  );
}

// --- Individual message ---

function ThreadMessage({
  message,
  isExpanded,
  onToggle,
  onReply,
  onReplyAll,
  onForward,
  onToggleStar,
  onMarkUnread,
  onCopyLink,
}: {
  message: GmailMessage;
  isExpanded: boolean;
  onToggle: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onToggleStar: () => void;
  onMarkUnread: () => void;
  onCopyLink: () => void;
}) {
  const initials = (message.from.name || message.from.email)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Collapsed state — compact single row
  if (!isExpanded) {
    return (
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-3 px-6 py-3 transition-colors hover:bg-surface-1"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-[12px] font-medium text-blue-600 ">
          {initials}
        </div>
        <span className="text-[14px] font-medium text-text-strong">
          {message.from.name || message.from.email}
        </span>
        <span className="text-[12px] text-text-muted">
          {relativeDate(message.date)}
        </span>
        <p className="ml-2 min-w-0 flex-1 truncate text-[13px] text-text-muted">
          {message.snippet}
        </p>
      </div>
    );
  }

  // Expanded state
  return (
    <div className="flex flex-col px-6 py-4">
      {/* Sender info */}
      <div className="flex items-start gap-3">
        <div
          onClick={onToggle}
          className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-blue-100 text-[13px] font-medium text-blue-600 "
        >
          {initials}
        </div>
        <div onClick={onToggle} className="min-w-0 flex-1 cursor-pointer">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-foreground">
              {message.from.name || message.from.email}
            </span>
            <span className="text-[12px] text-text-muted">
              {relativeDate(message.date)}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-text-muted">
            To: {message.to.map((a) => a.name || a.email).join(", ")}
            {message.cc.length > 0 && (
              <span> &middot; Cc: {message.cc.map((a) => a.name || a.email).join(", ")}</span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            onClick={onToggleStar}
            title={message.isStarred ? "Unstar" : "Star"}
            className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-line/60"
          >
            <HugeiconsIcon
              icon={StarIcon}
              size={15}
              strokeWidth={1.5}
              className={message.isStarred ? "fill-[#eab308] text-[#eab308]" : "text-text-muted"}
            />
          </button>
          <button
            onClick={onMarkUnread}
            title="Mark unread"
            className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-line/60 hover:text-foreground"
          >
            <HugeiconsIcon icon={Mail01Icon} size={15} strokeWidth={1.5} />
          </button>
          <button
            onClick={onCopyLink}
            title="Copy link"
            className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-line/60 hover:text-foreground"
          >
            <HugeiconsIcon icon={Link01Icon} size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Email body */}
      <div className="mt-4 pl-12">
        <div className="email-body text-[14px] leading-normal text-foreground">
          <Letter
            html={message.bodyHtml || ""}
            text={message.bodyText || ""}
            rewriteExternalLinks={(url) => url}
            allowedSchemas={["http", "https", "mailto"]}
          />
        </div>

        {/* Attachments */}
        {message.attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.attachments.map((att, i) => (
              <AttachmentButton key={i} messageId={message.id} attachment={att} />
            ))}
          </div>
        )}

        {/* Reply actions */}
        <div className="mt-4 flex gap-1.5">
          <ReplyButton icon={MailReply01Icon} label="Reply" onClick={onReply} />
          <ReplyButton icon={MailReplyAll01Icon} label="Reply all" onClick={onReplyAll} />
          <ReplyButton icon={Forward01Icon} label="Forward" onClick={onForward} />
        </div>
      </div>
    </div>
  );
}

function AttachmentButton({ messageId, attachment: att }: {
  messageId: string;
  attachment: { attachmentId: string; filename: string; mimeType: string; size: number };
}) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done">("idle");

  async function handleDownload() {
    if (status === "downloading") return;
    setStatus("downloading");
    try {
      const base64url = await getAttachment(messageId, att.attachmentId);
      const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
      const byteChars = atob(base64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let j = 0; j < byteChars.length; j++) {
        byteArray[j] = byteChars.charCodeAt(j);
      }
      const blob = new Blob([byteArray], { type: att.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to download attachment:", err);
      setStatus("idle");
    }
  }

  return (
    <button
      onClick={handleDownload}
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-[13px] transition-colors ${
        status === "downloading"
          ? "bg-blue-50 text-blue-600"
          : status === "done"
            ? "bg-green-50 text-green-700"
            : "text-text-secondary hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100"
      }`}
    >
      <HugeiconsIcon icon={Attachment01Icon} size={13} strokeWidth={1.5} />
      <span className="truncate">{att.filename}</span>
      <span className="flex-shrink-0 text-[11px] text-text-faint">
        {status === "downloading" ? "Downloading..." : status === "done" ? "Done" : formatFileSize(att.size)}
      </span>
    </button>
  );
}

function ReplyButton({
  icon,
  label,
  onClick,
}: {
  icon: typeof MailReply01Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100"
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.5} />
      {label}
    </button>
  );
}
