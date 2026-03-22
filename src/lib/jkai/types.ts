export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string | null;
  attachments?: Attachment[];
  createdAt?: string;
}

export interface Attachment {
  type: 'image' | 'file' | 'code' | 'artifact';
  name: string;
  mimeType?: string;
  url?: string;
  content?: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
}

export interface StreamChunk {
  type: 'text' | 'thinking' | 'done' | 'error' | 'plan' | 'action';
  content: string;
}

export interface JkaiConfig {
  thinkingEnabled: boolean;
  model: string;
}
