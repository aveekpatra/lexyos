"use client";

import React, { useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  StarIcon,
  Search01Icon,
  Attachment01Icon,
} from "@hugeicons/core-free-icons";
import type { Doc } from "@/convex/_generated/dataModel";
import { relativeDate } from "@/lib/gmail-utils";
import { starMessage, unstarMessage } from "@/app/actions/gmail";

type CachedEmail = Doc<"emails">;

interface MailListProps {
  messages: CachedEmail[];
  loading: boolean;
  syncing: boolean;
  activeThreadId: string | null;
  selectedIds: Set<string>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectThread: (threadId: string) => void;
  onToggleSelect: (messageId: string) => void;
  onContextMenu: (e: React.MouseEvent, message: CachedEmail) => void;
  onOptimisticAction: (
    gmailMessageId: string,
    addLabels: string[] | undefined,
    removeLabels: string[] | undefined,
    gmailAction: () => Promise<void>
  ) => void;
}

export default function MailList({
  messages,
  loading,
  syncing,
  activeThreadId,
  selectedIds,
  searchQuery,
  onSearchChange,
  onSelectThread,
  onToggleSelect,
  onContextMenu,
  onOptimisticAction,
}: MailListProps) {
  const handleStarClick = useCallback(
    (e: React.MouseEvent, msg: CachedEmail) => {
      e.stopPropagation();
      if (msg.isStarred) {
        onOptimisticAction(msg.gmailMessageId, undefined, ["STARRED"], () =>
          unstarMessage(msg.gmailMessageId)
        );
      } else {
        onOptimisticAction(msg.gmailMessageId, ["STARRED"], undefined, () =>
          starMessage(msg.gmailMessageId)
        );
      }
    },
    [onOptimisticAction]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-[#1f1f28] px-3 py-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={16}
          strokeWidth={1.5}
          className="text-[#52525b]"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search emails..."
          className="flex-1 bg-transparent text-[14px] text-[#d4d4d8] placeholder-[#52525b] outline-none"
        />
        {syncing && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#7c3aed] border-t-transparent" />
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-[#1f1f28]/50"
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-[#52525b]">
            <p className="text-[15px]">
              {syncing ? "Syncing emails..." : "No emails found"}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageRow
              key={msg._id}
              message={msg}
              isActive={msg.gmailThreadId === activeThreadId}
              isSelected={selectedIds.has(msg.gmailMessageId)}
              onSelect={() => onSelectThread(msg.gmailThreadId)}
              onToggleSelect={(e) => {
                e.stopPropagation();
                onToggleSelect(msg.gmailMessageId);
              }}
              onStarClick={(e) => handleStarClick(e, msg)}
              onContextMenu={(e) => onContextMenu(e, msg)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// --- Individual message row ---

const MessageRow = React.memo(function MessageRow({
  message,
  isActive,
  isSelected,
  onSelect,
  onToggleSelect,
  onStarClick,
  onContextMenu,
}: {
  message: CachedEmail;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleSelect: (e: React.MouseEvent) => void;
  onStarClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`flex cursor-pointer items-start gap-2 border-b border-[#1f1f28]/60 px-3 py-2.5 transition-colors ${
        isActive
          ? "bg-[#1f1f28]"
          : isSelected
            ? "bg-[#1f1f28]/60"
            : "hover:bg-[#1f1f28]/30"
      }`}
    >
      {/* Checkbox */}
      <div onClick={onToggleSelect} className="mt-1 flex-shrink-0">
        <div
          className={`h-4 w-4 rounded border transition-colors ${
            isSelected
              ? "border-[#7c3aed] bg-[#7c3aed]"
              : "border-[#3f3f46] hover:border-[#52525b]"
          }`}
        >
          {isSelected && (
            <svg
              viewBox="0 0 12 12"
              className="h-4 w-4 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M2 6l3 3 5-5" />
            </svg>
          )}
        </div>
      </div>

      {/* Unread indicator */}
      {message.isUnread && (
        <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#7c3aed]" />
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[15px] ${
              message.isUnread
                ? "font-semibold text-white"
                : "text-[#d4d4d8]"
            }`}
          >
            {message.fromName || message.fromEmail}
          </span>
          <span className="ml-auto flex-shrink-0 text-[12px] text-[#71717a]">
            {relativeDate(new Date(message.date).toISOString())}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-[14px] ${
              message.isUnread ? "text-[#d4d4d8]" : "text-[#a1a1aa]"
            }`}
          >
            {message.subject || "(no subject)"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-[#71717a]">
            {message.snippet}
          </span>
          {message.hasAttachments && (
            <HugeiconsIcon
              icon={Attachment01Icon}
              size={13}
              strokeWidth={1.5}
              className="flex-shrink-0 text-[#71717a]"
            />
          )}
        </div>
      </div>

      {/* Star */}
      <button onClick={onStarClick} className="mt-0.5 flex-shrink-0 p-0.5">
        <HugeiconsIcon
          icon={StarIcon}
          size={16}
          strokeWidth={1.5}
          className={
            message.isStarred
              ? "fill-[#eab308] text-[#eab308]"
              : "text-[#3f3f46] hover:text-[#71717a]"
          }
        />
      </button>
    </div>
  );
});
