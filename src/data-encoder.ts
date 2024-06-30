/**
 * Contains helper functions that encode and decode json data into a string that can be stored in a URL as a query parameter.
 */

export const encodeData = (data: any): string => {
  // TODO: Use zlib to compress data before base64 encoding
  return btoa(JSON.stringify(data));
  // return Buffer.from(JSON.stringify(data)).toString("base64");
};

export const decodeData = (data: string): any => {
  // TODO: Use zlib to decompress data after base64 decoding
  return JSON.parse(atob(data));
  // return JSON.parse(Buffer.from(data, "base64").toString());
};
