import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CHECKOUT_PLAN_KEY, CONFIRM_BACKOFF_MS, SupportPage, SUPPORT_OPTIONS } from "./Support";
import { CheckoutPlan, SyncAccount, SyncError, SyncErrorReason, SyncState } from "../sync/context";
import { FakeSync, FakeSyncProvider, fakeAccount, fakeSync } from "../sync/fake-sync";

/** The current address, so tests can see the query go. */
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
};

const NOT_YET = fakeAccount({ status: "none", plan: null, renewsAt: null, readOnly: true });

const on = (account: SyncAccount | null = NOT_YET): SyncState => ({
  kind: "on",
  account,
  pending: 0,
  lastSyncedAt: null,
  notices: [],
  unreadable: 0,
});

const page = (sync: FakeSync, path: string, state: unknown, openStripe: (url: string) => void) => {
  const [pathname, search] = path.split("?");
  return (
    <FakeSyncProvider value={sync}>
      <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "", state }]}>
        <SupportPage openStripe={openStripe} />
        <LocationProbe />
      </MemoryRouter>
    </FakeSyncProvider>
  );
};

const renderPage = ({ sync = fakeSync(), path = "/support", state }: { sync?: FakeSync; path?: string; state?: unknown } = {}) => {
  const openStripe = vi.fn();
  const view = render(page(sync, path, state, openStripe));
  return { ...view, sync, openStripe };
};

/** A first visit: sync off, arriving with this router state. */
const renderAt = (state?: unknown) => renderPage({ state });

const amountButton = (label: RegExp) => screen.getByRole("button", { name: label });
const optionButtons = () => SUPPORT_OPTIONS.map((o) => screen.getByRole("button", { name: new RegExp(o.label.replace(/[$/]/g, "\\$&")) }));

