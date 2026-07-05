// Blog image store → Azure Blob. Thin bindings over the shared core
// ($lib/storage/azure-blob), bound to the 'blog' container. Buffer-only.
import * as core from '../storage/azure-blob';

export const isAzureStorageEnabled = core.isAzureStorageEnabled;

function c(): string {
  return process.env.AZURE_BLOG_CONTAINER || 'blog';
}

export const azSaveBuffer = (blob: string, buf: Buffer): Promise<void> => core.azUploadBuffer(c(), blob, buf);
export const azReadBuffer = (blob: string): Promise<Buffer> => core.azDownloadBuffer(c(), blob);
