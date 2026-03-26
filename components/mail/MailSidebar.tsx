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
} from "@hugeicons/core-free-icons";
import type { GmailLabel } from "@/lib/gmail-types";
import { useUnreadCount } from "./useGmailMessages";

const SYSTEM_LABELS = [
  { id: "INBOX", name: "Inbox", icon: InboxIcon },
  { id: "STARRED", name: "Starred", icon: StarIcon },
  { id: "SENT", name: "Sent", icon: SentIcon },
  { id: "DRAFT", name: "Drafts", icon: FileEditIcon },
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
    <div className="flex h-full flex-col py-2">
      {/* Compose button */}
      <div className="px-2 pb-2">
        <button
          onClick={onCompose}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#7c3aed] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6d28d9]"
        >
          Compose
        </button>
      </div>

      {/* System labels */}
      <nav className="flex flex-col gap-0.5 px-1">
        {SYSTEM_LABELS.map((item) => (
          <button
            key={item.id}
            onClick={() => onLabelSelect(item.id)}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition-colors ${
              activeLabel === item.id
                ? "bg-[#1f1f28] text-white"
                : "text-[#a1a1aa] hover:bg-[#1f1f28]/50 hover:text-[#d4d4d8]"
            }`}
          >
            <HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.5} />
            <span className="flex-1 text-left">{item.name}</span>
            {unreadCounts[item.id] ? (
              <span className="text-[12px] font-medium text-[#a78bfa]">
                {unreadCounts[item.id]}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {/* User labels */}
      {userLabels.length > 0 && (
        <>
          <div className="my-2 mx-2 h-px bg-[#1f1f28]" />
          <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-[#52525b]">
            Labels
          </div>
          <nav className="flex flex-col gap-0.5 overflow-y-auto px-1">
            {userLabels.map((label) => (
              <button
                key={label.id}
                onClick={() => onLabelSelect(label.id)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                  activeLabel === label.id
                    ? "bg-[#1f1f28] text-white"
                    : "text-[#a1a1aa] hover:bg-[#1f1f28]/50 hover:text-[#d4d4d8]"
                }`}
              >
                <HugeiconsIcon icon={Tag01Icon} size={14} strokeWidth={1.5} />
                <span className="flex-1 truncate text-left">{label.name}</span>
                {unreadCounts[label.id] ? (
                  <span className="text-[11px] text-[#a78bfa]">
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
