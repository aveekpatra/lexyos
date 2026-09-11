"use client";

import React, { useMemo } from "react";
import type { IconType } from "react-icons";
import {
  IoFileTrayFull,
  IoStar,
  IoSend,
  IoDocumentText,
  IoArchive,
  IoWarning,
  IoTrash,
  IoPricetag,
  IoCreate,
} from "react-icons/io5";
import type { GmailLabel } from "@/lib/gmail-types";
import { useUnreadCount } from "./useGmailMessages";

const SYSTEM_LABELS: { id: string; name: string; icon: IconType }[] = [
  { id: "INBOX", name: "Inbox", icon: IoFileTrayFull },
  { id: "STARRED", name: "Starred", icon: IoStar },
  { id: "SENT", name: "Sent", icon: IoSend },
  { id: "DRAFT", name: "Drafts", icon: IoDocumentText },
  { id: "ARCHIVED", name: "Archived", icon: IoArchive },
  { id: "SPAM", name: "Spam", icon: IoWarning },
  { id: "TRASH", name: "Trash", icon: IoTrash },
];

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
      {/* Compose — the single saturated blue capsule */}
      <div className="px-3 pb-3">
        <button
          onClick={onCompose}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong active:translate-y-px shadow-[0_1px_3px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.2)]"
        >
          <IoCreate size={16} />
          Compose
        </button>
      </div>

      <div className="mx-3 mb-3 h-px bg-line" />

      {/* System labels — flat rows, calm hover, active = tinted brand wash */}
      <nav className="flex flex-col gap-0.5 px-3">
        {SYSTEM_LABELS.map((item) => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.name}
            active={activeLabel === item.id}
            count={unreadCounts[item.id]}
            onClick={() => onLabelSelect(item.id)}
          />
        ))}
      </nav>

      {/* User labels */}
      {userLabels.length > 0 && (
        <>
          <div className="my-3 mx-3 h-px bg-line" />
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
            Labels
          </div>
          <nav className="flex flex-col gap-0.5 overflow-y-auto px-3 pb-1">
            {userLabels.map((label) => (
              <NavItem
                key={label.id}
                icon={IoPricetag}
                label={label.name}
                active={activeLabel === label.id}
                count={unreadCounts[label.id]}
                onClick={() => onLabelSelect(label.id)}
                truncate
              />
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  count,
  onClick,
  truncate,
}: {
  icon: IconType;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  truncate?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? "bg-brand-bg text-brand font-medium"
          : "text-text-secondary hover:bg-hover hover:text-text-strong"
      }`}
    >
      <Icon
        size={15}
        className={
          active
            ? "text-brand"
            : "text-text-faint transition-colors group-hover:text-text-secondary"
        }
      />
      <span className={`flex-1 text-left ${truncate ? "truncate" : ""}`}>
        {label}
      </span>
      {count ? (
        <span
          className={`text-[11px] font-semibold ${
            active ? "text-brand" : "text-text-muted"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
