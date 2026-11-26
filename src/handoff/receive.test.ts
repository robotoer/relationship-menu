import { encodeData } from "../data-encoder";
import { RelationshipMenuDocument } from "../model/menu";
import type { Storage } from "../storage";
import { createLocalStorage } from "../storage";
import { encodeHandoffRequest, parseHandoffReply } from "./format";
import { captureImportFragment, importCaptured, importHandoff } from "./receive";

/** The new address's /import (spec HO-4, HO-5). */

const OLD = "https://old.test";
const ID = "AAAAAAAAAAAAAAAAAAAAAA";
const walks = encodeData({ Together: [{ item: "Walks", value: "must-have" }] });
const tea = encodeData({ Together: [{ item: "Tea" }] });
const request = (menus: { title: string; encoded: string }[]) => encodeHandoffRequest({ id: ID, menus });

const replyOf = (url: string) => {
  expect(url.startsWith(`${OLD}/#`)).toBe(true);
  return parseHandoffReply(new URL(url).hash);
};

beforeEach(() => localStorage.clear());

describe("HO-5: the importer clears the fragment first", () => {
  it("takes the fragment out of the address bar, keeping the history entry's state", () => {
    const history = { state: { key: "k" }, replaceState: vi.fn() };
    captureImportFragment({ pathname: "/import", search: "?x=1", hash: `#${request([])}` }, history);
    expect(history.replaceState).toHaveBeenCalledWith({ key: "k" }, "", "/import?x=1");
  });

  it("leaves every other page alone", () => {
    const history = { state: null, replaceState: vi.fn() };
    captureImportFragment({ pathname: "/menu", search: "?encoded=x", hash: "#top" }, history);
    captureImportFragment({ pathname: "/import", search: "", hash: "" }, history);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("imports what it took, once per page load", async () => {
    const history = { state: null, replaceState: vi.fn() };
    captureImportFragment({ pathname: "/import", search: "", hash: `#${request([{ title: "Us", encoded: walks }])}` }, history);
    const storage = createLocalStorage();
    const save = vi.spyOn(storage, "saveDocuments");
    const [first, second] = await Promise.all([importCaptured(storage), importCaptured(storage)]);
    expect(first).toBe(second);
    expect(first.kind).toBe("done");
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("HO-5: import never overwrites", () => {
  it("saves new menus, skips identical ones, and copies one whose title is taken, then replies ok", async () => {
    const storage = createLocalStorage();
    const [mine] = await storage.saveDocuments({ title: "Us", encoded: tea }, { title: "Same", encoded: walks });
    const before = (await storage.getDocuments())[mine!];

    const outcome = await importHandoff(
      storage,
      request([
        { title: "Us", encoded: walks },
        { title: "Same", encoded: walks },
        { title: "New", encoded: tea },
      ]),
      OLD
    );
    expect(outcome).toMatchObject({ kind: "done", added: 2 });
    expect(replyOf((outcome as { reply: string }).reply)).toEqual({ id: ID, ok: true });

    const after = Object.values(await storage.getDocuments());
    expect(after.map((d) => d.title).sort()).toEqual(["New", "Same", "Us", "Us (2)"]);
    expect((await storage.getDocuments())[mine!]).toEqual(before);
    expect(after.find((d) => d.title === "Us (2)")?.encoded).toBe(walks);
  });

  it("a repeated hand-off adds nothing", async () => {
    const storage = createLocalStorage();
    await storage.saveDocuments({ title: "Us", encoded: tea });
    const fragment = request([{ title: "Us", encoded: walks }, { title: "Other", encoded: tea }]);
    await importHandoff(storage, fragment, OLD);
    const once = await storage.getDocuments();
    expect(await importHandoff(storage, fragment, OLD)).toMatchObject({ kind: "done", added: 0 });
    expect(await storage.getDocuments()).toEqual(once);
  });

  it.each([
    ["no fragment", null],
    ["an empty fragment", ""],
    ["a menu link's fragment", "top"],
    ["junk", "handoff=1&id=%00&menus=]]"],
  ])("does nothing with %s", async (_, fragment) => {
    const storage = createLocalStorage();
    expect(await importHandoff(storage, fragment, OLD)).toEqual({ kind: "nothing" });
    expect(await storage.getDocuments()).toEqual({});
  });

  it("saves no junk: unreadable menus are left out", async () => {
    const storage = createLocalStorage();
    const outcome = await importHandoff(
      storage,
      request([
        { title: "Good", encoded: walks },
        { title: "Not a menu", encoded: "AAAA" },
        { title: "Not compressed", encoded: btoa("hello") },
        { title: "Not a list", encoded: encodeData({ G: "x" }) },
      ]),
      OLD
    );
    expect(outcome).toMatchObject({ kind: "done", added: 1 });
    expect(Object.values(await storage.getDocuments()).map((d) => d.title)).toEqual(["Good"]);
  });

  it("replies 'not saved' when the menus arrived cut short, and saves nothing", async () => {
    const storage = createLocalStorage();
    const outcome = await importHandoff(storage, request([{ title: "Us", encoded: walks }]).slice(0, -5), OLD);
    expect(outcome.kind).toBe("failed");
    expect(replyOf((outcome as { reply: string }).reply)).toEqual({ id: ID, ok: false });
    expect(await storage.getDocuments()).toEqual({});
  });

  it("replies 'not saved' when saving fails", async () => {
    const failing: Storage = {
      getDocuments: async () => ({}),
      saveDocuments: async () => [],
      saveMenu: async () => {
        throw new Error("full");
      },
      deleteDocument: async () => {},
      subscribe: () => () => {},
    };
    const outcome = await importHandoff(failing, request([{ title: "Us", encoded: walks }]), OLD);
    expect(outcome.kind).toBe("failed");
    expect(replyOf((outcome as { reply: string }).reply)).toEqual({ id: ID, ok: false });

    const throwing: Storage = { ...failing, getDocuments: async () => Promise.reject(new Error("blocked")) };
    expect((await importHandoff(throwing, request([]), OLD)).kind).toBe("failed");
  });

  it("keeps the menus' dates and person", async () => {
    const storage = createLocalStorage();
    const menu: RelationshipMenuDocument = { title: "Us", encoded: walks, person: { name: "Sam" }, createdAt: 1, updatedAt: 2 };
    await importHandoff(storage, encodeHandoffRequest({ id: ID, menus: [menu as never] }), OLD);
    const [saved] = Object.values(await storage.getDocuments());
    expect(saved).toMatchObject(menu);
  });
});
