"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useGmailMessages, useGmailLabels } from "./useGmailMessages";
import MailSidebar from "./MailSidebar";
import MailList from "./MailList";
import MailThread from "./MailThread";
import MailBulkActions from "./MailBulkActions";
import MailContextMenu from "./MailContextMenu";
import ComposeDialog, { type ComposeMode } from "./ComposeDialog";
import EmailToTaskDialog from "./EmailToTaskDialog";
import type { GmailMessage, GmailThread as GmailThreadType } from "@/lib/gmail-types";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  archiveMessage,
  trashMessage,
  markAsRead,
  markAsUnread,
  starMessage,
  unstarMessage,
} from "@/app/actions/gmail";

type CachedEmail = Doc<"emails">;

export default function MailView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Lazy email sync: trigger incremental sync when Mail view mounts
  useEffect(() => {
    const doSync = async () => {
      try {
        const { syncGmail } = await import("@/app/actions/gmailSync");
        await syncGmail(false); // incremental sync (uses historyId)
      } catch (err) {
        console.warn("[Mail] Background email sync failed:", err);
      }
    };
    doSync();
  }, []);

  // Optimistic update mutation
  const updateLabelsOptimistic = useMutation(api.emails.updateLabels);

  // Panel sizes
  const sidebar = useResizablePanel("mail-sidebar", 180, 120, 280, 48);
  const list = useResizablePanel("mail-list", 380, 240, 600, 48 + sidebar.width + 4);

  // State
  const [activeLabel, setActiveLabel] = useState(
    searchParams.get("label") || "INBOX"
  );
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    searchParams.get("thread") || null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Context menu — uses CachedEmail for list items
  const [contextMenu, setContextMenu] = useState<{
    message: CachedEmail;
    position: { x: number; y: number };
  } | null>(null);

  // Compose — uses GmailMessage (full message from thread view)
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>({ type: "new" });

  // Email to task
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskMessage, setTaskMessage] = useState<GmailMessage | null>(null);
  const [taskThread, setTaskThread] = useState<GmailThreadType | null>(null);

  // Labels
  const { labels } = useGmailLabels();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fetch from Convex cache
  const {
    messages,
    loading,
    syncing,
    syncError,
    refresh,
  } = useGmailMessages({
    labelFilter: debouncedQuery ? undefined : activeLabel,
    searchQuery: debouncedQuery || undefined,
  });

  // Focused message index for keyboard navigation
  const [focusIndex, setFocusIndex] = useState(0);

  // URL sync
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeLabel !== "INBOX") params.set("label", activeLabel);
    if (activeThreadId) params.set("thread", activeThreadId);
    const qs = params.toString();
    router.replace(`/mail${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [activeLabel, activeThreadId, router]);

  // --- Optimistic action helper ---
  const optimisticAction = useCallback(
    async (
      gmailMessageId: string,
      addLabels: string[] | undefined,
      removeLabels: string[] | undefined,
      gmailAction: () => Promise<void>
    ) => {
      // 1. Immediately update Convex cache
      await updateLabelsOptimistic({
        gmailMessageId,
        addLabelIds: addLabels,
        removeLabelIds: removeLabels,
      });
      // 2. Then fire Gmail API call
      try {
        await gmailAction();
      } catch {
        // If Gmail fails, sync will fix it on next refresh
        console.warn("Gmail action failed, will correct on next sync");
      }
    },
    [updateLabelsOptimistic]
  );

  // --- Handlers ---

  const handleLabelSelect = useCallback((labelId: string) => {
    setActiveLabel(labelId);
    setActiveThreadId(null);
    setSelectedIds(new Set());
    setFocusIndex(0);
  }, []);

  const handleSelectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    const idx = messages.findIndex((m) => m.gmailThreadId === threadId);
    if (idx >= 0) setFocusIndex(idx);
  }, [messages]);

  const handleToggleSelect = useCallback(
    (messageId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(messageId)) next.delete(messageId);
        else next.add(messageId);
        return next;
      });
    },
    []
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(messages.map((m) => m.gmailMessageId)));
  }, [messages]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, message: CachedEmail) => {
      e.preventDefault();
      setContextMenu({ message, position: { x: e.clientX, y: e.clientY } });
    },
    []
  );

  const openCompose = useCallback((mode: ComposeMode) => {
    setComposeMode(mode);
    setComposeOpen(true);
  }, []);

  const handleConvertToTask = useCallback(
    (message: GmailMessage, thread?: GmailThreadType) => {
      setTaskMessage(message);
      setTaskThread(thread || null);
      setTaskDialogOpen(true);
    },
    []
  );

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const focused = messages[focusIndex];

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const nextIdx = Math.min(focusIndex + 1, messages.length - 1);
          setFocusIndex(nextIdx);
          const next = messages[nextIdx];
          if (next) handleSelectThread(next.gmailThreadId);
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prevIdx = Math.max(focusIndex - 1, 0);
          setFocusIndex(prevIdx);
          const prev = messages[prevIdx];
          if (prev) handleSelectThread(prev.gmailThreadId);
          break;
        }
        case "Escape":
          e.preventDefault();
          if (activeThreadId) setActiveThreadId(null);
          else setSelectedIds(new Set());
          break;
        case "e":
          if (focused) {
            e.preventDefault();
            optimisticAction(focused.gmailMessageId, undefined, ["INBOX"], () =>
              archiveMessage(focused.gmailMessageId)
            );
          }
          break;
        case "#":
          if (focused) {
            e.preventDefault();
            optimisticAction(focused.gmailMessageId, ["TRASH"], ["INBOX"], () =>
              trashMessage(focused.gmailMessageId)
            );
          }
          break;
        case "s":
          if (focused) {
            e.preventDefault();
            if (focused.isStarred) {
              optimisticAction(focused.gmailMessageId, undefined, ["STARRED"], () =>
                unstarMessage(focused.gmailMessageId)
              );
            } else {
              optimisticAction(focused.gmailMessageId, ["STARRED"], undefined, () =>
                starMessage(focused.gmailMessageId)
              );
            }
          }
          break;
        case "I":
          if (e.shiftKey && focused) {
            e.preventDefault();
            optimisticAction(focused.gmailMessageId, undefined, ["UNREAD"], () =>
              markAsRead(focused.gmailMessageId)
            );
          }
          break;
        case "U":
          if (e.shiftKey && focused) {
            e.preventDefault();
            optimisticAction(focused.gmailMessageId, ["UNREAD"], undefined, () =>
              markAsUnread(focused.gmailMessageId)
            );
          }
          break;
        case "c":
          e.preventDefault();
          openCompose({ type: "new" });
          break;
        case "x":
          if (focused) {
            e.preventDefault();
            handleToggleSelect(focused.gmailMessageId);
          }
          break;
        case "/":
          e.preventDefault();
          document
            .querySelector<HTMLInputElement>('input[placeholder="Search emails..."]')
            ?.focus();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [messages, focusIndex, activeThreadId, handleSelectThread, handleToggleSelect, openCompose, optimisticAction]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div style={{ width: sidebar.width }} className="flex-shrink-0 overflow-hidden border-r border-line">
        <MailSidebar
          activeLabel={activeLabel}
          onLabelSelect={handleLabelSelect}
          onCompose={() => openCompose({ type: "new" })}
          labels={labels}
        />
      </div>
      <ResizeHandle onMouseDown={sidebar.onMouseDown} />

      {/* Message list */}
      <div
        style={{ width: list.width }}
        className="flex flex-shrink-0 flex-col overflow-hidden border-r border-line"
      >
        {syncError && (
          <div className="border-b border-line bg-red-50 px-3 py-2 text-[13px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
            Sync error: {syncError}
          </div>
        )}
        <MailBulkActions
          selectedIds={selectedIds}
          onClearSelection={() => setSelectedIds(new Set())}
          onRefresh={refresh}
        />
        <MailList
          messages={messages}
          loading={loading}
          syncing={syncing}
          activeThreadId={activeThreadId}
          selectedIds={selectedIds}
          searchQuery={searchQuery}
          focusIndex={focusIndex}
          onSearchChange={setSearchQuery}
          onSelectThread={handleSelectThread}
          onToggleSelect={handleToggleSelect}
          onContextMenu={handleContextMenu}
          onOptimisticAction={optimisticAction}
        />
      </div>
      <ResizeHandle onMouseDown={list.onMouseDown} />

      {/* Thread / Reading pane */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeThreadId ? (
          <MailThread
            threadId={activeThreadId}
            onBack={() => setActiveThreadId(null)}
            onReply={(msg) => openCompose({ type: "reply", message: msg })}
            onReplyAll={(msg) => openCompose({ type: "replyAll", message: msg })}
            onForward={(msg) => openCompose({ type: "forward", message: msg })}
            onConvertToTask={handleConvertToTask}
            onRefreshList={refresh}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-faint">
            <p className="text-[15px]">Select an email to read</p>
            <p className="text-[13px]">
              Use <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">j</kbd> / <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">k</kbd> to navigate, <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">Enter</kbd> to open
            </p>
            {syncing && (
              <p className="text-[12px] text-brand">Syncing emails...</p>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <MailContextMenu
          message={contextMenu.message}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onOpenThread={(threadId) => handleSelectThread(threadId)}
          onOptimisticAction={optimisticAction}
          onRefresh={refresh}
        />
      )}

      {/* Compose dialog */}
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        mode={composeMode}
        onSent={refresh}
      />

      {/* Email to task dialog */}
      <EmailToTaskDialog
        open={taskDialogOpen}
        onClose={() => setTaskDialogOpen(false)}
        message={taskMessage}
        thread={taskThread}
      />
    </div>
  );
}
