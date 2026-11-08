/**
 * The follow-up queue's WhatsApp sender, registered at boot.
 *
 * The queue used to import the WhatsApp service directly, which made chat and
 * the WhatsApp integration import each other. The integration registers its
 * sender here instead (`$lib/integrations/platform-boot`), the same inversion
 * `$lib/server/notify` uses for its owner channel. Absent means this process
 * has no sender, and the follow-up stays in chat only.
 */
export type WhatsAppSend = (to: string, text: string) => Promise<{ sent: boolean; error?: string }>;

let sender: WhatsAppSend | null = null;

export function registerFollowupWhatsAppSender(send: WhatsAppSend): void {
  sender = send;
}

export function followupWhatsAppSender(): WhatsAppSend | null {
  return sender;
}
