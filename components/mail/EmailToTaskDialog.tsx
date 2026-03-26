"use client";

import React, { useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GmailMessage, GmailThread } from "@/lib/gmail-types";

interface EmailToTaskDialogProps {
  open: boolean;
  onClose: () => void;
  message: GmailMessage | null;
  thread?: GmailThread | null;
}

export default function EmailToTaskDialog({
  open,
  onClose,
  message,
  thread,
}: EmailToTaskDialogProps) {
  const createTask = useMutation(api.tasks.create);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Pre-fill when dialog opens
  React.useEffect(() => {
    if (message && open) {
      setTitle(message.subject || "(no subject)");
      const sender = message.from.name || message.from.email;
      const snippet = message.bodyText.slice(0, 200);
      const threadLink = thread
        ? `[View email thread](/mail?thread=${thread.id})`
        : "";
      setDescription(
        `From: ${sender}\n\n${snippet}${snippet.length >= 200 ? "..." : ""}\n\n${threadLink}`
      );
    }
  }, [message, thread, open]);

  const handleCreate = useCallback(async () => {
    if (!message || !title.trim()) return;
    setCreating(true);
    try {
      const userDate = new Date().toISOString().slice(0, 10);
      await createTask({
        title: title.trim(),
        description,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        gmailSubject: message.subject,
        userDate,
      });
      onClose();
    } catch (err) {
      console.error("Failed to create task from email:", err);
    } finally {
      setCreating(false);
    }
  }, [message, title, description, createTask, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Convert Email to Task</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[12px] text-muted-foreground">
                Title
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-muted-foreground">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            loading={creating}
          >
            Create Task
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// Badge component for thread view to show when a task already exists
export function EmailTaskBadge({ threadId }: { threadId: string }) {
  const existingTask = useQuery(api.tasks.getByGmailThread, {
    gmailThreadId: threadId,
  });

  if (!existingTask) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary">
      Task linked
    </span>
  );
}
