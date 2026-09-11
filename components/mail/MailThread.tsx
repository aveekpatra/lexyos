"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Letter } from "react-letter";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { IconType } from "react-icons";
import {
  IoArrowBack,
  IoArchive,
  IoTrash,
  IoMail,
  IoCheckboxOutline,
  IoArrowUndo,
  IoReturnUpBack,
  IoArrowRedo,
  IoAttach,
  IoStar,
  IoStarOutline,
  IoLink,
} from "react-icons/io5";
import { glassIconButton } from "@/lib/ui/chrome";
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

  // Reset view state when the selected thread changes, using render-phase
  // prev-tracking rather than a synchronous setState inside the fetch effect.
  const [prevThreadId, setPrevThreadId] = useState(threadId);
  if (prevThreadId !== threadId) {
    setPrevThreadId(threadId);
    setThread(null);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    getThread(threadId)
      .then((t) => {
        if (cancelled) return;
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
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
          <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="flex-1 p-6">
          <div className="mb-6 h-6 w-2/3 animate-pulse rounded bg-surface-2" />
          <div className="mb-4 h-4 w-1/3 animate-pulse rounded bg-surface-2/60" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-surface-2/40" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2/40" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-surface-2/40" />
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
      {/* Toolbar — themed chrome above the light reading pane; glass controls */}
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <button onClick={onBack} className={glassIconButton} title="Back" aria-label="Back">
          <IoArrowBack size={16} />
        </button>

        <h2 className="ml-1 min-w-0 flex-1 truncate text-[14px] font-bold tracking-tight text-text-strong">
          {subject}
        </h2>

        <div className="flex items-center gap-1">
          <ToolbarButton icon={IoArchive} label="Archive" onClick={handleArchive} />
          <ToolbarButton icon={IoTrash} label="Trash" onClick={handleTrash} />
          <ToolbarButton
            icon={IoMail}
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
            icon={IoCheckboxOutline}
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
          {thread.messages.map((msg) => (
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

// --- Toolbar button (themed glass, above the reading pane) ---

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={glassIconButton}>
      <Icon size={15} />
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
        className="flex cursor-pointer items-center gap-3 px-6 py-3 transition-colors hover:bg-line/40"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-bg text-[12px] font-medium text-brand">
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
          className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand-bg text-[13px] font-medium text-brand"
        >
          {initials}
        </div>
        <div onClick={onToggle} className="min-w-0 flex-1 cursor-pointer">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-text-strong">
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
            aria-label={message.isStarred ? "Unstar" : "Star"}
            className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-line/60"
          >
            {message.isStarred ? (
              <IoStar size={15} className="text-[#eab308]" />
            ) : (
              <IoStarOutline size={15} className="text-text-muted" />
            )}
          </button>
          <button
            onClick={onMarkUnread}
            title="Mark unread"
            aria-label="Mark unread"
            className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-line/60 hover:text-text-strong"
          >
            <IoMail size={15} />
          </button>
          <button
            onClick={onCopyLink}
            title="Copy link"
            aria-label="Copy link"
            className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-line/60 hover:text-text-strong"
          >
            <IoLink size={15} />
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
        <div className="mt-4 flex gap-2">
          <ReplyButton icon={IoArrowUndo} label="Reply" onClick={onReply} />
          <ReplyButton icon={IoReturnUpBack} label="Reply all" onClick={onReplyAll} />
          <ReplyButton icon={IoArrowRedo} label="Forward" onClick={onForward} />
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
      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        status === "downloading"
          ? "border-brand-border bg-brand-bg text-brand"
          : status === "done"
            ? "border-brand-border bg-brand-bg text-brand"
            : "border-line text-text-secondary hover:border-brand-border hover:bg-brand-bg hover:text-brand"
      }`}
    >
      <IoAttach size={14} />
      <span className="truncate">{att.filename}</span>
      <span className="flex-shrink-0 text-[11px] text-text-faint">
        {status === "downloading" ? "Downloading..." : status === "done" ? "Done" : formatFileSize(att.size)}
      </span>
    </button>
  );
}

function ReplyButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-brand-border hover:bg-brand-bg hover:text-brand"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
