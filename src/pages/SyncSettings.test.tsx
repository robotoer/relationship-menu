import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SyncError, SyncErrorReason, SyncState } from "../sync/context";
import { FakeSync, FakeSyncProvider, fakeAccount, fakeSync } from "../sync/fake-sync";
import { SyncCodeError, WRONG_WORD_MESSAGE } from "../sync/sync-code";
import { leavePage } from "./leave-page";
import { ERROR_TEXT, formatDate } from "./sync-copy";
import { SyncSettingsPage } from "./SyncSettings";
import { SyncSettingsRoute } from "./SyncSettingsRoute";
import settingsSource from "./SyncSettings.tsx?raw";

vi.mock("./leave-page", () => ({ leavePage: vi.fn() }));

/** docs/spec/sync.md, SY-4, copied by hand so a change to either side fails this test. */
const SY4 =
  "These 24 words are the only key to your synced menus. We can't see them and can't recover them. If you lose every device and these words, your synced menus are gone. Keep them in a password manager or on paper.";

const WORDS = [...Array(23).fill("abandon"), "art"];

const on = (overrides: Partial<Extract<SyncState, { kind: "on" }>> = {}): SyncState => ({
  kind: "on",
  account: fakeAccount(),
  pending: 0,
  lastSyncedAt: Date.UTC(2026, 10, 25, 12, 0),
  notices: [],
  unreadable: 0,
  ...overrides,
});

const renderSettings = (sync: FakeSync, routerState?: unknown) => {
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: "/sync", state: routerState }]}>
      <FakeSyncProvider value={sync}>
        <SyncSettingsPage />
      </FakeSyncProvider>
    </MemoryRouter>
  );
  return { user, ...view };
};

const gtag = vi.fn();
beforeEach(() => {
  gtag.mockReset();
  vi.mocked(leavePage).mockReset();
  (window as unknown as { gtag: typeof gtag }).gtag = gtag;
});
afterAll(() => {
  delete (window as unknown as { gtag?: typeof gtag }).gtag;
});

