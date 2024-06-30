// Tests for the data-encoder helper functions in ./data-encoder.ts

import { decodeData, encodeData } from "./data-encoder";

describe("data-encoder", () => {
  describe("encodeData", () => {
    it("should encode and decode a simple object", () => {
      const data = { a: 1, b: "2" };
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });
  });

  describe("decodeData", () => {
    it("should decode a simple object", () => {
      const data = { a: 1, b: "2" };
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });
  });
});
