import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { App } from "../App";
import { toBase64Url } from "../sync/bytes";
import { SyncError, SyncErrorReason, SyncState } from "../sync/context";
import { FakeSync, FakeSyncProvider, fakeAccount, fakeSync } from "../sync/fake-sync";
import { PairPage } from "./Pair";
import { ERROR_TEXT } from "./sync-copy";
import { SyncSettingsPage } from "./SyncSettings";

/** A pairing key as a link carries it: 32 bytes, base64url. */
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const KEY = toBase64Url(KEY_BYTES);

const onState: SyncState = { kind: "on", account: fakeAccount(), pending: 0, lastSyncedAt: null, notices: [], unreadable: 0 };

/** Opens `/pair<hash>` as a camera would: the real address bar, and the router at the same place. */
const openPairLink = (sync: FakeSync, hash = `#${KEY}`, { strict = false } = {}) => {
  window.history.replaceState(null, "", `/pair${hash}`);
  const user = userEvent.setup();
  const tree = (
    <MemoryRouter initialEntries={[`/pair${hash}`]}>
      <FakeSyncProvider value={sync}>
        <Routes>
          <Route path="/pair" element={<PairPage />} />
          <Route path="/sync" element={<SyncSettingsPage />} />
        </Routes>
      </FakeSyncProvider>
    </MemoryRouter>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { user, ...view };
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SY-11: the key leaves the address bar before anything else runs", () => {
  test("the fragment is gone by the first effect, and joinPairing gets the key", async () => {
    let hashAtFirstJoin: string | null = null;
    const sync = fakeSync({
      joinPairing: async () => {
        hashAtFirstJoin ??= window.location.hash;
      },
    });
    openPairLink(sync);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/pair");
    await screen.findByRole("heading", { name: "This device is syncing" });
    expect(sync.joinPairing).toHaveBeenCalledTimes(1);
    expect(Array.from(sync.joinPairing.mock.calls[0]![0])).toEqual(Array.from(KEY_BYTES));
    expect(hashAtFirstJoin).toBe("");
  });

  test("page_view never carries the key, and the fragment is gone before it's sent", async () => {
    const seen: { args: unknown[]; href: string }[] = [];
    (window as unknown as { gtag: (...args: unknown[]) => void }).gtag = (...args) =>
      seen.push({ args, href: window.location.href });
    try {
      window.history.replaceState(null, "", `/pair#${KEY}`);
      render(
        <MemoryRouter initialEntries={[`/pair#${KEY}`]}>
          <FakeSyncProvider value={fakeSync()}>
            <App />
          </FakeSyncProvider>
        </MemoryRouter>
      );
      await screen.findByRole("heading", { name: "This device is syncing" });
      const pageViews = seen.filter(({ args }) => args[0] === "event" && args[1] === "page_view");
      expect(pageViews).toHaveLength(1);
      expect(pageViews[0]!.args[2]).toMatchObject({ page_path: "/pair" });
      for (const { args, href } of seen) {
        expect(JSON.stringify(args)).not.toContain(KEY);
        expect(href).not.toContain("#");
      }
    } finally {
      delete (window as unknown as { gtag?: unknown }).gtag;
    }
  });

  test("in StrictMode too, the key is read once and joined once", async () => {
    const sync = fakeSync();
    openPairLink(sync, `#${KEY}`, { strict: true });
    expect(window.location.hash).toBe("");
    await screen.findByRole("heading", { name: "This device is syncing" });
    expect(sync.joinPairing).toHaveBeenCalledTimes(1);
    expect(Array.from(sync.joinPairing.mock.calls[0]![0])).toEqual(Array.from(KEY_BYTES));
  });

  test("a fragment that isn't a key is removed too, and nothing is fetched", async () => {
    const sync = fakeSync();
    openPairLink(sync, "#not-a-key");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("heading", { name: "Couldn't add this device" })).toBeInTheDocument();
    expect(screen.getByText(ERROR_TEXT.pairing_unreadable)).toBeInTheDocument();
    expect(sync.joinPairing).not.toHaveBeenCalled();
  });
});

