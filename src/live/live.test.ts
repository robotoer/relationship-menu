import { IDBFactory } from "fake-indexeddb";
import { encodeMenuSlug } from "../compare-slug";
import { addComment, newConversation, updateAreaNotes, updateTopic } from "../conversation";
import { createBoxApi, LiveError } from "./box-api";
import {
  copyAad,
  decryptCopy,
  encryptCopy,
  importBoxKey,
  inviteFragment,
  newBoxSecrets,
  newDeviceKey,
  padCopy,
  parseInvite,
  unpadCopy,
} from "./box-crypto";
import { createFakeBoxServer } from "./fake-box-server";
import { createLiveStore } from "./live-store";
import { endLive, inviteLink, joinLive, needsPush, notifyFor, pullLive, pushLive, renewInvite, shareLive } from "./live-session";

const ana = encodeMenuSlug("Ana's", { G: [{ item: "Kids", value: "must-have" }, { item: "Pets", value: "maybe" }] }, { name: "Ana" });
const ben = encodeMenuSlug("Ben's", { G: [{ item: "Kids", value: "off-limits" }, { item: "Pets", value: "must-have" }] }, { name: "Ben" });
const ID = "LiveTestConversation00";
const KIDS = "g\u0000kids";

/** One person's device: its own storage, the shared fake server. */
const device = (server: ReturnType<typeof createFakeBoxServer>) => ({
  api: createBoxApi({ fetch: server.fetch }),
  store: createLiveStore(new IDBFactory()),
});
const account = async () => "MenuSync v1 account=AccountAccountAccount0, key=x, ts=1, sig=y";

describe("box crypto (NT-1, NT-2, NT-11)", () => {
  it("invite links round-trip, and junk isn't an invite", () => {
    const s = newBoxSecrets();
    const back = parseInvite(`https://x/talk#${inviteFragment(s)}`)!;
    expect(back.boxId).toBe(s.boxId);
    expect(Array.from(back.key)).toEqual(Array.from(s.key));
    expect(Array.from(back.join)).toEqual(Array.from(s.join));
    expect(parseInvite("https://x/talk#live=short.a.b")).toBeNull();
    expect(parseInvite("https://x/talk#c=abc")).toBeNull();
  });

  it("pads to 4 KiB blocks and refuses anything pad() wouldn't write", () => {
    const padded = padCopy(new Uint8Array([1, 2, 3]));
    expect(padded.length).toBe(4096);
    expect(Array.from(unpadCopy(padded)!)).toEqual([1, 2, 3]);
    padded[100] = 1;
    expect(unpadCopy(padded)).toBeNull();
  });

  it("a copy only decrypts for its own box, member and version", async () => {
    const s = newBoxSecrets();
    const key = await importBoxKey(s.key);
    const d = await newDeviceKey();
    const c = newConversation([ana, ben], 1000, ID);
    const sealed = await encryptCopy(key, s.boxId, d.memberId, 3, c);
    expect(sealed.length % 4096).toBe(12 + 16);
    expect((await decryptCopy(key, s.boxId, d.memberId, 3, sealed))?.id).toBe(ID);
    const other = await newDeviceKey();
    expect(await decryptCopy(key, s.boxId, other.memberId, 3, sealed)).toBeNull(); // moved to another member
    expect(await decryptCopy(key, s.boxId, d.memberId, 2, sealed)).toBeNull(); // presented as an older version
    expect(await decryptCopy(key, newBoxSecrets().boxId, d.memberId, 3, sealed)).toBeNull(); // another box
    const flipped = new Uint8Array(sealed);
    flipped[40] ^= 1;
    expect(await decryptCopy(key, s.boxId, d.memberId, 3, flipped)).toBeNull();
    expect(new TextDecoder().decode(sealed)).not.toContain("Ana");
    expect(() => copyAad("bad", d.memberId, 1)).toThrow();
  });
});

