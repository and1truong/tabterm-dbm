import { expect, test } from "bun:test";
import { binaryByteLength, decodeDbValue, encodeDbValue, isDbBinaryValue } from "./binaryValues.ts";

test("round-trips binary database values through a tagged JSON-safe representation", () => {
  const encoded = encodeDbValue(new Uint8Array([0, 1, 127, 128, 255]));
  expect(isDbBinaryValue(encoded)).toBe(true);
  expect(binaryByteLength(encoded as { __tabtermDbmBinary: string })).toBe(5);
  expect([...decodeDbValue(encoded) as Uint8Array]).toEqual([0, 1, 127, 128, 255]);
});

test("does not reinterpret ordinary JSON objects as binary", () => {
  const value = { __tabtermDbmBinary: "AA==", extra: true };
  expect(isDbBinaryValue(value)).toBe(false);
  expect(decodeDbValue(value)).toBe(value);
});