describe("SY-10: opening a pairing link turns on sync", () => {
  test("joins, then says so and points to the Library", async () => {
    const sync = fakeSync({ state: { kind: "off" } });
    openPairLink(sync);
    const heading = await screen.findByRole("heading", { name: "This device is syncing" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Sync is on.");
    expect(screen.getByRole("link", { name: "Go to your menus" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "Sync settings" })).toHaveAttribute("href", "/sync");
  });

  test("waits while sync is still loading", async () => {
    const sync = fakeSync({ state: { kind: "loading" } });
    const { rerender } = openPairLink(sync);
    expect(screen.getByRole("status")).toHaveTextContent("Turning on sync…");
    expect(sync.joinPairing).not.toHaveBeenCalled();
    const loaded = { ...sync, state: { kind: "off" } as SyncState };
    rerender(
      <MemoryRouter initialEntries={["/pair"]}>
        <FakeSyncProvider value={loaded}>
          <Routes>
            <Route path="/pair" element={<PairPage />} />
          </Routes>
        </FakeSyncProvider>
      </MemoryRouter>
    );
    await screen.findByRole("heading", { name: "This device is syncing" });
    expect(sync.joinPairing).toHaveBeenCalledTimes(1);
  });

  test("without a link, explains how to add a device", () => {
    const sync = fakeSync();
    openPairLink(sync, "");
    expect(screen.getByText(/choose Add a device, and scan the QR code/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Type the 24 words instead" })).toHaveAttribute("href", "/sync");
    expect(sync.joinPairing).not.toHaveBeenCalled();
  });
});

describe("SY-14: a pairing link in a browser that can't sync", () => {
  test("says so and fetches nothing", async () => {
    const sync = fakeSync({ state: { kind: "unsupported" } });
    openPairLink(sync);
    expect(await screen.findByRole("heading", { name: "This browser can't sync" })).toBeInTheDocument();
    expect(screen.getByText(/Everything else works here as usual/)).toBeInTheDocument();
    expect(sync.joinPairing).not.toHaveBeenCalled();
  });
});

describe("SY-12: a link that no longer works", () => {
  const fails = (reason: SyncErrorReason) => fakeSync({ joinPairing: () => Promise.reject(new SyncError(reason)) });

  test("already used: says so, adds the replace-your-code advice, and offers the words", async () => {
    openPairLink(fails("pairing_used"));
    expect(await screen.findByRole("heading", { name: "Couldn't add this device" })).toHaveFocus();
    expect(screen.getByText("This link has already been used.")).toBeInTheDocument();
    expect(screen.getByText("If that wasn't you, replace your sync code.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Type the 24 words instead" })).toHaveAttribute("href", "/sync");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  test.each(["pairing_expired", "pairing_not_found", "pairing_unreadable", "failed"] as const)(
    "%s: says so and offers to type the words instead",
    async (reason) => {
      openPairLink(fails(reason));
      expect(await screen.findByText(ERROR_TEXT[reason])).toBeInTheDocument();
      expect(screen.queryByText("If that wasn't you, replace your sync code.")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Type the 24 words instead" })).toBeInTheDocument();
    }
  );

  test("typing the words instead opens word entry in sync settings", async () => {
    const { user } = openPairLink(fails("pairing_expired"));
    await user.click(await screen.findByRole("link", { name: "Type the 24 words instead" }));
    expect(screen.getByRole("textbox", { name: "Your sync code" })).toHaveFocus();
  });

  test.each(["offline", "rate_limited"] as const)("%s: the link may still work, so it offers to try again", async (reason) => {
    let calls = 0;
    const sync = fakeSync({
      joinPairing: async () => {
        if (++calls === 1) throw new SyncError(reason);
      },
    });
    const { user } = openPairLink(sync);
    expect(await screen.findByText(ERROR_TEXT[reason])).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "This device is syncing" });
    expect(sync.joinPairing).toHaveBeenCalledTimes(2);
    expect(Array.from(sync.joinPairing.mock.calls[1]![0])).toEqual(Array.from(KEY_BYTES));
  });
});

describe("SY-8: a pairing link while a new code waits to be confirmed", () => {
  test("says the new code is still being confirmed, and offers to try again", async () => {
    const sync = fakeSync({
      state: onState,
      joinPairing: () => Promise.reject(new SyncError("code_unconfirmed")),
    });
    const { user } = openPairLink(sync);
    await user.click(await screen.findByRole("button", { name: "Switch to the other device's code" }));
    expect(await screen.findByText("Your new sync code is still being confirmed. Try again once you're online.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("SY-29: a pairing link on a device that already syncs", () => {
  test("asks before switching codes, and fetches nothing until then", async () => {
    const sync = fakeSync({ state: onState });
    const { user } = openPairLink(sync);
    const confirm = await screen.findByRole("region", { name: "Sync is already on here" });
    expect(confirm).toHaveTextContent("switches it to the code of the device that showed the QR code");
    expect(confirm).toHaveTextContent("Menus already on this device are kept");
    expect(confirm).toHaveTextContent("the link still works on another device");
    expect(sync.joinPairing).not.toHaveBeenCalled();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Switch to the other device's code" }));
    });
    expect(sync.joinPairing).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "This device is syncing" })).toBeInTheDocument();
  });

  test("keeping the current code goes to sync settings without fetching", async () => {
    const sync = fakeSync({ state: onState });
    const { user } = openPairLink(sync);
    await user.click(await screen.findByRole("link", { name: "Keep my current code" }));
    expect(screen.getByRole("heading", { level: 1, name: "Sync" })).toBeInTheDocument();
    expect(sync.joinPairing).not.toHaveBeenCalled();
  });
});
