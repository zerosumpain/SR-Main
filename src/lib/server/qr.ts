import QRCode from 'qrcode';

/**
 * The one QR renderer. Five pages drew their own with five margins and
 * scales; a code that scans from /welcome should scan from a person's page.
 * Rendered server-side as a data URL so no page needs a QR library and the
 * text it encodes (a pairing code, a join link) crosses as an image.
 */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, scale: 6 });
}
