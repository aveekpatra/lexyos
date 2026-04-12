import type { EmailAddress, GmailAttachment, GmailMessage } from "./gmail-types";

// --- Base64url encoding/decoding ---

export function base64urlDecode(str: string): string {
  // Replace URL-safe chars and add padding
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function base64urlEncode(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- Email address parsing ---

export function parseEmailAddress(raw: string): EmailAddress {
  // Handles: "Name <email@example.com>" or "email@example.com"
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].replace(/^"|"$/g, "").trim(), email: match[2] };
  }
  return { name: raw.trim(), email: raw.trim() };
}

export function parseEmailAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw) return [];
  // Split on commas that aren't inside quotes/angle brackets
  return raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => parseEmailAddress(s.trim()))
    .filter((a) => a.email);
}

// --- MIME tree walking ---

interface GmailPayloadPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPayloadPart[];
}

interface ExtractedParts {
  textBody: string;
  htmlBody: string;
  attachments: GmailAttachment[];
}

export function extractParts(payload: GmailPayloadPart): ExtractedParts {
  const result: ExtractedParts = {
    textBody: "",
    htmlBody: "",
    attachments: [],
  };

  function walk(part: GmailPayloadPart) {
    const mime = part.mimeType || "";

    // If this part has an attachment ID and a filename, it's an attachment
    if (part.filename && part.body?.attachmentId) {
      result.attachments.push({
        filename: part.filename,
        mimeType: mime,
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
      return;
    }

    // Inline attachment (has filename but data is inline)
    if (part.filename && part.body?.size && part.body.size > 0) {
      result.attachments.push({
        filename: part.filename,
        mimeType: mime,
        size: part.body.size,
        attachmentId: part.body.attachmentId || "",
      });
      return;
    }

    if (mime === "text/plain" && part.body?.data && !result.textBody) {
      result.textBody = base64urlDecode(part.body.data);
    } else if (mime === "text/html" && part.body?.data && !result.htmlBody) {
      result.htmlBody = base64urlDecode(part.body.data);
    }

    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);
  return result;
}

// --- Header extraction ---

export function getHeader(
  headers: { name: string; value: string }[] | undefined,
  name: string
): string {
  if (!headers) return "";
  const h = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || "";
}

// --- Parse raw Gmail API message into GmailMessage ---

export function parseGmailMessage(raw: {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPayloadPart;
  internalDate?: string;
}): GmailMessage {
  const headers = raw.payload?.headers || [];
  const { textBody, htmlBody, attachments } = raw.payload
    ? extractParts(raw.payload)
    : { textBody: "", htmlBody: "", attachments: [] };

  return {
    id: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds || [],
    snippet: raw.snippet || "",
    from: parseEmailAddress(getHeader(headers, "From")),
    to: parseEmailAddressList(getHeader(headers, "To")),
    cc: parseEmailAddressList(getHeader(headers, "Cc")),
    bcc: parseEmailAddressList(getHeader(headers, "Bcc")),
    subject: getHeader(headers, "Subject"),
    date: raw.internalDate
      ? new Date(parseInt(raw.internalDate)).toISOString()
      : getHeader(headers, "Date"),
    bodyText: textBody,
    bodyHtml: htmlBody,
    attachments,
    isUnread: (raw.labelIds || []).includes("UNREAD"),
    isStarred: (raw.labelIds || []).includes("STARRED"),
    messageIdHeader: getHeader(headers, "Message-ID") || getHeader(headers, "Message-Id"),
  };
}

// --- RFC 2822 email construction ---

export function buildRawEmail(opts: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
  contentType?: string;
}): string {
  const lines: string[] = [];
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Sanitize email addresses — strip newlines, trim, remove surrounding quotes/brackets
  const cleanEmail = (s: string) => s.replace(/[\r\n]/g, "").trim().replace(/^["'<]+|["'>]+$/g, "");

  if (opts.from) lines.push(`From: ${cleanEmail(opts.from)}`);
  lines.push(`To: ${cleanEmail(opts.to)}`);
  if (opts.cc) lines.push(`Cc: ${cleanEmail(opts.cc)}`);
  if (opts.bcc) lines.push(`Bcc: ${cleanEmail(opts.bcc)}`);
  lines.push(`Subject: ${opts.subject.trim()}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push("");

  // Plain text part
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(opts.body);
  lines.push("");

  // HTML part
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/html; charset=UTF-8");
  lines.push("");
  lines.push(opts.body.replace(/\n/g, "<br>"));
  lines.push("");
  lines.push(`--${boundary}--`);

  return base64urlEncode(lines.join("\r\n"));
}

// --- Relative date formatting ---

export function relativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Format file size ---

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
