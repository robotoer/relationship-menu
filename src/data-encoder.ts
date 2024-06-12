/**
 * Contains helper functions that encode and decode json data into a string that can be stored in a URL as a query parameter.
 */

export const encodeData = (data: any): string => {
  return Buffer.from(JSON.stringify(data)).toString("base64");
};

export const decodeData = (data: string): any => {
  return JSON.parse(Buffer.from(data, "base64").toString());
};
