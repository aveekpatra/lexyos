"use client";

import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sendMessage, createDraft } from "@/app/actions/gmail";
import type { GmailMessage } from "@/lib/gmail-types";

export type ComposeMode =
  | { type: "new" }
  | { type: "reply"; message: GmailMessage }
  | { type: "replyAll"; message: GmailMessage }
  | { type: "forward"; message: GmailMessage };

interface ComposeDialogProps {
  open: boolean;
  onClose: () => void;
  mode: ComposeMode;
  onSent: () => void;
}

function getInitialState(mode: ComposeMode) {
  switch (mode.type) {
    case "reply": {
      const msg = mode.message;
      return {
        to: msg.from.email,
        cc: "",
        bcc: "",
        subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
        body: `\n\n---\nOn ${new Date(msg.date).toLocaleDateString()}, ${msg.from.name || msg.from.email} wrote:\n> ${msg.bodyText.split("\n").join("\n> ")}`,
        threadId: msg.threadId,
        inReplyTo: msg.id,
        references: msg.id,
      };
    }
    case "replyAll": {
      const msg = mode.message;
      const allRecipients = [
        ...msg.to.map((a) => a.email),
        ...msg.cc.map((a) => a.email),
      ].filter((e) => e !== msg.from.email);
      return {
        to: msg.from.email,
        cc: allRecipients.join(", "),
        bcc: "",
        subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
        body: `\n\n---\nOn ${new Date(msg.date).toLocaleDateString()}, ${msg.from.name || msg.from.email} wrote:\n> ${msg.bodyText.split("\n").join("\n> ")}`,
        threadId: msg.threadId,
        inReplyTo: msg.id,
        references: msg.id,
      };
    }
    case "forward": {
      const msg = mode.message;
      return {
        to: "",
        cc: "",
        bcc: "",
        subject: msg.subject.startsWith("Fwd:") ? msg.subject : `Fwd: ${msg.subject}`,
        body: `\n\n---------- Forwarded message ----------\nFrom: ${msg.from.name || msg.from.email} <${msg.from.email}>\nDate: ${new Date(msg.date).toLocaleDateString()}\nSubject: ${msg.subject}\n\n${msg.bodyText}`,
        threadId: undefined,
        inReplyTo: undefined,
        references: undefined,
      };
    }
    default:
      return {
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        body: "",
        threadId: undefined,
        inReplyTo: undefined,
        references: undefined,
      };
  }
}

export default function ComposeDialog({
  open,
  onClose,
  mode,
  onSent,
}: ComposeDialogProps) {
  const initial = getInitialState(mode);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [showCcBcc, setShowCcBcc] = useState(!!initial.cc || !!initial.bcc);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when mode changes
  React.useEffect(() => {
    const init = getInitialState(mode);
    setTo(init.to);
    setCc(init.cc);
    setBcc(init.bcc);
    setSubject(init.subject);
    setBody(init.body);
    setShowCcBcc(!!init.cc || !!init.bcc);
    setError(null);
  }, [mode, open]);

  const handleSend = useCallback(async () => {
    if (!to.trim()) {
      setError("Recipient is required");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendMessage({
        to: to.trim(),
        subject,
        body,
        cc: cc || undefined,
        bcc: bcc || undefined,
        threadId: initial.threadId,
        inReplyTo: initial.inReplyTo,
        references: initial.references,
      });
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [to, subject, body, cc, bcc, initial, onSent, onClose]);

  const handleSaveDraft = useCallback(async () => {
    try {
      await createDraft({
        to: to.trim(),
        subject,
        body,
        cc: cc || undefined,
        bcc: bcc || undefined,
        threadId: initial.threadId,
      });
      onClose();
    } catch {}
  }, [to, subject, body, cc, bcc, initial, onClose]);

  const title =
    mode.type === "new"
      ? "New Message"
      : mode.type === "forward"
        ? "Forward"
        : "Reply";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Fields */}
        <div className="space-y-0 px-6">
          <ComposeField
            label="To"
            value={to}
            onChange={setTo}
            rightAction={
              !showCcBcc ? (
                <button
                  onClick={() => setShowCcBcc(true)}
                  className="text-[12px] text-[#a78bfa] hover:text-[#c4b5fd]"
                >
                  Cc/Bcc
                </button>
              ) : undefined
            }
          />
          {showCcBcc && (
            <>
              <ComposeField label="Cc" value={cc} onChange={setCc} />
              <ComposeField label="Bcc" value={bcc} onChange={setBcc} />
            </>
          )}
          <ComposeField label="Subject" value={subject} onChange={setSubject} />
        </div>

        {/* Body */}
        <div className="px-6 py-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={12}
            className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground placeholder-muted-foreground outline-none"
          />
        </div>

        {error && (
          <div className="px-6 pb-2 text-[13px] text-red-400">{error}</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Discard
          </Button>
          <Button variant="outline" onClick={handleSaveDraft}>
            Save draft
          </Button>
          <Button onClick={handleSend} disabled={sending} loading={sending}>
            Send
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ComposeField({
  label,
  value,
  onChange,
  rightAction,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rightAction?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/50 py-2">
      <label className="w-14 flex-shrink-0 text-[13px] text-muted-foreground">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-[14px] text-foreground outline-none"
      />
      {rightAction}
    </div>
  );
}
