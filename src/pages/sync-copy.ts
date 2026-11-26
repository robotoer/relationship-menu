/**
 * The words the sync screens use (docs/spec/sync.md), shared by sync settings
 * and the pairing page. Sentences a rule quotes are kept word for word, and the
 * tests check them against the rule.
 *
 * Nothing here ever includes a code, word, link, id or an error's own message,
 * except a `SyncCodeError`'s, which is written to be shown and never quotes the
 * words (src/sync/sync-code.ts).
 */

import type { CheckoutPlan, SyncErrorReason, SyncNotice } from "../sync/context";
import { SyncError } from "../sync/context";
import { SyncCodeError } from "../sync/sync-code";

/** SY-4, word for word: shown above the words wherever they appear. */
export const SYNC_CODE_WARNING =
  "These 24 words are the only key to your synced menus. We can't see them and can't recover them. If you lose every device and these words, your synced menus are gone. Keep them in a password manager or on paper.";

/** SY-14: a browser that can't sync. */
export const UNSUPPORTED_TEXT = [
  "This browser can't sync. Sync needs Chrome or Edge 137 or later, Safari 17 or later, or Firefox 129 or later.",
  "Everything else works here as usual, and your menus are still saved in this browser.",
];

/** SY-13. */
export const LOCAL_MENUS_KEPT = "Menus already on this device are kept, and uploaded along with the rest.";

/**
 * One line per notice. SY-17, SY-23 and SY-8's sentences are word for word.
 * `code_replaced` also shows when the synced data was deleted elsewhere (SY-68) or purged (SY-67).
 */
export const NOTICE_TEXT: Record<SyncNotice, string> = {
  offline:
    "Can't reach the sync server right now. Changes are saved on this device and will upload when it's back.",
  not_supporter: "Sync is on, but nothing uploads until you support the project.",
  read_only:
    "Your supporter plan has ended, so changes made here aren't uploaded. This device can still download your synced menus.",
  storage_full: "Sync storage is full. Your menus are still saved on this device.",
  menu_too_large: "A menu is too big to sync (over 64 KB). It's still saved on this device.",
  unreadable: "Some synced data couldn't be read.",
  code_replaced:
    "Your sync code was replaced, or your synced data was deleted, on another device or after your plan ended. Enter the new code to keep syncing, or turn off sync on this device.",
};

/** Plain words for every way an action can fail. */
export const ERROR_TEXT: Record<SyncErrorReason, string> = {
  // Not "nothing changed": a reply can be lost after the server acted. Trying again is safe.
  offline: "Couldn't reach the sync server. Check your connection and try again.",
  rate_limited: "That's a lot of tries in a short time. Wait a minute, then try again.",
  not_supporter: "That needs supporter status.",
  already_supporter: "This sync code already has supporter status.",
  pairing_used: "This link has already been used.",
  pairing_expired: "This link has expired. A link works for 10 minutes.",
  pairing_not_found: "This link doesn't work any more. It may have expired or been used.",
  pairing_unreadable: "This link doesn't work. It may not have been copied completely.",
  code_unconfirmed: "Your new sync code is still being confirmed. Try again once you're online.",
  unavailable: "Sync isn't available in this browser.",
  failed: "Something went wrong. Try again.",
};

/** SY-8: `replaceCode()` couldn't learn its outcome, so the new code is kept but not confirmed yet. The runtime keeps checking. */
export const REPLACE_UNCONFIRMED =
  "Couldn't confirm the new sync code yet. Sync is paused while we keep trying, so don't turn off sync on this device meanwhile.";

/** SY-12: added when a pairing link was already used. */
export const PAIRING_USED_ADVICE = "If that wasn't you, replace your sync code.";

/** Why an action failed, as `SyncErrorReason`; anything unexpected is `failed`. */
export const errorReason = (error: unknown): SyncErrorReason =>
  error instanceof SyncError && error.reason in ERROR_TEXT ? error.reason : "failed";

/** What to show for a failed action. Never an unexpected error's own message. */
export const errorText = (error: unknown): string =>
  error instanceof SyncCodeError ? error.message : ERROR_TEXT[errorReason(error)];

export const PLAN_TEXT: Record<CheckoutPlan, string> = {
  supporter_6_yearly: "$6 a year",
  supporter_12_yearly: "$12 a year",
  supporter_24_yearly: "$24 a year",
  supporter_30_lifetime: "$30 once",
};

/** "25 November 2027", in the reader's own format. */
export const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** "25 Nov 2027, 14:05", in the reader's own format. */
export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
