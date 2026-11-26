/**
 * Supporter sync as the app's screens see it (spec §2, §3, §8 and §9 in
 * docs/spec/sync.md). This is the contract between the sync runtime
 * (`src/providers/Sync.tsx`) and the screens that use it: sync settings, the
 * pairing page, the Support page and the navbar heart.
 *
 * Screens read `state` and call the actions. They never touch keys, the stored
 * sync code or the network themselves, and they never pass an account id, code,
 * word, menu id, Stripe id or URL to analytics (SY-75). Tests render screens with
 * `FakeSyncProvider` (`src/sync/fake-sync.tsx`).
 */

import { createContext, useContext } from "react";

/** The server's plan ids (SY-60), as `POST /v1/checkout` takes them. */
export type CheckoutPlan =
  | "supporter_6_yearly"
  | "supporter_12_yearly"
  | "supporter_24_yearly"
  | "supporter_30_lifetime";

/** Supporter status from `GET /v1/account`. `none`: the server has no supporter record for this account. */
export type AccountStatus = "none" | "active" | "past_due" | "lifetime" | "lapsed";

/** `GET /v1/account` (server/README.md). Times are Unix milliseconds. */
export type SyncAccount = {
  status: AccountStatus;
  plan: CheckoutPlan | null;
  /** When a yearly plan renews, or ends if it was cancelled. Null for lifetime and `none`. */
  renewsAt: number | null;
  /** The server refuses pushes: no supporter status, or lapsed (SY-66). Pulls still work. */
  readOnly: boolean;
  lapsedAt: number | null;
  /** When a lapsed account's synced menus are deleted (SY-67). */
  purgeAt: number | null;
  /** Within 30 days of `purgeAt`, so the app warns (SY-67). */
  purgeSoon: boolean;
  limits: { menus: number; menuBytes: number; totalBytes: number };
  usage: { menus: number; bytes: number };
};

/** Statuses that show the heart (SY-71) and allow pushes. */
export const SUPPORTER_STATUSES: readonly AccountStatus[] = ["active", "past_due", "lifetime"];

/**
 * Something sync settings should say, while it lasts:
 * - `offline`: the server can't be reached; changes wait on this device and are retried (SY-31).
 * - `not_supporter`: sync is on but the account has no supporter status, so nothing is pushed yet.
 * - `read_only`: the account lapsed; pulls still work, pushes are refused (SY-66).
 * - `storage_full`: over the account's quota (SY-23, 507).
 * - `menu_too_large`: a menu is over 64 KiB and can't be synced (413).
 * - `unreadable`: some synced data couldn't be read (SY-17).
 * - `code_replaced`: the sync code was replaced on another device (SY-8).
 */
export type SyncNotice =
  | "offline"
  | "not_supporter"
  | "read_only"
  | "storage_full"
  | "menu_too_large"
  | "unreadable"
  | "code_replaced";

export type SyncState =
  /** Still checking whether this browser can sync (SY-14), or reading local sync state. */
  | { kind: "loading" }
  /** No WebCrypto Ed25519 or AES-GCM: sync can't be turned on in this browser (SY-14). */
  | { kind: "unsupported" }
  | { kind: "off" }
  | {
      kind: "on";
      /** The last status the server reported. Null until it first answers (kept on the device, so the heart doesn't flicker). */
      account: SyncAccount | null;
      /** Menus changed here and not yet pushed. */
      pending: number;
      /** When this device last finished a pull. Null if it hasn't yet. */
      lastSyncedAt: number | null;
      notices: SyncNotice[];
      /** Records skipped because they couldn't be read (SY-17). */
      unreadable: number;
    };

/** "Add a device" (SY-10). */
export type PairingOffer = {
  /** `<origin>/pair#<key>`, for the QR code. Never log, track or put it anywhere but the QR code. */
  link: string;
  /** Unix ms when the server forgets the pairing: 10 minutes after it was made. */
  expiresAt: number;
};

