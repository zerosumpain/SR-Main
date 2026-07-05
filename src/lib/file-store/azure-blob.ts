// /drive file store → Azure Blob. Thin bindings over the shared core
// ($lib/storage/azure-blob), bound to the 'drive' container. The dispatcher in
// ./storage.ts imports these names and decides fs-vs-Azure.
import type { Readable } from 'node:stream';
import * as core from '../storage/azure-blob';

export const isAzureStorageEnabled = core.isAzureStorageEnabled;

function c(): string {
  return process.env.AZURE_BLOB_CONTAINER || 'drive';
}

export const azSaveBuffer = (blob: string, buf: Buffer): Promise<void> => core.azUploadBuffer(c(), blob, buf);
export const azReadBuffer = (blob: string): Promise<Buffer> => core.azDownloadBuffer(c(), blob);
export const azAppendBuffer = (blob: string, buf: Buffer): Promise<number> => core.azAppendBuffer(c(), blob, buf);
export const azDelete = (blob: string): Promise<void> => core.azDelete(c(), blob);
export const azSize = (blob: string): Promise<number> => core.azSize(c(), blob);
export const azSaveStream = (blob: string, r: Readable): Promise<number> => core.azUploadStream(c(), blob, r);
export const azReadStream = (blob: string): Promise<Readable> => core.azDownloadStream(c(), blob);
export const azCopy = (src: string, dst: string): Promise<void> => core.azCopy(c(), src, dst);
