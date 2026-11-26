/**
 * Live sharing, the logic (docs/spec/notifications.md §2–§5), without React:
 * share a conversation, join from an invite, pull and merge everyone's copies,
 * and write this device's copy. Every copy is decrypted and merged with the
 * conversation merge (CV-8), so order and timing don't matter.
 */

import { Conversation, canonical, mergeConversations } from "../conversation";
import { hashString } from "../discussion";
import { BoxApi, LiveError, Notify } from "./box-api";
import {
  BoxSecrets,
  decryptCopy,
  encryptCopy,
  importBoxKey,
  inviteFragment,
  joinHash,
  newBoxSecrets,
  newDeviceKey,
} from "./box-crypto";
import { LiveEntry, LiveStore } from "./live-store";

type AuthorizeAccount = (method: string, pathAndQuery: string, body: Uint8Array) => Promise<string>;

const fingerprint = (c: Conversation) => hashString(canonical(c)).toString(36);

const commentIds = (c: Conversation) =>
  [...Object.values(c.topics), ...Object.values(c.areas)].flatMap((t) => t.comments.map((x) => x.id));

const member = (entry: LiveEntry) => ({ boxId: entry.boxId, device: entry.device });

/** The invite link for a live conversation (host only, while the invite lasts). */
export const inviteLink = (origin: string, entry: LiveEntry) =>
  entry.join ? `${origin}/talk#${inviteFragment({ boxId: entry.boxId, key: entry.key, join: entry.join })}` : null;

/** "Share live" (NT-10): makes the box, writes the first copy, and remembers it here. */
export const shareLive = async (
  { api, store }: { api: BoxApi; store: LiveStore },
  authorizeAccount: AuthorizeAccount,
  conversation: Conversation
): Promise<LiveEntry> => {
  const secrets: BoxSecrets = newBoxSecrets();
  const device = await newDeviceKey();
  const created = await api.create(authorizeAccount, {
    boxId: secrets.boxId,
    joinHash: await joinHash(secrets.join),
    hostKey: device.publicKey,
  });
  const key = await importBoxKey(secrets.key);
  const written = await api.put({ boxId: secrets.boxId, device }, null, await encryptCopy(key, secrets.boxId, device.memberId, 1, conversation), "none");
  const entry: LiveEntry = {
    conversationId: conversation.id,
    boxId: secrets.boxId,
    isHost: true,
    key: secrets.key,
    join: secrets.join,
    inviteExpiresAt: created.inviteExpiresAt,
    device,
    version: written.version,
    seq: 0,
    sentComments: commentIds(conversation),
    sentVersion: fingerprint(conversation),
  };
  await store.put(entry);
  return entry;
};

/** A new invite link, replacing the old one for new joins (NT-13). */
export const renewInvite = async ({ api, store }: { api: BoxApi; store: LiveStore }, entry: LiveEntry): Promise<LiveEntry> => {
  const join = newBoxSecrets().join;
  const { inviteExpiresAt } = await api.invite(member(entry), await joinHash(join));
  const next = { ...entry, join, inviteExpiresAt };
  await store.put(next);
  return next;
};

export class JoinError extends Error {
  constructor(readonly reason: "empty" | "unreadable" | "different") {
    super(reason);
    this.name = "JoinError";
  }
}

/**
 * Joins from an invite (NT-12): registers this device, reads every copy, and
 * returns the merged conversation (with this browser's copy, if it has one).
 */
export const joinLive = async (
  { api, store }: { api: BoxApi; store: LiveStore },
  invite: BoxSecrets,
  localCopy: (conversationId: string) => Conversation | null
): Promise<{ conversation: Conversation; entry: LiveEntry }> => {
  const device = await newDeviceKey();
  await api.join(invite.boxId, device, invite.join);
  const key = await importBoxKey(invite.key);
  const page = await api.copies({ boxId: invite.boxId, device }, 0);
  if (page.copies.length === 0) throw new JoinError("empty");
  let merged: Conversation | null = null;
  for (const copy of page.copies) {
    const c = await decryptCopy(key, invite.boxId, copy.memberId, copy.version, copy.ciphertext);
    if (!c) continue;
    if (merged && c.id !== merged.id) continue;
    merged = merged ? mergeConversations(merged, c) : c;
  }
  if (!merged) throw new JoinError("unreadable");
  const local = localCopy(merged.id);
  const conversation = local ? mergeConversations(local, merged) : merged;
  const entry: LiveEntry = {
    conversationId: conversation.id,
    boxId: invite.boxId,
    isHost: false,
    key: invite.key,
    device,
    version: null,
    seq: page.seq,
    sentComments: commentIds(merged),
    // Nothing of this device's own is on the server yet; what it has came from others.
    sentVersion: undefined,
    receivedVersion: fingerprint(conversation),
  };
  await store.put(entry);
  return { conversation, entry };
};

