/**
 * Menu ids (spec SY-20): 128 random bits in base64url, 22 characters, the same
 * shape the sync server expects. They identify a menu in this browser's storage
 * and in sync, and never appear in links.
 */

export const MENU_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const newMenuId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