describe("live sharing (NT-3, NT-4, NT-10…NT-15)", () => {
  it("Ana shares, Ben joins and comments, Ana pulls it in; the notify header says what happened", async () => {
    const server = createFakeBoxServer();
    const A = device(server);
    const B = device(server);
    let anaLocal = updateAreaNotes(newConversation([ana, ben], 1000, ID), "G", 0, { matters: "Being chosen" }, 2000);

    let anaEntry = await shareLive(A, account, anaLocal);
    expect(anaEntry.isHost).toBe(true);
    const link = inviteLink("https://x", anaEntry)!;

    // Ben joins from the link: he gets the whole conversation.
    const joined = await joinLive(B, parseInvite(link)!, () => null);
    expect(joined.conversation.id).toBe(ID);
    expect(joined.conversation.areas.G.people["0"].matters).toBe("Being chosen");
    let benLocal = addComment(joined.conversation, { topic: KIDS }, 1, "Can we talk Sunday?", 3000, "c".repeat(22));
    expect(notifyFor(joined.entry, benLocal)).toBe("comment");
    let benEntry = await pushLive(B, joined.entry, benLocal);
    expect(server.notifications.at(-1)).toMatchObject({ notify: "comment" });
    expect(needsPush(benEntry, benLocal)).toBe(false);

    // Ana pulls: Ben's comment arrives, her notes are kept.
    const pulled = await pullLive(A, anaEntry, anaLocal);
    expect(pulled.members).toBe(2);
    expect(pulled.conversation!.topics[KIDS].comments[0].text).toBe("Can we talk Sunday?");
    expect(pulled.conversation!.areas.G.people["0"].matters).toBe("Being chosen");
    anaLocal = pulled.conversation!;
    anaEntry = pulled.entry;
    // Catching her copy up with Ben's comment isn't news of hers.
    expect(notifyFor(anaEntry, anaLocal)).toBe("none");
    anaEntry = await pushLive(A, anaEntry, anaLocal);
    expect(server.notifications.at(-1)).toMatchObject({ notify: "none" });

    // An outcome is "notes"; pulling again with nothing new changes nothing.
    anaLocal = updateTopic(anaLocal, KIDS, { outcome: "revisit" }, 4000);
    expect(notifyFor(anaEntry, anaLocal)).toBe("notes");
    anaEntry = await pushLive(A, anaEntry, anaLocal);
    const again = await pullLive(A, anaEntry, anaLocal);
    expect(again.conversation).toBeNull();

    // Ben gets Ana's outcome.
    const benPull = await pullLive(B, benEntry, benLocal);
    expect(benPull.conversation!.topics[KIDS].outcome).toBe("revisit");
    benEntry = benPull.entry;
    benLocal = benPull.conversation!;

    // Ben leaves: his copy goes, the conversation stays with him.
    await endLive(B, benEntry);
    expect(await B.store.get(ID)).toBeNull();
    expect([...server.boxes.get(anaEntry.boxId)!.copies.keys()]).toEqual([anaEntry.device.memberId]);
    // Ana stops sharing: the box is gone.
    await endLive(A, anaEntry);
    expect(server.boxes.size).toBe(0);
  });

  it("joining a box with the wrong secret, or after a new invite, fails; the new link works", async () => {
    const server = createFakeBoxServer();
    const A = device(server);
    const entry = await shareLive(A, account, newConversation([ana, ben], 1000, ID));
    const old = parseInvite(inviteLink("https://x", entry)!)!;
    const renewed = await renewInvite(A, entry);
    await expect(joinLive(device(server), old, () => null)).rejects.toMatchObject({ reason: "bad_join" });
    await expect(joinLive(device(server), { ...old, join: new Uint8Array(32) }, () => null)).rejects.toBeInstanceOf(LiveError);
    const ok = await joinLive(device(server), parseInvite(inviteLink("https://x", renewed)!)!, () => null);
    expect(ok.conversation.id).toBe(ID);
  });

  it("two tabs of one device racing: a version mismatch is retried on the server's version", async () => {
    const server = createFakeBoxServer();
    const A = device(server);
    const c = newConversation([ana, ben], 1000, ID);
    const entry = await shareLive(A, account, c);
    // Another tab wrote version 2 meanwhile.
    const other = await pushLive(A, entry, updateTopic(c, KIDS, { note: "tab 2" }, 2000));
    expect(other.version).toBe(2);
    const stale = { ...entry, version: 1 };
    const next = await pushLive(A, stale, updateTopic(c, KIDS, { note: "tab 1" }, 3000));
    expect(next.version).toBe(3);
  });

  it("a copy that doesn't decrypt is counted and never applied (NT-4)", async () => {
    const server = createFakeBoxServer();
    const A = device(server);
    const c = newConversation([ana, ben], 1000, ID);
    const entry = await shareLive(A, account, c);
    const joined = await joinLive(device(server), parseInvite(inviteLink("https://x", entry)!)!, () => null);
    // The server swaps Ben's copy for garbage.
    const box = server.boxes.get(entry.boxId)!;
    box.seq += 1;
    box.copies.set(joined.entry.device.memberId, { version: 1, seq: box.seq, updatedAt: 1, ciphertext: new Uint8Array(4124) });
    const pulled = await pullLive(A, entry, c);
    expect(pulled.unreadable).toBe(1);
    expect(pulled.conversation).toBeNull();
  });

  it("a joining device keeps what it already had of the same conversation", async () => {
    const server = createFakeBoxServer();
    const host = newConversation([ana, ben], 1000, ID);
    const entry = await shareLive(device(server), account, host);
    const mine = updateTopic(newConversation([ana, ben], 1000, ID), KIDS, { note: "from my earlier link" }, 5000);
    const { conversation } = await joinLive(device(server), parseInvite(inviteLink("https://x", entry)!)!, (id) => (id === ID ? mine : null));
    expect(conversation.topics[KIDS].note).toBe("from my earlier link");
  });
});
