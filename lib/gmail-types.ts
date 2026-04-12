export interface EmailAddress {
  name: string;
  email: string;
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  attachments: GmailAttachment[];
  isUnread: boolean;
  isStarred: boolean;
  messageIdHeader: string;
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
  snippet: string;
  historyId: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface GmailListResponse {
  messages: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}
