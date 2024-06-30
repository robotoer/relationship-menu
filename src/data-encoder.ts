/**
 * Contains helper functions that encode and decode json data into a string that can be stored in a URL as a query parameter.
 */

import { deflate, inflate } from "pako";

export const encodeData = (data: any): string => {
  const stringified = JSON.stringify(data);
  const compressed = deflate(stringified);
  return btoa(String.fromCharCode(...compressed));
};

export const decodeData = (data: string): any => {
  const decoded = new Uint8Array(atob(data).split("").map((x) => x.charCodeAt(0)));
  const decompressed = inflate(decoded, { to: "string" });
  return JSON.parse(decompressed);
};
