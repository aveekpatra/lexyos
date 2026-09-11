"use client";

import React, { useCallback } from "react";
import type { IconType } from "react-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  IoArchive,
  IoTrash,
  IoMail,
  IoMailOpen,
  IoStar,
} from "react-icons/io5";
import { glassIconButton, softPill } from "@/lib/ui/chrome";
import {
  archiveMessages,
  trashMessages,
  markMessagesAsRead,
  markMessagesAsUnread,
  starMessages,
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
    <div className="flex items-center gap-1.5 border-b border-line bg-surface-1 px-3 py-2">
      <span className="mr-1 text-[13px] font-medium text-brand">
        {selectedIds.size} selected
      </span>

      <BulkButton
        icon={IoArchive}
        label="Archive"
        onClick={() => doBulkAction(undefined, ["INBOX"], archiveMessages)}
      />
      <BulkButton
        icon={IoTrash}
        label="Trash"
        onClick={() => doBulkAction(["TRASH"], ["INBOX"], trashMessages)}
      />
      <BulkButton
        icon={IoMailOpen}
        label="Mark read"
        onClick={() => doBulkAction(undefined, ["UNREAD"], markMessagesAsRead)}
      />
      <BulkButton
        icon={IoMail}
        label="Mark unread"
        onClick={() => doBulkAction(["UNREAD"], undefined, markMessagesAsUnread)}
      />
      <BulkButton
        icon={IoStar}
        label="Star"
        onClick={() => doBulkAction(["STARRED"], undefined, starMessages)}
      />

      <div className="flex-1" />
      <button onClick={onClearSelection} className={softPill}>
        Clear
      </button>
    </div>
  );
}

function BulkButton({
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
