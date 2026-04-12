"use client";

import React, { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive01Icon,
  Delete02Icon,
  Mail01Icon,
  MailOpenIcon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import {
  archiveMessages,
  trashMessages,
  markMessagesAsRead,
  markMessagesAsUnread,
  starMessages,
  unstarMessages,
} from "@/app/actions/gmail";

interface MailBulkActionsProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
  onRefresh: () => void;
}

export default function MailBulkActions({
  selectedIds,
  onClearSelection,
  onRefresh,
}: MailBulkActionsProps) {
  const updateLabels = useMutation(api.emails.updateLabels);
  const ids = Array.from(selectedIds);

  // Optimistic bulk action: update Convex cache for each message, then fire Gmail API
  const doBulkAction = useCallback(
    async (
      addLabels: string[] | undefined,
      removeLabels: string[] | undefined,
      gmailAction: (ids: string[]) => Promise<void>
    ) => {
      // 1. Optimistically update Convex cache for each message
      for (const id of ids) {
        updateLabels({
          gmailMessageId: id,
          addLabelIds: addLabels,
          removeLabelIds: removeLabels,
        }).catch(() => {});
      }

      // 2. Clear selection immediately (UI feels instant)
      onClearSelection();

      // 3. Fire Gmail API in background
      try {
        await gmailAction(ids);
      } catch {
        // If fails, next sync will correct
        console.warn("Bulk Gmail action failed, will correct on next sync");
        onRefresh();
      }
    },
    [ids, updateLabels, onClearSelection, onRefresh]
  );

  if (selectedIds.size === 0) return null;

  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface-0 px-3 py-2">
      <span className="mr-2 text-[13px] font-medium text-brand">
        {selectedIds.size} selected
      </span>

      <BulkButton
        icon={Archive01Icon}
        label="Archive"
        onClick={() => doBulkAction(undefined, ["INBOX"], archiveMessages)}
      />
      <BulkButton
        icon={Delete02Icon}
        label="Trash"
        onClick={() => doBulkAction(["TRASH"], ["INBOX"], trashMessages)}
      />
      <BulkButton
        icon={MailOpenIcon}
        label="Mark read"
        onClick={() =>
          doBulkAction(undefined, ["UNREAD"], markMessagesAsRead)
        }
      />
      <BulkButton
        icon={Mail01Icon}
        label="Mark unread"
        onClick={() =>
          doBulkAction(["UNREAD"], undefined, markMessagesAsUnread)
        }
      />
      <BulkButton
        icon={StarIcon}
        label="Star"
        onClick={() => doBulkAction(["STARRED"], undefined, starMessages)}
      />

      <div className="flex-1" />
      <button
        onClick={onClearSelection}
        className="text-[12px] text-text-muted hover:text-text-secondary"
      >
        Clear
      </button>
    </div>
  );
}

function BulkButton({
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
      className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-line hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  );
}
