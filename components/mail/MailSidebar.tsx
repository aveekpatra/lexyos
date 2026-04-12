"use client";

import React, { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InboxIcon,
  StarIcon,
  SentIcon,
  FileEditIcon,
  Delete02Icon,
  Tag01Icon,
  QuillWrite01Icon,
  Archive01Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import type { GmailLabel } from "@/lib/gmail-types";
import { useUnreadCount } from "./useGmailMessages";

const SYSTEM_LABELS = [
  { id: "INBOX", name: "Inbox", icon: InboxIcon },
  { id: "STARRED", name: "Starred", icon: StarIcon },
  { id: "SENT", name: "Sent", icon: SentIcon },
  { id: "DRAFT", name: "Drafts", icon: FileEditIcon },
  { id: "ARCHIVED", name: "Archived", icon: Archive01Icon },
  { id: "SPAM", name: "Spam", icon: Alert02Icon },
  { id: "TRASH", name: "Trash", icon: Delete02Icon },
] as const;

interface MailSidebarProps {
  activeLabel: string;
  onLabelSelect: (labelId: string) => void;
  onCompose: () => void;
  labels: GmailLabel[];
}

export default function MailSidebar({
  activeLabel,
  onLabelSelect,
  onCompose,
  labels,
}: MailSidebarProps) {
  const userLabels = useMemo(
    () => labels.filter((l) => l.type === "user"),
    [labels]
  );

  // Reactive unread count from Convex cache (instant updates)
  const inboxUnread = useUnreadCount();

  const unreadCounts = useMemo(() => {
    const map: Record<string, number> = {};
    // Use Convex reactive count for inbox
    if (inboxUnread > 0) map["INBOX"] = inboxUnread;
    // Use Gmail label counts for other labels
    for (const l of labels) {
      if (l.id !== "INBOX" && l.messagesUnread) map[l.id] = l.messagesUnread;
    }
    return map;
  }, [labels, inboxUnread]);

  return (
    <div className="flex h-full flex-col py-3">
      {/* Compose button */}
      <div className="px-3 pb-3">
        <button
          onClick={onCompose}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-blue-300 bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-700 shadow-3d transition-all hover:bg-blue-200 active:translate-y-[1px] active:shadow-3d-sm dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-400 dark:hover:bg-blue-900/50"
        >
          <HugeiconsIcon icon={QuillWrite01Icon} size={16} strokeWidth={1.5} />
          Compose
        </button>
      </div>

      <div className="mx-3 mb-3 h-px bg-line" />

      {/* System labels */}
      <nav className="flex flex-col gap-1.5 px-3">
        {SYSTEM_LABELS.map((item) => (
          <button
            key={item.id}
            onClick={() => onLabelSelect(item.id)}
            className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-1.5 text-[13px] shadow-3d transition-all active:translate-y-[1px] active:shadow-3d-sm ${
              activeLabel === item.id
                ? "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-400"
                : "border-line bg-surface-1 text-text-secondary hover:border-blue-200 hover:bg-blue-50/60 hover:text-text-strong dark:border-white/10 dark:hover:border-blue-500/40 dark:hover:bg-blue-950/30"
            }`}
          >
            <HugeiconsIcon icon={item.icon} size={14} strokeWidth={1.5} />
            <span className="flex-1 text-left">{item.name}</span>
            {unreadCounts[item.id] ? (
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                {unreadCounts[item.id]}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {/* User labels */}
      {userLabels.length > 0 && (
        <>
          <div className="my-3 mx-3 h-px bg-line" />
          <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
            Labels
          </div>
          <nav className="flex flex-col gap-1.5 overflow-y-auto px-3 pb-1">
            {userLabels.map((label) => (
              <button
                key={label.id}
                onClick={() => onLabelSelect(label.id)}
                className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-1.5 text-[13px] shadow-3d transition-all active:translate-y-[1px] active:shadow-3d-sm ${
                  activeLabel === label.id
                    ? "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-400"
                    : "border-line bg-surface-1 text-text-secondary hover:border-blue-200 hover:bg-blue-50/60 hover:text-text-strong dark:border-white/10 dark:hover:border-blue-500/40 dark:hover:bg-blue-950/30"
                }`}
              >
                <HugeiconsIcon icon={Tag01Icon} size={14} strokeWidth={1.5} />
                <span className="flex-1 truncate text-left">{label.name}</span>
                {unreadCounts[label.id] ? (
                  <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                    {unreadCounts[label.id]}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
