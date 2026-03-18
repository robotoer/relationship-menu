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

    it("should encode a string", () => {
      const data = "hello world";
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode a number", () => {
      const data = 42;
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode an array", () => {
      const data = [1, "two", { three: 3 }];
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode an empty object", () => {
      const data = {};
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode an empty array", () => {
      const data: any[] = [];
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode null", () => {
      const data = null;
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode nested objects", () => {
      const data = {
        menu: {
          Physical: [
            { item: "Kissing", value: "must-have" },
            { item: "Hugging", value: "like-to-have" },
          ],
          Emotional: [
            { item: "Trust", value: "maybe" },
          ],
        },
      };
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode special characters", () => {
      const data = { name: "café & résumé — über" };
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should return a non-empty string", () => {
      const encoded = encodeData({ key: "value" });
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe("string");
      expect(encoded.length).toBeGreaterThan(0);
    });

    it("should produce different encoded strings for different data", () => {
      const encoded1 = encodeData({ a: 1 });
      const encoded2 = encodeData({ a: 2 });
      expect(encoded1).not.toEqual(encoded2);
    });

    it("should produce consistent encoding for the same data", () => {
      const data = { a: 1, b: "2" };
      const encoded1 = encodeData(data);
      const encoded2 = encodeData(data);
      expect(encoded1).toEqual(encoded2);
    });
  });

  describe("decodeData", () => {
    it("should decode a simple object", () => {
      const data = { a: 1, b: "2" };
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });

    it("should throw on invalid encoded data", () => {
      expect(() => decodeData("not-valid-base64!!!")).toThrow();
    });

    it("should handle boolean values", () => {
      const data = { flag: true, other: false };
      const encoded = encodeData(data);
      const decoded = decodeData(encoded);
      expect(decoded).toEqual(data);
    });
  });
});