/** Lets pending promises (the fake actions) settle, and fake timers run `ms` on. */
const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("SupportPage", () => {
  const gtag = vi.fn();
  /** Analytics events sent, as [name, params]. */
  const events = () => gtag.mock.calls.filter((c) => c[0] === "event").map((c) => [c[1], c[2]]);
  const sent = (name: string) => events().filter(([n]) => n === name);

  beforeEach(() => {
    gtag.mockReset();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => {
    delete (window as unknown as { gtag?: typeof gtag }).gtag;
  });

  it("says everything stays free and lists the supporter perks", () => {
    renderAt();
    expect(screen.getByRole("heading", { level: 1, name: "Support Relationship Menu" })).toBeInTheDocument();
    expect(screen.getByText(/everything here stays free/)).toBeInTheDocument();
    expect(screen.getByText("Sync across your devices")).toBeInTheDocument();
    expect(screen.getByText("Encrypted backup")).toBeInTheDocument();
    expect(screen.getByText("A supporter heart")).toBeInTheDocument();
  });

  it("offers each amount, with $12/year marked as suggested", () => {
    renderAt();
    const group = screen.getByRole("group", { name: "Pay what you like" });
    for (const option of SUPPORT_OPTIONS) {
      expect(group).toHaveTextContent(option.label);
    }
    expect(screen.getByRole("button", { name: /\$12 \/ year/ })).toHaveTextContent("Suggested");
  });

  it("records where the visit came from, defaulting to direct", () => {
    renderAt({ supportFrom: "share" });
    expect(gtag).toHaveBeenCalledWith("event", "support_viewed", { from: "share" });
    gtag.mockReset();
    renderAt({ supportFrom: "something-else" });
    expect(gtag).toHaveBeenCalledWith("event", "support_viewed", { from: "direct" });
  });

  describe("SY-60: the amounts and their plans", () => {
    it("maps $6, $12 and $24 a year and $30 once to the server's plan ids", () => {
      expect(SUPPORT_OPTIONS.map((o) => [o.label, o.checkoutPlan, o.amount, o.plan])).toEqual([
        ["$6 / year", "supporter_6_yearly", 6, "yearly"],
        ["$12 / year", "supporter_12_yearly", 12, "yearly"],
        ["$24 / year", "supporter_24_yearly", 24, "yearly"],
        ["$30 once", "supporter_30_lifetime", 30, "lifetime"],
      ]);
    });

    it.each(SUPPORT_OPTIONS.map((o, i) => [o.label, i, o.checkoutPlan] as const))(
      "%s asks Checkout for its plan",
      async (_, index, plan) => {
        const { sync } = renderPage();
        fireEvent.click(optionButtons()[index]);
        await waitFor(() => expect(sync.checkout).toHaveBeenCalledWith(plan));
        expect(sync.checkout).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("SY-61: choosing an amount opens Stripe Checkout", () => {
    it("asks for a session, then records checkout_started, remembers the plan and leaves for Stripe", async () => {
      let resolve!: (url: string) => void;
      const sync = fakeSync({ checkout: () => new Promise<string>((r) => (resolve = r)) });
      const { openStripe } = renderPage({ sync });

      fireEvent.click(amountButton(/\$24 \/ year/));
      // Busy while the session is made, so a second click can't start another.
      expect(amountButton(/\$24 \/ year/)).toHaveTextContent("Opening checkout…");
      for (const button of optionButtons()) expect(button).toBeDisabled();
      expect(sent("checkout_started")).toEqual([]);
      expect(openStripe).not.toHaveBeenCalled();

      await act(async () => resolve("https://checkout.stripe.test/session"));
      expect(sent("checkout_started")).toEqual([["checkout_started", { amount_usd: 24, plan: "yearly" }]]);
      expect(sessionStorage.getItem(CHECKOUT_PLAN_KEY)).toBe("supporter_24_yearly");
      expect(openStripe).toHaveBeenCalledWith("https://checkout.stripe.test/session");
    });

    it("with sync off, says before leaving that it turns sync on and creates the sync code", () => {
      renderPage({ sync: fakeSync({ state: { kind: "off" } }) });
      const group = screen.getByRole("group", { name: "Pay what you like" });
      expect(group).toHaveAccessibleDescription(
        /turns on sync in this browser and creates your sync code, which you'll see after paying/
      );
    });

    it("with sync already on, says the support goes to its sync code instead", () => {
      renderPage({ sync: fakeSync({ state: on() }) });
      const group = screen.getByRole("group", { name: "Pay what you like" });
      expect(group).toHaveAccessibleDescription(/Sync is already on in this browser, so your support goes to its sync code/);
      expect(screen.queryByText(/creates your sync code/)).not.toBeInTheDocument();
    });

    it("coming back with Back from Stripe offers the amounts again", async () => {
      const { openStripe } = renderPage();
      fireEvent.click(amountButton(/\$6 \/ year/));
      await waitFor(() => expect(openStripe).toHaveBeenCalled());
      expect(amountButton(/\$6 \/ year/)).toBeDisabled();
      act(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      for (const button of optionButtons()) expect(button).toBeEnabled();
    });
  });

  describe("SY-61, SY-69: when Checkout can't start, it says so plainly and that nothing was charged", () => {
    it.each<[string, unknown, RegExp]>([
      ["offline", new SyncError("offline"), /didn't get an answer from our server/],
      ["rate_limited", new SyncError("rate_limited"), /wait a minute/],
      ["unavailable", new SyncError("unavailable"), /isn't available here/],
      ["failed", new SyncError("failed"), /Something went wrong/],
      ["a non-sync error", new TypeError("boom"), /Something went wrong/],
    ])("%s", async (_, error, words) => {
      const sync = fakeSync({ checkout: () => Promise.reject(error) });
      const { openStripe } = renderPage({ sync });
      fireEvent.click(amountButton(/\$12 \/ year/));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(words);
      expect(alert).toHaveTextContent("Nothing was charged.");
      expect(alert).not.toHaveTextContent("boom");
      expect(alert).toHaveFocus();
      expect(sent("checkout_started")).toEqual([]);
      expect(sessionStorage.getItem(CHECKOUT_PLAN_KEY)).toBeNull();
      expect(openStripe).not.toHaveBeenCalled();
      for (const button of optionButtons()) expect(button).toBeEnabled();
    });

    it("doesn't claim sync was undone when Checkout fails after turning it on", async () => {
      // checkout() with sync off makes a sync code first, and keeps it if Checkout then fails.
      const sync = fakeSync({ state: { kind: "off" }, checkout: () => Promise.reject(new SyncError("offline")) });
      const openStripe = vi.fn();
      const view = render(page(sync, "/support", undefined, openStripe));
      fireEvent.click(amountButton(/\$12 \/ year/));
      const alert = await screen.findByRole("alert");
      view.rerender(page({ ...sync, state: on() }, "/support", undefined, openStripe));

      expect(alert).toHaveTextContent("Nothing was charged.");
      expect(alert).not.toHaveTextContent(/nothing changed|undone|removed|deleted/i);
      expect(screen.getByRole("group", { name: "Pay what you like" })).toHaveAccessibleDescription(
        /Sync is already on in this browser, so your support goes to its sync code/
      );
    });
  });

  describe("SY-14: a browser that can't sync", () => {
    it("says so before any checkout, suggests browsers that can, and doesn't start one", () => {
      const sync = fakeSync({ state: { kind: "unsupported" } });
      renderPage({ sync });
      const group = screen.getByRole("group", { name: "Pay what you like" });
      expect(group).toHaveAccessibleDescription(/This browser can't sync, so supporter checkout can't start here/);
      expect(screen.getByText(/Chrome or Edge 137 or later, Firefox 129 or later, or Safari 17 or later/)).toBeInTheDocument();
      // Never gate (SY-70): it says the rest of the app is unaffected.
      expect(screen.getByText(/Everything else in the app works as usual/)).toBeInTheDocument();
      for (const button of optionButtons()) {
        expect(button).toBeDisabled();
        fireEvent.click(button);
      }
      expect(sync.checkout).not.toHaveBeenCalled();
    });

    it("waits for the check before offering checkout", () => {
      renderPage({ sync: fakeSync({ state: { kind: "loading" } }) });
      for (const button of optionButtons()) expect(button).toBeDisabled();
      expect(screen.queryByText(/This browser can't sync/)).not.toBeInTheDocument();
    });
  });

  describe("SY-69: coming back from a paid Checkout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("waits for Stripe to confirm, and only then says thank you, once, with the server's plan", async () => {
      // The page remembered $12, but the server's plan is what counts.
      sessionStorage.setItem(CHECKOUT_PLAN_KEY, "supporter_12_yearly");
      const confirmed = fakeAccount({ status: "active", plan: "supporter_24_yearly" });
      const sync = fakeSync({ state: on() });
      sync.refreshAccount.mockResolvedValueOnce(NOT_YET).mockResolvedValue(confirmed);
      renderPage({ sync, path: "/support?checkout=done" });

      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent("Waiting for Stripe to confirm…");
      expect(notice).toHaveFocus();
      // Not offering the amounts again, which would invite paying twice.
      expect(screen.queryByRole("group", { name: "Pay what you like" })).not.toBeInTheDocument();

      await flush();
      expect(sync.refreshAccount).toHaveBeenCalledTimes(1);
      expect(notice).toHaveTextContent("Waiting for Stripe to confirm…");
      expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
      expect(sent("checkout_completed")).toEqual([]);

      await flush(CONFIRM_BACKOFF_MS[0]);
      expect(sync.refreshAccount).toHaveBeenCalledTimes(2);
      expect(notice).toHaveTextContent("Thank you, you're a supporter!");
      expect(sent("checkout_completed")).toEqual([["checkout_completed", { amount_usd: 24, plan: "yearly" }]]);
      expect(sessionStorage.getItem(CHECKOUT_PLAN_KEY)).toBeNull();

      // Then: save the sync code.
      expect(screen.getByRole("link", { name: "Show my sync code" })).toHaveAttribute("href", "/sync");
      // And the supporter's own view, not the amounts.
      expect(screen.getByRole("heading", { name: "Your support" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Pay what you like" })).not.toBeInTheDocument();

      // It stops asking, and records the event only once.
      await flush(60_000);
      expect(sync.refreshAccount).toHaveBeenCalledTimes(2);
      expect(sent("checkout_completed")).toHaveLength(1);
    });

    it("removes the query from the address", async () => {
      renderPage({ sync: fakeSync({ state: on() }), path: "/support?checkout=done" });
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/support$/);
    });

    it("if Stripe hasn't confirmed after about a minute, says it can take a few minutes, with Check again", async () => {
      const sync = fakeSync({ state: on(), refreshAccount: async () => NOT_YET });
      renderPage({ sync, path: "/support?checkout=done" });

      const total = CONFIRM_BACKOFF_MS.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(55_000);
      expect(total).toBeLessThanOrEqual(65_000);
      await flush(total - 1);
      expect(screen.getByRole("status")).toHaveTextContent("Waiting for Stripe to confirm…");
      await flush(1);
      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent(/It can take a few minutes, and you don't need to pay again/);
      expect(sync.refreshAccount).toHaveBeenCalledTimes(CONFIRM_BACKOFF_MS.length + 1);
      expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
      expect(sent("checkout_completed")).toEqual([]);
      expect(screen.getByRole("link", { name: "Show my sync code" })).toHaveAttribute("href", "/sync");

      // It stopped asking on its own.
      await flush(120_000);
      expect(sync.refreshAccount).toHaveBeenCalledTimes(CONFIRM_BACKOFF_MS.length + 1);

      sync.refreshAccount.mockResolvedValue(fakeAccount({ status: "lifetime", plan: "supporter_30_lifetime", renewsAt: null }));
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      expect(notice).toHaveTextContent("Waiting for Stripe to confirm…");
      await flush();
      expect(notice).toHaveTextContent("Thank you, you're a supporter!");
      expect(sent("checkout_completed")).toEqual([["checkout_completed", { amount_usd: 30, plan: "lifetime" }]]);
    });

    it("keeps asking through errors", async () => {
      const sync = fakeSync({ state: on() });
      sync.refreshAccount.mockRejectedValueOnce(new SyncError("offline")).mockResolvedValue(fakeAccount());
      renderPage({ sync, path: "/support?checkout=done" });
      await flush();
      expect(screen.getByRole("status")).toHaveTextContent("Waiting for Stripe to confirm…");
      await flush(CONFIRM_BACKOFF_MS[0]);
      expect(screen.getByRole("status")).toHaveTextContent("Thank you, you're a supporter!");
    });

    it("waits for sync to load before asking", async () => {
      const sync = fakeSync({ state: { kind: "loading" } });
      const openStripe = vi.fn();
      const view = render(page(sync, "/support?checkout=done", undefined, openStripe));
      await flush(5000);
      expect(sync.refreshAccount).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Waiting for Stripe to confirm…");

      const loaded = { ...sync, state: on() };
      view.rerender(page(loaded, "/support?checkout=done", undefined, openStripe));
      await flush();
      expect(sync.refreshAccount).toHaveBeenCalledTimes(1);
    });

    it("with sync off in this browser, claims nothing and points to sync settings", async () => {
      const sync = fakeSync({ state: { kind: "off" } });
      renderPage({ sync, path: "/support?checkout=done" });
      await flush(70_000);
      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent(/Sync isn't on in this browser, so we can't check your supporter status here/);
      expect(notice).not.toHaveTextContent(/Thank you/);
      expect(screen.getByRole("link", { name: "sync settings" })).toHaveAttribute("href", "/sync");
      expect(sync.refreshAccount).not.toHaveBeenCalled();
      expect(sent("checkout_completed")).toEqual([]);
    });
  });

  describe("SY-61: coming back from a cancelled Checkout", () => {
    it("says so calmly, records checkout_cancelled with the remembered plan, and cleans the address", () => {
      sessionStorage.setItem(CHECKOUT_PLAN_KEY, "supporter_30_lifetime");
      renderPage({ path: "/support?checkout=cancelled" });
      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent("Checkout was cancelled, and nothing was charged.");
      expect(notice).toHaveFocus();
      expect(sent("checkout_cancelled")).toEqual([["checkout_cancelled", { amount_usd: 30, plan: "lifetime" }]]);
      expect(sessionStorage.getItem(CHECKOUT_PLAN_KEY)).toBeNull();
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/support$/);
      // The amounts are there to try again.
      for (const button of optionButtons()) expect(button).toBeEnabled();
    });

    it("records nothing when it doesn't know the plan (another tab, or storage blocked)", () => {
      sessionStorage.setItem(CHECKOUT_PLAN_KEY, "not-a-plan");
      renderPage({ path: "/support?checkout=cancelled" });
      expect(screen.getByRole("status")).toHaveTextContent("Checkout was cancelled");
      expect(sent("checkout_cancelled")).toEqual([]);
    });

    it("ignores other values of the query, but still removes it", () => {
      renderPage({ path: "/support?checkout=whatever" });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/support$/);
    });
  });

  describe("SY-64: a supporter sees their plan and manages it in Stripe's portal", () => {
    const renewsAt = Date.UTC(2027, 10, 25, 12);
    const date = new Date(renewsAt).toLocaleDateString(undefined, { dateStyle: "long" });

    it("shows the plan, the date it's paid through and Manage subscription instead of the amounts", async () => {
      const sync = fakeSync({ state: on(fakeAccount({ status: "active", plan: "supporter_12_yearly", renewsAt })) });
      const { openStripe } = renderPage({ sync });
      expect(screen.getByRole("heading", { name: "Your support" })).toBeInTheDocument();
      expect(screen.getByText(`You're supporting at $12 a year. Paid through ${date}.`)).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Pay what you like" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
      await waitFor(() => expect(openStripe).toHaveBeenCalledWith("https://billing.stripe.test/session"));
      expect(sync.manageSubscription).toHaveBeenCalledTimes(1);
    });

    it("says when the last payment failed, and that sync keeps working (SY-65)", () => {
      renderPage({ sync: fakeSync({ state: on(fakeAccount({ status: "past_due", renewsAt })) }) });
      expect(screen.getByText(/last payment didn't go through\. Stripe will try again, and sync keeps working/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
    });

    it("a lifetime supporter has nothing to renew", () => {
      renderPage({
        sync: fakeSync({ state: on(fakeAccount({ status: "lifetime", plan: "supporter_30_lifetime", renewsAt: null })) }),
      });
      expect(screen.getByText(/You're a lifetime supporter\. There's nothing to renew\./)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Manage subscription" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Pay what you like" })).not.toBeInTheDocument();
    });

    it.each<AccountStatusCase>([
      ["none", NOT_YET],
      ["lapsed", fakeAccount({ status: "lapsed", readOnly: true })],
    ])("a %s account gets the amounts", (_, account) => {
      renderPage({ sync: fakeSync({ state: on(account) }) });
      expect(screen.getByRole("group", { name: "Pay what you like" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Manage subscription" })).not.toBeInTheDocument();
    });

    it("if Checkout finds the account already supports, shows that instead, and nothing was charged", async () => {
      const sync = fakeSync({
        state: on(),
        checkout: () => Promise.reject(new SyncError("already_supporter")),
        refreshAccount: async () => fakeAccount({ status: "active", plan: "supporter_6_yearly", renewsAt }),
      });
      const { openStripe } = renderPage({ sync });
      fireEvent.click(amountButton(/\$12 \/ year/));
      expect(await screen.findByText(/already a supporter, so nothing was charged/)).toBeInTheDocument();
      expect(screen.getByText(`You're supporting at $6 a year. Paid through ${date}.`)).toBeInTheDocument();
      expect(sent("checkout_started")).toEqual([]);
      expect(openStripe).not.toHaveBeenCalled();
    });

    it.each<[SyncErrorReason, RegExp]>([
      ["offline", /didn't get an answer from our server/],
      ["rate_limited", /wait a minute/],
      ["not_supporter", /couldn't find a subscription/],
      ["failed", /Something went wrong/],
    ])("if the portal can't open (%s), says so plainly", async (reason, words) => {
      const sync = fakeSync({
        state: on(fakeAccount({ renewsAt })),
        manageSubscription: () => Promise.reject(new SyncError(reason)),
      });
      const { openStripe } = renderPage({ sync });
      fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(words);
      expect(alert).toHaveTextContent("Nothing changed.");
      expect(openStripe).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Manage subscription" })).toBeEnabled();
    });
  });

  describe("SY-69, SY-70: honest copy", () => {
    it("describes sync, backup and the heart as they are, and never as locked before", () => {
      const { container } = renderPage();
      const text = container.textContent ?? "";
      expect(text).toMatch(/supporters get a few conveniences/);
      expect(text).not.toMatch(/building them now|coming soon|isn't open yet|unlock|locked|now available/i);
    });
  });

  describe("SY-75: checkout events carry only the amount and plan", () => {
    it("never an account id, code, Stripe id or URL", async () => {
      vi.useFakeTimers();
      const account = fakeAccount({ status: "active", plan: "supporter_6_yearly" });
      const sync = fakeSync({
        state: on(),
        checkout: async (plan: CheckoutPlan) => `https://checkout.stripe.com/c/pay/cs_test_${plan}#secret`,
        refreshAccount: async () => account,
      });
      const first = renderPage({ sync });
      fireEvent.click(amountButton(/\$6 \/ year/));
      await flush();
      first.unmount();
      renderPage({ sync, path: "/support?checkout=cancelled" }).unmount();
      renderPage({ sync, path: "/support?checkout=done" });
      await flush();

      expect(events().map(([name]) => name)).toEqual(
        expect.arrayContaining(["checkout_started", "checkout_cancelled", "checkout_completed"])
      );
      for (const [name, params] of events()) {
        if (name === "support_viewed") continue;
        expect(Object.keys(params as object).sort()).toEqual(["amount_usd", "plan"]);
      }
      expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/stripe|https?:|cs_test|secret|abandon/i);
    });
  });
});

type AccountStatusCase = [string, SyncAccount];
