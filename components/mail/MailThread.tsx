"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Archive01Icon,
  Delete02Icon,
  Mail01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import type { GmailThread as GmailThreadType, GmailMessage } from "@/lib/gmail-types";
import { relativeDate, formatFileSize } from "@/lib/gmail-utils";
import { getThread, archiveMessage, trashMessage, markAsRead, markAsUnread } from "@/app/actions/gmail";

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
  const scrollRef = useRef<HTMLDivElement>(null);

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
        // Mark all unread messages as read (optimistic + Gmail API)
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

  // Optimistic helper for thread-level actions
  const threadAction = useCallback(
    async (
      addLabels: string[] | undefined,
      removeLabels: string[] | undefined,
      gmailAction: (msgId: string) => Promise<void>
    ) => {
      if (!thread) return;
      // 1. Optimistically update Convex cache for each message in thread
      for (const msg of thread.messages) {
        updateLabels({
          gmailMessageId: msg.id,
          addLabelIds: addLabels,
          removeLabelIds: removeLabels,
        }).catch(() => {});
      }
      // 2. Navigate back immediately (UI feels instant)
      onBack();
      // 3. Fire Gmail API calls in background
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

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-[#1f1f28] px-4 py-3">
          <div className="h-5 w-48 animate-pulse rounded bg-[#1f1f28]" />
        </div>
        <div className="flex-1 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="mb-4 h-32 animate-pulse rounded-lg bg-[#1f1f28]/50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-[#52525b]">
        Failed to load thread
      </div>
    );
  }

  const subject =
    thread.messages[0]?.subject || "(no subject)";

  return (
    <div className="flex h-full flex-col">
      {/* Header / toolbar */}
      <div className="flex items-center gap-1 border-b border-[#1f1f28] px-3 py-2">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 text-[#a1a1aa] transition-colors hover:bg-[#1f1f28] hover:text-white"
          title="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={1.5} />
        </button>

        <div className="mx-2 h-4 w-px bg-[#1f1f28]" />

        <ToolbarButton
          icon={Archive01Icon}
          label="Archive"
          onClick={handleArchive}
        />
        <ToolbarButton
          icon={Delete02Icon}
          label="Trash"
          onClick={handleTrash}
        />
        <ToolbarButton
          icon={Mail01Icon}
          label="Mark unread"
          onClick={async () => {
            const last = thread.messages[thread.messages.length - 1];
            if (last) {
              updateLabels({
                gmailMessageId: last.id,
                addLabelIds: ["UNREAD"],
              }).catch(() => {});
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

      {/* Subject */}
      <div className="border-b border-[#1f1f28] px-4 py-3">
        <h2 className="text-[17px] font-semibold text-white">{subject}</h2>
        <span className="text-[13px] text-[#71717a]">
          {thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {thread.messages.map((msg, i) => (
          <ThreadMessage
            key={msg.id}
            message={msg}
            isExpanded={expandedIds.has(msg.id)}
            isLast={i === thread.messages.length - 1}
            onToggle={() => toggleExpand(msg.id)}
            onReply={() => onReply(msg)}
            onReplyAll={() => onReplyAll(msg)}
            onForward={() => onForward(msg)}
          />
        ))}
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
      className="rounded-md p-1.5 text-[#a1a1aa] transition-colors hover:bg-[#1f1f28] hover:text-white"
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  );
}

// --- Individual message in thread ---

function ThreadMessage({
  message,
  isExpanded,
  isLast,
  onToggle,
  onReply,
  onReplyAll,
  onForward,
}: {
  message: GmailMessage;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Auto-resize iframe to content
  useEffect(() => {
    if (!isExpanded || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          iframe.style.height = doc.body.scrollHeight + 20 + "px";
        }
      } catch {}
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [isExpanded, message.bodyHtml]);

  const initials = (message.from.name || message.from.email)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const htmlContent = message.bodyHtml || `<pre style="white-space:pre-wrap;font-family:sans-serif;color:#d4d4d8;">${escapeHtml(message.bodyText)}</pre>`;

  const iframeSrcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          margin: 0;
          padding: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #d4d4d8;
          background: transparent;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        a { color: #a78bfa; }
        img { max-width: 100%; height: auto; }
        blockquote {
          border-left: 3px solid #3f3f46;
          margin: 8px 0;
          padding-left: 12px;
          color: #71717a;
        }
        table { max-width: 100%; }
      </style>
    </head>
    <body>${htmlContent}</body>
    </html>
  `;

  return (
    <div className="border-b border-[#1f1f28]/60">
      {/* Collapsed header */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-[#1f1f28]/30"
      >
        {/* Avatar */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#7c3aed]/20 text-[13px] font-medium text-[#a78bfa]">
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-white">
              {message.from.name || message.from.email}
            </span>
            <span className="text-[12px] text-[#71717a]">
              {relativeDate(message.date)}
            </span>
          </div>
          {!isExpanded && (
            <p className="truncate text-[13px] text-[#71717a]">
              {message.snippet}
            </p>
          )}
          {isExpanded && (
            <div className="text-[12px] text-[#71717a]">
              To: {message.to.map((a) => a.name || a.email).join(", ")}
              {message.cc.length > 0 && (
                <> &middot; Cc: {message.cc.map((a) => a.name || a.email).join(", ")}</>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-3">
          <iframe
            ref={iframeRef}
            srcDoc={iframeSrcDoc}
            sandbox="allow-same-origin"
            className="w-full border-0"
            style={{ minHeight: 60 }}
            title="Email content"
          />

          {/* Attachments */}
          {message.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-[#1f1f28] bg-[#0c0c0f] px-3 py-2 text-[13px] text-[#a1a1aa]"
                >
                  <span className="truncate">{att.filename}</span>
                  <span className="flex-shrink-0 text-[#52525b]">
                    {formatFileSize(att.size)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Reply actions */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={onReply}
              className="rounded-lg border border-[#1f1f28] px-3 py-1.5 text-[13px] text-[#a1a1aa] transition-colors hover:bg-[#1f1f28] hover:text-white"
            >
              Reply
            </button>
            <button
              onClick={onReplyAll}
              className="rounded-lg border border-[#1f1f28] px-3 py-1.5 text-[13px] text-[#a1a1aa] transition-colors hover:bg-[#1f1f28] hover:text-white"
            >
              Reply all
            </button>
            <button
              onClick={onForward}
              className="rounded-lg border border-[#1f1f28] px-3 py-1.5 text-[13px] text-[#a1a1aa] transition-colors hover:bg-[#1f1f28] hover:text-white"
            >
              Forward
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
