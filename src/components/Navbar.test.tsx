import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Navbar } from "./Navbar";
import { AccountStatus, SyncState } from "../sync/context";
import { FakeSyncProvider, fakeAccount, fakeSync } from "../sync/fake-sync";

const onWith = (status: AccountStatus | null): SyncState => ({
  kind: "on",
  account: status === null ? null : fakeAccount({ status }),
  pending: 0,
  lastSyncedAt: null,
  notices: [],
  unreadable: 0,
});

const renderWithSync = (state: SyncState) =>
  render(
    <FakeSyncProvider value={fakeSync({ state })}>
      <MemoryRouter>
        <Navbar title="My App" links={[{ to: "/menu", text: "Menu" }]} />
      </MemoryRouter>
    </FakeSyncProvider>
  );

describe("SY-71: the supporter heart", () => {
  it.each<AccountStatus>(["active", "past_due", "lifetime"])(
    "shows for a %s account, labelled and linking to sync settings",
    (status) => {
      renderWithSync(onWith(status));
      const heart = screen.getByRole("link", { name: "Supporter" });
      expect(heart).toHaveAttribute("href", "/sync");
      // The picture is decoration; the label is what's announced.
      expect(heart.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  );

  it.each<AccountStatus>(["none", "lapsed"])("doesn't show for a %s account", (status) => {
    renderWithSync(onWith(status));
    expect(screen.queryByRole("link", { name: "Supporter" })).not.toBeInTheDocument();
  });

  it.each<[string, SyncState]>([
    ["sync off", { kind: "off" }],
    ["still loading", { kind: "loading" }],
    ["an unsupported browser", { kind: "unsupported" }],
    ["no answer from the server yet", onWith(null)],
  ])("doesn't show with %s", (_, state) => {
    renderWithSync(state);
    expect(screen.queryByRole("link", { name: "Supporter" })).not.toBeInTheDocument();
  });

  it("doesn't show outside a sync provider", () => {
    render(
      <MemoryRouter>
        <Navbar title="My App" />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Supporter" })).not.toBeInTheDocument();
  });
});

describe("Navbar", () => {
  it("should render the title", () => {
    render(
      <MemoryRouter>
        <Navbar title="My App" />
      </MemoryRouter>
    );
    expect(screen.getByText("My App")).toBeInTheDocument();
  });

  it("should render navigation links", () => {
    render(
      <MemoryRouter>
        <Navbar
          title="My App"
          links={[
            { to: "/menu", text: "Menu" },
            { to: "/about", text: "About" },
          ]}
        />
      </MemoryRouter>
    );
    // Desktop links
    const menuLinks = screen.getAllByText("Menu");
    expect(menuLinks.length).toBeGreaterThanOrEqual(1);
    const aboutLinks = screen.getAllByText("About");
    expect(aboutLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("should render the hamburger button when links are provided", () => {
    render(
      <MemoryRouter>
        <Navbar
          title="My App"
          links={[{ to: "/menu", text: "Menu" }]}
        />
      </MemoryRouter>
    );
    expect(
      screen.getByRole("button", { name: "Toggle navigation menu" })
    ).toBeInTheDocument();
  });

  it("should not render the hamburger button when no links are provided", () => {
    render(
      <MemoryRouter>
        <Navbar title="My App" />
      </MemoryRouter>
    );
    expect(
      screen.queryByRole("button", { name: "Toggle navigation menu" })
    ).not.toBeInTheDocument();
  });

  it("should toggle mobile links when hamburger is clicked", () => {
    render(
      <MemoryRouter>
        <Navbar
          title="My App"
          links={[
            { to: "/menu", text: "Menu" },
            { to: "/about", text: "About" },
          ]}
        />
      </MemoryRouter>
    );

    const hamburger = screen.getByRole("button", {
      name: "Toggle navigation menu",
    });

    // Initially mobile links should not be visible
    expect(hamburger).toHaveAttribute("aria-expanded", "false");

    // Click to open
    fireEvent.click(hamburger);
    expect(hamburger).toHaveAttribute("aria-expanded", "true");

    // Click again to close
    fireEvent.click(hamburger);
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
  });

  it("should close mobile menu when a link is clicked", () => {
    render(
      <MemoryRouter>
        <Navbar
          title="My App"
          links={[{ to: "/menu", text: "Menu" }]}
        />
      </MemoryRouter>
    );

    const hamburger = screen.getByRole("button", {
      name: "Toggle navigation menu",
    });

    // Open the menu
    fireEvent.click(hamburger);
    expect(hamburger).toHaveAttribute("aria-expanded", "true");

    // Click a mobile link (the mobile links container appears when menu is open)
    const mobileLinks = document.querySelector(".navbar-mobile-links");
    expect(mobileLinks).toBeInTheDocument();
    const mobileLink = mobileLinks!.querySelector("a");
    expect(mobileLink).toBeTruthy();
    fireEvent.click(mobileLink!);
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
  });

  it("should not render hamburger when links array is empty", () => {
    render(
      <MemoryRouter>
        <Navbar title="My App" links={[]} />
      </MemoryRouter>
    );
    expect(
      screen.queryByRole("button", { name: "Toggle navigation menu" })
    ).not.toBeInTheDocument();
  });
});
