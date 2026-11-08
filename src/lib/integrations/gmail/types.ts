export interface GmailHeaders {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  messageId?: string; // RFC822 Message-ID header
  inReplyTo?: string;
  references?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string; // Gmail epoch ms as string
  headers: GmailHeaders;
  bodyText: string;
  bodyHtml: string;
  attachments: GmailAttachmentRef[];
  // Plain data object — passed straight through as a node executor `output`,
  // which must satisfy `Record<string, unknown>`.
  [key: string]: unknown;
}

export interface GmailAttachmentRef {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SendInput {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string; // RFC822 Message-ID to thread
  references?: string; // space-separated chain
  threadId?: string; // Gmail thread id for thread continuation
}

export interface SendResult {
  messageId: string; // Gmail API message id
  threadId: string;
  rfc822MessageId: string; // RFC822 Message-ID from headers
}
