import type { NotifyResult } from './index';

/**
 * What a raise did, in the words a workflow run or a tool result wants:
 * per channel, and one line. Shared by the `notify` workflow node and the
 * `notify_owner` site tool so both report delivery identically.
 *
 * `iphone: 'queued'` means the phone will collect it on its next refresh — the
 * ledger cannot know more than that (see `nativeAt` in the schema).
 */
export interface DeliveryReport {
  raised: boolean;
  id: string | null;
  /** Why nothing went: throttled, duplicate, error — or null. */
  reason: string | null;
  whatsapp: 'sent' | 'failed' | 'off';
  iphone: 'queued' | 'off';
  /** e.g. "WhatsApp + iPhone", "iPhone", "suppressed (duplicate)". */
  channels: string;
}

export function deliveryReport(result: NotifyResult): DeliveryReport {
  const routed = result.routed ?? { whatsapp: false, native: false };
  const whatsapp = !result.raised || !routed.whatsapp ? 'off' : result.whatsapp ? 'sent' : 'failed';
  const iphone = result.raised && routed.native ? 'queued' : 'off';
  const parts = [
    whatsapp === 'sent' ? 'WhatsApp' : whatsapp === 'failed' ? 'WhatsApp (failed)' : null,
    iphone === 'queued' ? 'iPhone' : null,
  ].filter(Boolean);
  const channels = !result.raised
    ? `suppressed (${result.reason ?? (result.routed ? 'all channels off' : 'error')})`
    : parts.join(' + ') || 'ledger only';
  return { raised: result.raised, id: result.id ?? null, reason: result.reason ?? null, whatsapp, iphone, channels };
}
