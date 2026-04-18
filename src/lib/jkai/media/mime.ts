export type AttachmentKind = 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';

const MIME_TO_KIND: Record<string, AttachmentKind> = {
  // images
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'image/gif': 'image', 'image/heic': 'image', 'image/heif': 'image',
  // audio
  'audio/mpeg': 'audio', 'audio/mp3': 'audio', 'audio/ogg': 'audio',
  'audio/webm': 'audio', 'audio/wav': 'audio', 'audio/x-wav': 'audio',
  'audio/aac': 'audio', 'audio/mp4': 'audio', 'audio/opus': 'audio',
  'audio/flac': 'audio',
  // video
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
  'video/x-matroska': 'video',
  // pdf
  'application/pdf': 'pdf',
  // text (inlined)
  'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text',
  'text/html': 'text', 'text/xml': 'text', 'text/x-log': 'text',
  'application/json': 'text', 'application/xml': 'text',
  'application/x-yaml': 'text', 'text/yaml': 'text',
  'text/javascript': 'text', 'application/typescript': 'text',
  'text/x-python': 'text', 'text/x-rust': 'text', 'text/x-go': 'text',
  'text/x-c': 'text', 'text/x-c++': 'text',
  // binary docs
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/msword': 'document',
  'application/vnd.ms-excel': 'document',
  'application/rtf': 'document',
  'application/zip': 'document',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/opus': 'opus',
  'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv',
  'text/html': 'html', 'text/xml': 'xml', 'text/x-log': 'log',
  'application/json': 'json', 'application/xml': 'xml',
  'application/x-yaml': 'yaml', 'text/yaml': 'yaml',
  'text/javascript': 'js', 'application/typescript': 'ts',
  'text/x-python': 'py', 'text/x-rust': 'rs', 'text/x-go': 'go',
  'text/x-c': 'c', 'text/x-c++': 'cpp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/rtf': 'rtf',
  'application/zip': 'zip',
};

export function kindFromMime(mime: string): AttachmentKind | null {
  return MIME_TO_KIND[mime] ?? null;
}

export function extensionForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'bin';
}

export function isAllowedMime(mime: string): boolean {
  return mime in MIME_TO_KIND;
}
