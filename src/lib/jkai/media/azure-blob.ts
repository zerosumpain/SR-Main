// jkai media store → Azure Blob. Thin bindings over the shared core
// ($lib/storage/azure-blob), bound to the 'media' container. The media store is
// buffer-only (no streaming/append), so only these three ops are surfaced.
import * as core from '../../storage/azure-blob';

export const isAzureStorageEnabled = core.isAzureStorageEnabled;

function c(): string {
  return process.env.AZURE_MEDIA_CONTAINER || 'media';
}

export const azSaveBuffer = (blob: string, buf: Buffer): Promise<void> => core.azUploadBuffer(c(), blob, buf);
export const azReadBuffer = (blob: string): Promise<Buffer> => core.azDownloadBuffer(c(), blob);
export const azDelete = (blob: string): Promise<void> => core.azDelete(c(), blob);
