/**
 * The AI coach client for a supporter's sync account (docs/spec/coach.md):
 * signs each POST /v1/coach exactly like sync requests (SY-6).
 *
 * Wiring point: once the sync client holds a supporter's SyncKeys and knows the
 * account is active (or past due, or lifetime), pass
 * `createSyncCoachClient(keys, origin)` as the `coach` prop of DiscussPage.
 */

import { createCoachClient, type CoachClient } from "../coach";
import type { SyncKeys } from "./keys";
import { authorizationHeader } from "./sign";

export const createSyncCoachClient = (
  keys: Pick<SyncKeys, "accountId" | "publicKey" | "signingKey">,
  /** The sync server's origin, e.g. "https://wantsandwonts.com" (no trailing slash). */
  origin: string,
  options: { fetch?: typeof fetch; now?: () => number } = {}
): CoachClient =>
  createCoachClient({
    origin,
    fetch: options.fetch,
    authorize: (method, pathAndQuery, body) =>
      authorizationHeader(keys, method, pathAndQuery, body, Math.floor((options.now ?? Date.now)() / 1000)),
  });
