export type WhatsAppServiceStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected';

export interface WhatsAppServiceState {
  status: WhatsAppServiceStatus;
  qrCode: string | null;
  connectedNumber: string | null;
}

export interface WhatsAppInboundMessage {
  from: string; // E.164 phone number or LID
  replyJid?: string; // Full JID to reply to (used for LID messages)
  text: string;
  timestamp: number;
  messageId: string;
  isGroup: boolean;
  groupId?: string;
  // Media fields (populated when the WhatsApp message is a media message)
  mediaKind?: 'image' | 'audio' | 'video' | 'document';
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaBuffer?: Buffer;
  mediaDuration?: number;
}

export interface WhatsAppSendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}
