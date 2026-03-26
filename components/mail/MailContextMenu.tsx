"use client";

import React from "react";
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

interface MailContextMenuProps {
  message: CachedEmail;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
  onOptimisticAction: (
    gmailMessageId: string,
    addLabels: string[] | undefined,
    removeLabels: string[] | undefined,
    gmailAction: () => Promise<void>
  ) => void;
  onRefresh: () => void;
}

export default function MailContextMenu({
  message,
  position,
  onClose,
  onOpenThread,
  onOptimisticAction,
  onRefresh,
}: MailContextMenuProps) {
  const doAction = (
    addLabels: string[] | undefined,
    removeLabels: string[] | undefined,
    gmailAction: () => Promise<void>
  ) => {
    onClose();
    onOptimisticAction(message.gmailMessageId, addLabels, removeLabels, gmailAction);
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50 w-[220px] rounded-xl border border-[#2a2a36] bg-[#131318] p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{ left: position.x, top: position.y }}
      >
        <MenuItem
          label="Open"
          onClick={() => {
            onClose();
            onOpenThread(message.gmailThreadId);
          }}
        />
        <MenuSep />
        <MenuItem
          label="Archive"
          shortcut="E"
          onClick={() =>
            doAction(undefined, ["INBOX"], () =>
              archiveMessage(message.gmailMessageId)
            )
          }
        />
        <MenuItem
          label="Trash"
          shortcut="#"
          onClick={() =>
            doAction(["TRASH"], ["INBOX"], () =>
              trashMessage(message.gmailMessageId)
            )
          }
        />
        <MenuItem
          label={message.isStarred ? "Unstar" : "Star"}
          shortcut="S"
          onClick={() =>
            message.isStarred
              ? doAction(undefined, ["STARRED"], () =>
                  unstarMessage(message.gmailMessageId)
                )
              : doAction(["STARRED"], undefined, () =>
                  starMessage(message.gmailMessageId)
                )
          }
        />
        <MenuItem
          label={message.isUnread ? "Mark as read" : "Mark as unread"}
          onClick={() =>
            message.isUnread
              ? doAction(undefined, ["UNREAD"], () =>
                  markAsRead(message.gmailMessageId)
                )
              : doAction(["UNREAD"], undefined, () =>
                  markAsUnread(message.gmailMessageId)
                )
          }
        />
      </div>
    </>
  );
}

function MenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] text-[#d4d4d8] transition-colors hover:bg-[#1f1f28]"
    >
      <span>{label}</span>
      {shortcut && (
        <span className="text-[11px] text-[#52525b]">{shortcut}</span>
      )}
    </button>
  );
}

function MenuSep() {
  return <div className="my-1 h-px bg-[#1f1f28]" />;
}
