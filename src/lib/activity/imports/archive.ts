const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const;

export function hasZipMagic(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURES.some((signature) =>
    signature.every((value, index) => bytes[index] === value),
  );
}