describe("sync settings at /sync", () => {
  test("loads on its own, outside the main bundle", async () => {
    render(
      <MemoryRouter initialEntries={["/sync"]}>
        <FakeSyncProvider value={fakeSync({ state: { kind: "off" } })}>
          <SyncSettingsRoute />
        </FakeSyncProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Turn on sync" })).toBeInTheDocument();
  });
});

describe("sync settings while loading", () => {
  test("is quiet: no controls until sync knows its state", () => {
    renderSettings(fakeSync({ state: { kind: "loading" } }));
    expect(screen.getByRole("heading", { level: 1, name: "Sync" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });
});

describe("SY-14: a browser that can't sync", () => {
  test("says so, says everything else still works, and names the browsers that can", () => {
    renderSettings(fakeSync({ state: { kind: "unsupported" } }));
    expect(screen.getByRole("heading", { name: "Sync isn't available in this browser" })).toBeInTheDocument();
    expect(screen.getByText(/This browser can't sync/)).toHaveTextContent(
      "Chrome or Edge 137 or later, Safari 17 or later, or Firefox 129 or later"
    );
    expect(screen.getByText(/Everything else works here as usual/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on sync" })).not.toBeInTheDocument();
  });
});

describe("SY-1, SY-4: turning sync on shows the new code at once, after the warning", () => {
  test("turns on, then shows SY-4's warning word for word and the 24 words", async () => {
    const sync = fakeSync({ state: { kind: "off" } });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn on sync" }));
    expect(sync.turnOn).toHaveBeenCalledTimes(1);
    const heading = await screen.findByRole("heading", { name: "Sync is on. Here's your sync code" });
    expect(heading).toHaveFocus();
    const warning = screen.getByText(SY4);
    const list = screen.getByRole("list", { name: "Sync code" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(24);
    expect(list).toHaveTextContent("24. art");
    // The warning comes first.
    expect(warning.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "I've saved my sync code" }));
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sync is on.");
  });

  test("if turning on fails, says why and shows no code", async () => {
    const sync = fakeSync({ state: { kind: "off" }, turnOn: () => Promise.reject(new SyncError("offline")) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn on sync" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT.offline);
    expect(sync.syncCode).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
  });
});

describe("SY-13: turning on keeps the menus already here", () => {
  test("says menus on this device are kept and uploaded", () => {
    renderSettings(fakeSync({ state: { kind: "off" } }));
    expect(screen.getByText("Menus already on this device are kept, and uploaded along with the rest.")).toBeInTheDocument();
  });
});

describe("SY-5: typing the sync code", () => {
  test("“I already have a sync code” opens word entry, focused", async () => {
    const { user } = renderSettings(fakeSync({ state: { kind: "off" } }));
    await user.click(screen.getByRole("button", { name: "I already have a sync code" }));
    expect(screen.getByRole("textbox", { name: "Your sync code" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Your sync code" })).toHaveAttribute("spellcheck", "false");
  });

  test("autocompletes the word being typed", async () => {
    const { user } = renderSettings(fakeSync({ state: { kind: "off" } }));
    await user.click(screen.getByRole("button", { name: "I already have a sync code" }));
    const field = screen.getByRole("textbox", { name: "Your sync code" });
    await user.type(field, "Aban");
    await user.click(await screen.findByRole("button", { name: "abandon" }));
    expect(field).toHaveValue("Aban".replace("Aban", "abandon "));
    expect(field).toHaveFocus();
    await user.type(field, "ab");
    const group = await screen.findByRole("group", { name: "Words starting with ab" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toContain("about");
    expect(screen.getByText("2 of 24 words")).toBeInTheDocument();
  });

  test("submits what was typed; numbers copied from the list are dropped", async () => {
    const sync = fakeSync({ state: { kind: "off" } });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "I already have a sync code" }));
    const field = screen.getByRole("textbox", { name: "Your sync code" });
    await user.click(field);
    await user.paste(WORDS.map((w, i) => `${i + 1}. ${w.toUpperCase()}`).join("\n"));
    expect(screen.getByText("24 of 24 words")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn on sync" }));
    expect(sync.restore).toHaveBeenCalledTimes(1);
    const typed = sync.restore.mock.calls[0]![0];
    expect(typed.trim().split(/\s+/)).toEqual(WORDS.map((w) => w.toUpperCase()));
    expect(await screen.findByRole("status")).toHaveTextContent("Sync is on.");
  });

  test("a bad code says one of the words is wrong, without saying which, and keeps what was typed", async () => {
    const sync = fakeSync({
      state: { kind: "off" },
      restore: () => Promise.reject(new SyncCodeError("checksum", WRONG_WORD_MESSAGE)),
    });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "I already have a sync code" }));
    const field = screen.getByRole("textbox", { name: "Your sync code" });
    await user.click(field);
    await user.paste(`${"zoo ".repeat(23)}wrong`);
    await user.click(screen.getByRole("button", { name: "Turn on sync" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(WRONG_WORD_MESSAGE);
    expect(alert).not.toHaveTextContent(/zoo|wrong /);
    expect(field).toHaveValue(`${"zoo ".repeat(23)}wrong`);
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  test("a pairing link that didn't work opens word entry directly", () => {
    renderSettings(fakeSync({ state: { kind: "off" } }), { enterCode: true });
    expect(screen.getByRole("textbox", { name: "Your sync code" })).toHaveFocus();
  });

  test("Cancel closes word entry and returns focus", async () => {
    const { user } = renderSettings(fakeSync({ state: { kind: "off" } }));
    await user.click(screen.getByRole("button", { name: "I already have a sync code" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I already have a sync code" })).toHaveFocus();
  });
});

describe("sync settings: supporter status", () => {
  test("with no supporter status, sync is on but nothing uploads until you support", () => {
    renderSettings(fakeSync({ state: on({ account: fakeAccount({ status: "none", plan: null, renewsAt: null, readOnly: true }), notices: ["not_supporter"] }) }));
    expect(screen.getByText(/Sync is on, but nothing uploads until you support the project\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Support the project" })).toHaveAttribute("href", "/support");
    // Said once, not again as a notice.
    expect(screen.getAllByText(/nothing uploads until you support/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Manage subscription" })).not.toBeInTheDocument();
  });

  test("an active plan shows the amount and when it renews or ends", () => {
    const renewsAt = Date.UTC(2027, 10, 25);
    const { unmount } = renderSettings(fakeSync({ state: on({ account: fakeAccount({ plan: "supporter_12_yearly", renewsAt }) }) }));
    expect(screen.getByText(/You're a supporter/)).toHaveTextContent(`Your plan: $12 a year, renews on ${formatDate(renewsAt)}.`);
    unmount();
    renderSettings(
      fakeSync({ state: on({ account: fakeAccount({ plan: "supporter_12_yearly", renewsAt, cancelAtPeriodEnd: true }) }) })
    );
    expect(screen.getByText(/You're a supporter/)).toHaveTextContent(`Your plan: $12 a year, ends on ${formatDate(renewsAt)}.`);
  });

  test("SY-65: a failed payment keeps sync working while Stripe retries", () => {
    renderSettings(fakeSync({ state: on({ account: fakeAccount({ status: "past_due" }) }) }));
    expect(screen.getByText(/Your last payment didn't go through/)).toHaveTextContent("sync keeps working meanwhile");
  });

  test("a lifetime supporter", () => {
    renderSettings(fakeSync({ state: on({ account: fakeAccount({ status: "lifetime", plan: "supporter_30_lifetime", renewsAt: null }) }) }));
    expect(screen.getByText("You're a lifetime supporter. Thank you!")).toBeInTheDocument();
  });

  test("before the server first answers, says it's checking", () => {
    renderSettings(fakeSync({ state: on({ account: null }) }));
    expect(screen.getByText("Sync is on. Checking your supporter status…")).toBeInTheDocument();
  });
});

describe("SY-66: lapsed means read-only", () => {
  test("explains read-only, that local menus aren't affected, and gives the purge date", () => {
    const purgeAt = Date.UTC(2027, 9, 1);
    renderSettings(
      fakeSync({
        state: on({
          account: fakeAccount({ status: "lapsed", readOnly: true, lapsedAt: Date.UTC(2026, 9, 1), purgeAt }),
          notices: ["read_only"],
        }),
      })
    );
    expect(screen.getByText(/sync is read-only/)).toHaveTextContent(
      "This device can still download your synced menus, but changes made here aren't uploaded. Menus on this device aren't affected."
    );
    expect(screen.getByText(new RegExp(`deleted from the server on ${formatDate(purgeAt)}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Support again" })).toHaveAttribute("href", "/support");
    expect(screen.getAllByText(/changes made here aren't uploaded/)).toHaveLength(1);
  });
});

describe("SY-67: the purge warning", () => {
  test("within 30 days of the purge, warns with the date", () => {
    const purgeAt = Date.UTC(2026, 11, 10);
    renderSettings(
      fakeSync({ state: on({ account: fakeAccount({ status: "lapsed", readOnly: true, purgeAt, purgeSoon: true }) }) })
    );
    const warning = screen.getByText(/Support again before then to keep them/);
    expect(warning).toHaveClass("sync-warning");
    expect(warning).toHaveTextContent(`Your synced menus will be deleted from the server on ${formatDate(purgeAt)}.`);
    expect(warning).toHaveTextContent("Menus on this device won't be affected.");
  });
});

describe("sync settings: progress", () => {
  test("shows what's waiting to upload and when it last synced, and Sync now syncs", async () => {
    const sync = fakeSync({ state: on({ pending: 2, lastSyncedAt: null }) });
    const { user } = renderSettings(sync);
    expect(screen.getByText(/2 menus are waiting to upload\. Not synced yet\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(sync.syncNow).toHaveBeenCalled();
  });

  test("all uploaded, with the last sync time", () => {
    renderSettings(fakeSync({ state: on({ pending: 0 }) }));
    expect(screen.getByText(/Everything on this device is uploaded\. Last synced /)).toBeInTheDocument();
  });
});

describe("SY-17, SY-23, SY-8: notices", () => {
  test("each notice gets its line, with the rules' sentences word for word", () => {
    renderSettings(
      fakeSync({
        state: on({ notices: ["offline", "storage_full", "menu_too_large", "unreadable", "code_replaced", "read_only"], unreadable: 2 }),
      })
    );
    const items = within(screen.getByRole("list", { name: "" })).getAllByRole("listitem");
    const text = items.map((li) => li.textContent);
    expect(text).toContain("Sync storage is full. Your menus are still saved on this device.");
    expect(text).toContain(
      "Your sync code was replaced, or your synced data was deleted, on another device or after your plan ended. Enter the new code to keep syncing, or turn off sync on this device."
    );
    expect(text.find((t) => t?.startsWith("Some synced data couldn't be read."))).toBe(
      "Some synced data couldn't be read. 2 records were skipped, and nothing on this device was changed."
    );
    expect(text.some((t) => t?.includes("Changes are saved on this device and will upload"))).toBe(true);
    expect(text.some((t) => t?.includes("too big to sync"))).toBe(true);
    expect(text.some((t) => t?.includes("changes made here aren't uploaded"))).toBe(true);
  });

  test("SY-8: after the code was replaced elsewhere, “Enter the new code” takes the new words", async () => {
    const sync = fakeSync({ state: on({ notices: ["code_replaced"] }) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Enter the new code" }));
    const field = screen.getByRole("textbox", { name: "Your new sync code" });
    await user.click(field);
    await user.paste(WORDS.join(" "));
    await user.click(screen.getByRole("button", { name: "Use this code" }));
    expect(sync.restore).toHaveBeenCalledWith(WORDS.join(" "));
    expect(await screen.findByText("Sync is on with the new code.")).toBeInTheDocument();
  });
});

describe("SY-3: Show my sync code", () => {
  test("is hidden until asked for, shows the SY-4 warning with it, and hides again", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
    expect(sync.syncCode).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Show my sync code" }));
    expect(await screen.findByRole("list", { name: "Sync code" })).toHaveTextContent("1. abandon");
    expect(screen.getByText(SY4)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Hide my sync code" }));
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Show my sync code" })).toHaveFocus());
  });

  test("is hidden again on leaving the page", async () => {
    const sync = fakeSync({ state: on() });
    const { user, unmount } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Show my sync code" }));
    await screen.findByRole("list", { name: "Sync code" });
    // Leaving for another site (the page may be kept in the back-forward cache).
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
    // Leaving for another page of the app, and coming back.
    unmount();
    renderSettings(sync);
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
  });
});

describe("SY-10: Add a device", () => {
  test("shows a QR code of the link, the 24 words and how long it works, never the link itself", async () => {
    const sync = fakeSync({
      state: on(),
      offerPairing: async () => ({ link: "http://localhost/pair#SECRETKEYsecretkey", expiresAt: Date.now() + 10 * 60_000 }),
    });
    const { user, container } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Add a device" }));
    expect(sync.offerPairing).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("img", { name: "QR code that adds a device to your sync" })).toBeInTheDocument();
    expect(screen.getByText(/Works for another/)).toHaveTextContent(/(10:00|9:5\d)/);
    expect(screen.getByRole("list", { name: "Sync code" })).toHaveTextContent("24. art");
    expect(screen.getByText(SY4)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/SECRETKEY|secretkey|localhost\/pair/);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("when the code expires, it's taken away and says so", async () => {
    const sync = fakeSync({
      state: on(),
      offerPairing: async () => ({ link: "http://localhost/pair#key", expiresAt: Date.now() + 1200 }),
    });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Add a device" }));
    await screen.findByRole("img", { name: "QR code that adds a device to your sync" });
    expect(await screen.findByText(/That QR code has expired/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Sync code" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make a new QR code" })).toBeInTheDocument();
  });

  test("without supporter status, explains why and what to do instead", async () => {
    const sync = fakeSync({ state: on(), offerPairing: () => Promise.reject(new SyncError("not_supporter")) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Add a device" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Adding a device with a QR code needs supporter status");
    expect(alert).toHaveTextContent("typing your 24 words");
    expect(within(alert).getByRole("link", { name: "support the project" })).toHaveAttribute("href", "/support");
  });

  test("the QR encoder loads with import(), only for Add a device", () => {
    expect(settingsSource).toContain('lazy(() => import("../components/QrCode"))');
    expect(settingsSource).not.toMatch(/^import[^\n]*(QrCode|qr-encoder)/m);
  });
});

describe("SY-64: Manage subscription", () => {
  test("opens Stripe's Customer Portal", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Manage subscription" }));
    expect(sync.manageSubscription).toHaveBeenCalled();
    expect(leavePage).toHaveBeenCalledWith("https://billing.stripe.test/session");
  });

  test("says so when there's nothing to manage", async () => {
    const sync = fakeSync({
      state: on({ account: fakeAccount({ status: "lapsed" }) }),
      manageSubscription: () => Promise.reject(new SyncError("not_supporter")),
    });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Manage subscription" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There's no subscription to manage yet.");
    expect(leavePage).not.toHaveBeenCalled();
  });
});

describe("SY-9: Turn off sync on this device", () => {
  test("asks first, says what stays, and Cancel changes nothing", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn off on this device" }));
    const confirm = screen.getByRole("group", { name: "Turn off sync on this device?" });
    expect(within(confirm).getByRole("heading")).toHaveFocus();
    expect(confirm).toHaveTextContent("Your menus stay on this device, and your synced menus stay on the server");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(sync.turnOff).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Turn off on this device" })).toHaveFocus();
  });

  test("Escape cancels too", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn off on this device" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Turn off sync on this device?" })).not.toBeInTheDocument();
    expect(sync.turnOff).not.toHaveBeenCalled();
  });

  test("turns off when confirmed", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn off on this device" }));
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(sync.turnOff).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Sync is off on this device\. Your menus are still here/)).toBeInTheDocument();
  });
});

describe("SY-8: Replace sync code", () => {
  test("asks first, then shows the new code with the SY-4 warning", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Replace sync code" }));
    const confirm = screen.getByRole("group", { name: "Replace your sync code?" });
    expect(confirm).toHaveTextContent("The old code stops working.");
    expect(confirm).toHaveTextContent("Your other devices stop syncing until you enter the new code");
    await user.click(within(confirm).getByRole("button", { name: "Replace sync code" }));
    expect(sync.replaceCode).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Your new sync code" })).toHaveFocus();
    expect(screen.getByText(SY4)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Sync code" })).toBeInTheDocument();
  });
});

describe("SY-8: a new code the server hasn't confirmed yet", () => {
  test("if the answer is lost, says sync is paused while it keeps checking, and not to turn it off", async () => {
    const sync = fakeSync({ state: on(), replaceCode: () => Promise.reject(new SyncError("code_unconfirmed")) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Replace sync code" }));
    await user.click(within(screen.getByRole("group")).getByRole("button", { name: "Replace sync code" }));
    const outcome = await screen.findByText(/Couldn't confirm the new sync code yet/);
    expect(outcome).toHaveTextContent("don't turn off sync on this device meanwhile");
    await waitFor(() => expect(outcome).toHaveFocus());
    expect(sync.syncCode).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Your new sync code" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SY-8: while a new code waits to be confirmed", () => {
  const unconfirmed = () => Promise.reject(new SyncError("code_unconfirmed"));

  test("turning off and deleting say the new code is still being confirmed", async () => {
    const sync = fakeSync({
      state: on({ notices: ["offline"] }),
      turnOff: unconfirmed,
      deleteSyncedMenus: unconfirmed,
      deleteSyncedData: unconfirmed,
    });
    const { user } = renderSettings(sync);
    for (const [label, confirm] of [
      ["Turn off on this device", "Turn off"],
      ["Delete synced menus", "Delete synced menus"],
      ["Delete my account", "Delete my account"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: label }));
      await user.click(within(screen.getByRole("group")).getByRole("button", { name: confirm }));
      expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT.code_unconfirmed);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    }
  });

  test("so does typing a code", async () => {
    const sync = fakeSync({ state: on({ notices: ["code_replaced"] }), restore: unconfirmed });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Enter the new code" }));
    await user.click(screen.getByRole("textbox"));
    await user.paste(WORDS.join(" "));
    await user.click(screen.getByRole("button", { name: "Use this code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT.code_unconfirmed);
  });

  test("replacing again while one is unconfirmed says sync is paused, not to turn it off", async () => {
    const sync = fakeSync({ state: on({ notices: ["offline"] }), replaceCode: unconfirmed });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Replace sync code" }));
    await user.click(within(screen.getByRole("group")).getByRole("button", { name: "Replace sync code" }));
    expect(await screen.findByText(/Couldn't confirm the new sync code yet/)).toBeInTheDocument();
    expect(sync.syncCode).not.toHaveBeenCalled();
  });

  test("an ordinary offline failure still says so", async () => {
    const sync = fakeSync({ state: on(), turnOff: () => Promise.reject(new SyncError("offline")) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn off on this device" }));
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT.offline);
  });

});

describe("SY-68: delete synced menus or the whole account", () => {
  test("menu deletion keeps supporter status and billing, then turns sync off here", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Delete synced menus" }));
    const confirm = screen.getByRole("group", { name: "Delete your synced menus?" });
    expect(confirm).toHaveTextContent("This can't be undone.");
    expect(confirm).toHaveTextContent("Your supporter status and any subscription stay active.");
    expect(confirm).toHaveTextContent("Turning sync on again can upload the menus kept on a device.");
    await user.click(within(confirm).getByRole("button", { name: "Delete synced menus" }));
    expect(sync.deleteSyncedMenus).toHaveBeenCalledTimes(1);
    expect(sync.deleteSyncedData).not.toHaveBeenCalled();
    expect(await screen.findByText(/Your supporter status is unchanged/)).toBeInTheDocument();
  });

  test("account deletion says it can't be undone, local menus stay and the subscription is cancelled, then deletes", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    const confirm = screen.getByRole("group", { name: "Delete your account and supporter status?" });
    expect(confirm).toHaveTextContent("This can't be undone.");
    expect(confirm).toHaveTextContent("Menus on this device stay.");
    expect(confirm).toHaveTextContent("Any subscription is cancelled, so you won't be charged again.");
    expect(confirm).not.toHaveTextContent("lifetime");
    await user.click(within(confirm).getByRole("button", { name: "Delete my account" }));
    expect(sync.deleteSyncedData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Your account and synced data are deleted/)).toBeInTheDocument();
  });

  test("warns a lifetime supporter that the status ends for good", async () => {
    const sync = fakeSync({ state: on({ account: fakeAccount({ status: "lifetime", plan: "supporter_30_lifetime" }) }) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(screen.getByRole("group", { name: "Delete your account and supporter status?" })).toHaveTextContent(
      "Your lifetime supporter status ends too, for good."
    );
  });

  test("a failure says why and leaves the confirmation open", async () => {
    const sync = fakeSync({ state: on(), deleteSyncedData: () => Promise.reject(new SyncError("offline")) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    await user.click(within(screen.getByRole("group")).getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT.offline);
    expect(screen.getByRole("group", { name: "Delete your account and supporter status?" })).toBeInTheDocument();
  });
});

describe("sync settings: every failure in plain words", () => {
  const reasons = Object.keys(ERROR_TEXT) as SyncErrorReason[];

  test.each(reasons)("%s", async (reason) => {
    const sync = fakeSync({
      state: { kind: "off" },
      turnOn: () => Promise.reject(new SyncError(reason, "internal detail abandon art")),
    });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn on sync" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_TEXT[reason]);
    expect(alert).not.toHaveTextContent("internal detail");
  });

  test("an unexpected error never shows its own message", async () => {
    const sync = fakeSync({ state: { kind: "off" }, turnOn: () => Promise.reject(new Error("abandon abandon art")) });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Turn on sync" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_TEXT.failed);
    expect(alert).not.toHaveTextContent("abandon");
  });
});

describe("SY-75: the sync screens send no analytics of their own", () => {
  test("showing the code, adding a device and turning on record nothing", async () => {
    const sync = fakeSync({ state: on() });
    const { user } = renderSettings(sync);
    await user.click(screen.getByRole("button", { name: "Show my sync code" }));
    await screen.findByRole("list", { name: "Sync code" });
    await user.click(screen.getByRole("button", { name: "Add a device" }));
    await screen.findByRole("img");
    expect(gtag).not.toHaveBeenCalled();
  });
});
