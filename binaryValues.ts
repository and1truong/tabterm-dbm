const BINARY_TAG = "__tabtermDbmBinary";

export interface DbBinaryValue { __tabtermDbmBinary: string }

export function isDbBinaryValue(value: unknown): value is DbBinaryValue {
  return !!value && typeof value === "object"
    && Object.keys(value).length === 1
    && typeof (value as Record<string, unknown>)[BINARY_TAG] === "string";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function encodeDbValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { [BINARY_TAG]: bytesToBase64(value) };
  return value;
}

export function decodeDbValue(value: unknown): unknown {
  if (!isDbBinaryValue(value)) return value;
  const binary = atob(value[BINARY_TAG]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function binaryByteLength(value: DbBinaryValue): number {
  const base64 = value[BINARY_TAG];
  return Math.max(0, Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0));
}
