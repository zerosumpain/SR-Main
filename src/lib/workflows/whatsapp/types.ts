export type WhatsAppServiceStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected';

export interface WhatsAppServiceState {
  status: WhatsAppServiceStatus;
  qrCode: string | null;
  connectedNumber: string | null;
}

export interface WhatsAppInboundMessage {
  from: string; // E.164 phone number
  text: string;
  timestamp: number;
  messageId: string;
  isGroup: boolean;
  groupId?: string;
}

export interface WhatsAppSendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}
