"use client";

import React, { useCallback, useState, useEffect, useRef } from "react";
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
  focusIndex: number;
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
  focusIndex,
  onOptimisticAction,
}: MailListProps) {
  const PAGE_SIZE = 25;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when messages change (label switch, search)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [messages.length, searchQuery]);

  const visibleMessages = messages.slice(0, visibleCount);
  const hasMore = messages.length > visibleCount;
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Auto-scroll focused row into view
  useEffect(() => {
    const el = rowRefs.current.get(focusIndex);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

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
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-surface-1 px-3 py-2 shadow-3d">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            strokeWidth={1.5}
            className="text-text-faint"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search emails..."
            className="flex-1 bg-transparent text-[14px] text-text-strong placeholder-text-faint outline-none"
          />
          {syncing && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          )}
        </div>
      </div>

      {/* Message list */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-5 pb-4">
        {loading && messages.length === 0 ? (
          <>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-[10px] bg-line/50"
              />
            ))}
          </>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-text-faint">
            <p className="text-[15px]">
              {syncing ? "Syncing emails..." : "No emails found"}
            </p>
          </div>
        ) : (
          <>
            {visibleMessages.map((msg, i) => (
              <MessageRow
                key={msg._id}
                ref={(el) => {
                  if (el) rowRefs.current.set(i, el);
                  else rowRefs.current.delete(i);
                }}
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
            ))}
            {hasMore && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="py-3 text-center text-[13px] text-text-muted transition-colors hover:text-foreground"
              >
                Load more ({messages.length - visibleCount} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Individual message row ---

const MessageRow = React.memo(React.forwardRef<HTMLDivElement, {
  message: CachedEmail;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleSelect: (e: React.MouseEvent) => void;
  onStarClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}>(function MessageRow({
  message,
  isActive,
  isSelected,
  onSelect,
  onToggleSelect,
  onStarClick,
  onContextMenu,
}, ref) {
  return (
    <div
      ref={ref}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 shadow-3d transition-all active:translate-y-[1px] active:shadow-3d-sm ${
        isActive
          ? "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-950/50"
          : isSelected
            ? "border-blue-200 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-950/30"
            : "border-line bg-surface-1 hover:border-blue-200 hover:bg-blue-50/60 dark:border-white/10 dark:hover:border-blue-500/40 dark:hover:bg-blue-950/30"
      }`}
    >
      {/* Checkbox */}
      <div onClick={onToggleSelect} className="mt-1 flex-shrink-0">
        <div
          className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
            isSelected
              ? "border-blue-400 bg-blue-400"
              : "border-line-strong hover:border-blue-300"
          }`}
        >
          {isSelected && (
            <svg
              viewBox="0 0 12 12"
              className="h-3 w-3 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M2 6l3 3 5-5" />
            </svg>
          )}
        </div>
      </div>

      {/* Unread indicator */}
      {message.isUnread && (
        <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[13px] ${
              message.isUnread
                ? "font-semibold text-foreground"
                : "font-medium text-text-strong"
            }`}
          >
            {message.fromName || message.fromEmail}
          </span>
          <span className="ml-auto flex-shrink-0 text-[11px] text-text-muted">
            {relativeDate(new Date(message.date).toISOString())}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-[12.5px] ${
              message.isUnread ? "font-medium text-text-strong" : "text-text-secondary"
            }`}
          >
            {message.subject || "(no subject)"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] text-text-faint">
            {message.snippet}
          </span>
          {message.hasAttachments && (
            <HugeiconsIcon
              icon={Attachment01Icon}
              size={13}
              strokeWidth={1.5}
              className="flex-shrink-0 text-text-muted"
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
              : "text-line-strong hover:text-text-muted"
          }
        />
      </button>
    </div>
  );
}));