/**
 * Why an action failed. The screen picks the words.
 * - `offline`: no answer from the server (or a 5xx). Don't assume the server did nothing (a reply can be
 *   lost after it acted), nor that this device's own setup was undone: `checkout()` with sync off keeps
 *   the new sync code it made even if Checkout then fails. Trying again is safe.
 * - `rate_limited`: 429. Try again in a minute.
 * - `not_supporter`: the action needs supporter status (pairing, Checkout's portal).
 * - `already_supporter`: Checkout for an account that's already a supporter (409).
 * - `pairing_used`, `pairing_expired`, `pairing_not_found`: a pairing link that no longer works (SY-12).
 * - `pairing_unreadable`: the link's key doesn't open the blob (a mistyped or altered link).
 * - `code_unconfirmed`: a new sync code is being made, or was made but the server's answer was lost
 *   and it isn't confirmed yet (SY-8). Turning sync off, switching codes, deleting synced data and
 *   replacing the code again wait until it is; sync checks again by itself (every 30 s, and when
 *   the tab is shown). Try again once online.
 * - `unavailable`: sync isn't available here (unsupported browser, or no provider).
 * - `failed`: anything else.
 */
export type SyncErrorReason =
  | "offline"
  | "rate_limited"
  | "not_supporter"
  | "already_supporter"
  | "pairing_used"
  | "pairing_expired"
  | "pairing_not_found"
  | "pairing_unreadable"
  | "code_unconfirmed"
  | "unavailable"
  | "failed";

export class SyncError extends Error {
  constructor(
    readonly reason: SyncErrorReason,
    message: string = reason
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/**
 * What the screens can do. Every action that fails rejects with a `SyncError`,
 * except `restore`, which rejects with `SyncCodeError` (src/sync/sync-code.ts) for
 * a code that doesn't parse. The runtime records `sync_enabled` and `device_paired`
 * itself; the Support page records the `checkout_*` events.
 */
export type SyncActions = {
  /** Turns sync on with a new sync code (SY-1). Local menus are kept and will be uploaded (SY-13). */
  turnOn(): Promise<void>;
  /** Turns sync on with typed words (SY-5, SY-13). Rejects with `SyncCodeError` for a bad code. */
  restore(words: string): Promise<void>;
  /** Turns sync on from a pairing link's key, as `pairingKeyFromFragment` read it (SY-10, SY-11). */
  joinPairing(key: Uint8Array): Promise<void>;
  /** The 24 words, for "Show my sync code" (SY-3). Hold them only while they're shown. */
  syncCode(): Promise<string[]>;
  /** "Add a device": uploads a pairing blob (SY-10). Needs supporter status. */
  offerPairing(): Promise<PairingOffer>;
  /** Turns off sync on this device only (SY-9). Menus stay on the device and on the server. */
  turnOff(): Promise<void>;
  /** Replaces the sync code (SY-8). Other devices then need the new code. */
  replaceCode(): Promise<void>;
  /** Deletes every synced menu and the account, cancels any subscription, and turns off sync here (SY-68). */
  deleteSyncedData(): Promise<void>;
  /** A Stripe Checkout URL for `plan` (SY-61). Turns sync on with a new code first if it's off. */
  checkout(plan: CheckoutPlan): Promise<string>;
  /** A Stripe Customer Portal URL (SY-64). Needs a Stripe customer (supporter now or before). */
  manageSubscription(): Promise<string>;
  /** Asks the server for the account status again, e.g. after returning from Checkout. Null if sync is off. */
  refreshAccount(): Promise<SyncAccount | null>;
  /** Pulls and pushes now. */
  syncNow(): void;
};

export type SyncContextValue = { state: SyncState } & SyncActions;

/** Whether this device's account is a supporter (SY-71: shows the heart). */
export const isSupporter = (state: SyncState): boolean =>
  state.kind === "on" && state.account !== null && SUPPORTER_STATUSES.includes(state.account.status);

const unavailable = () => Promise.reject(new SyncError("unavailable", "Sync isn't available here."));

/** Outside a `SyncProvider` (some unit tests), sync is simply off and every action rejects. */
export const NO_SYNC: SyncContextValue = {
  state: { kind: "off" },
  turnOn: unavailable,
  restore: unavailable,
  joinPairing: unavailable,
  syncCode: unavailable,
  offerPairing: unavailable,
  turnOff: unavailable,
  replaceCode: unavailable,
  deleteSyncedData: unavailable,
  checkout: unavailable,
  manageSubscription: unavailable,
  refreshAccount: () => Promise.resolve(null),
  syncNow: () => {},
};

export const SyncContext = createContext<SyncContextValue>(NO_SYNC);

/** Sync's state and actions (see `SyncActions`). */
export const useSync = (): SyncContextValue => useContext(SyncContext);