export type PullResult = {
  /** The local conversation merged with everyone's copies, or null if nothing changed. */
  conversation: Conversation | null;
  entry: LiveEntry;
  readOnly: boolean;
  members: number;
  /** Copies that didn't decrypt (NT-4), counted, never applied. */
  unreadable: number;
};

/** Reads copies changed since last time and merges them into `local` (NT-4). */
export const pullLive = async (
  { api, store }: { api: BoxApi; store: LiveStore },
  entry: LiveEntry,
  local: Conversation
): Promise<PullResult> => {
  const page = await api.copies(member(entry), entry.seq);
  const key = await importBoxKey(entry.key);
  let merged = local;
  let unreadable = 0;
  let version = entry.version;
  const known = new Set(entry.sentComments);
  for (const copy of page.copies) {
    if (copy.memberId === entry.device.memberId) version = Math.max(version ?? 0, copy.version);
    const c = await decryptCopy(key, entry.boxId, copy.memberId, copy.version, copy.ciphertext);
    if (!c || c.id !== local.id) {
      unreadable++;
      continue;
    }
    merged = mergeConversations(merged, c);
    // Comments that arrived from others aren't this device's news to announce.
    for (const id of commentIds(c)) known.add(id);
  }
  const clean = fingerprint(local) === entry.sentVersion || fingerprint(local) === entry.receivedVersion;
  const next: LiveEntry = {
    ...entry,
    seq: Math.max(entry.seq, page.seq),
    version,
    sentComments: [...known],
    receivedVersion: clean ? fingerprint(merged) : entry.receivedVersion,
  };
  await store.put(next);
  const changed = canonical(merged) !== canonical(local);
  return { conversation: changed ? merged : null, entry: next, readOnly: page.readOnly, members: page.members, unreadable };
};

/** What to tell the others about this write (NT-23): a new comment of ours, other edits, or nothing new. */
export const notifyFor = (entry: LiveEntry, local: Conversation): Notify => {
  const known = new Set(entry.sentComments);
  if (commentIds(local).some((id) => !known.has(id))) return "comment";
  const now = fingerprint(local);
  return now === entry.sentVersion || now === entry.receivedVersion ? "none" : "notes";
};

/** Whether this device's copy on the server is behind the local conversation. */
export const needsPush = (entry: LiveEntry, local: Conversation) =>
  entry.version === null || entry.sentVersion !== fingerprint(local);

/**
 * Writes this device's copy (NT-3). On a version mismatch (another tab of this
 * device wrote), it takes the server's version and tries once more; the caller
 * should pull first next time.
 */
export const pushLive = async (
  { api, store }: { api: BoxApi; store: LiveStore },
  entry: LiveEntry,
  local: Conversation
): Promise<LiveEntry> => {
  const key = await importBoxKey(entry.key);
  const notify = notifyFor(entry, local);
  const write = async (version: number | null) => {
    const ciphertext = await encryptCopy(key, entry.boxId, entry.device.memberId, (version ?? 0) + 1, local);
    return api.put(member(entry), version, ciphertext, notify);
  };
  let written;
  try {
    written = await write(entry.version);
  } catch (e) {
    const current = e instanceof LiveError && e.reason === "version_mismatch" ? (e.body.current as { version?: number } | null) : undefined;
    if (current === undefined) throw e;
    written = await write(typeof current?.version === "number" ? current.version : null);
  }
  const next: LiveEntry = {
    ...entry,
    version: written.version,
    sentComments: [...new Set([...entry.sentComments, ...commentIds(local)])],
    sentVersion: fingerprint(local),
  };
  await store.put(next);
  return next;
};

/** Leave (NT-14) or, for the host, stop sharing (NT-15). The conversation stays here. */
export const endLive = async ({ api, store }: { api: BoxApi; store: LiveStore }, entry: LiveEntry) => {
  try {
    if (entry.isHost) await api.remove(member(entry));
    else await api.leave(member(entry));
  } catch (e) {
    // Already gone on the server: forgetting it here is all that's left.
    if (!(e instanceof LiveError && e.reason === "not_found")) throw e;
  }
  await store.delete(entry.conversationId);
};
