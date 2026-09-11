"use client";

import React, { useCallback, useState, useEffect, useRef } from "react";
import { IoStar, IoStarOutline, IoSearch, IoAttach } from "react-icons/io5";
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

  // Reset visible count when messages change (label switch, search) using
  // render-phase prev-tracking instead of a setState-in-effect.
  const listKey = `${messages.length}|${searchQuery}`;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setVisibleCount(PAGE_SIZE);
  }

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
      {/* Search — a flat recessed capsule (content layer) */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 rounded-full bg-black/[0.04] px-3.5 py-2 transition-colors focus-within:bg-black/[0.06] dark:bg-white/[0.06] dark:focus-within:bg-white/[0.09]">
          <IoSearch size={15} className="shrink-0 text-text-faint" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search emails..."
            className="flex-1 bg-transparent text-[13.5px] text-text-strong placeholder-text-faint outline-none"
          />
          {syncing && (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          )}
        </div>
      </div>

      {/* Message list */}
      <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-4">
        {loading && messages.length === 0 ? (
          <div className="flex flex-col gap-1 px-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-[70px] animate-pulse rounded-[10px] bg-surface-2"
              />
            ))}
          </div>
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
                className="py-3 text-center text-[13px] text-text-muted transition-colors hover:text-text-strong"
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
      className={`group flex cursor-pointer items-start gap-2.5 rounded-[10px] px-3 py-2.5 transition-colors ${
        isActive
          ? "bg-brand-bg"
          : isSelected
            ? "bg-hover"
            : "hover:bg-hover"
      }`}
    >
      {/* Selection — iOS circle checkbox */}
      <div onClick={onToggleSelect} className="mt-0.5 flex-shrink-0">
        <div
          className={`flex size-[18px] items-center justify-center rounded-full border transition-all ${
            isSelected
              ? "border-brand bg-brand text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
              : "border-line-strong bg-surface-1 hover:border-brand-border"
          }`}
        >
          {isSelected && (
            <svg
              viewBox="0 0 12 12"
              className="h-2.5 w-2.5"
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
        <div className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
      )}

      {/* Content — unread emphasis carried by font weight, not colour */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-[13px] ${
              message.isUnread
                ? "font-semibold text-text-strong"
                : "font-normal text-text-secondary"
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
              message.isUnread
                ? "font-medium text-text-strong"
                : "text-text-secondary"
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
            <IoAttach
              size={13}
              className="flex-shrink-0 text-text-muted"
            />
          )}
        </div>
      </div>

      {/* Star */}
      <button onClick={onStarClick} className="mt-0.5 flex-shrink-0 p-0.5">
        {message.isStarred ? (
          <IoStar size={15} className="text-[#eab308]" />
        ) : (
          <IoStarOutline
            size={15}
            className="text-text-faint transition-colors hover:text-text-muted"
          />
        )}
      </button>
    </div>
  );
}));
