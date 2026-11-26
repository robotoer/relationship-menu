import { encodeData } from "../data-encoder";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LibraryPage } from "./Library";
import { FakeSyncProvider, fakeAccount, fakeSync } from "../sync/fake-sync";

// Mock react-random-avatars to avoid rendering SVG complexity in tests
vi.mock("react-random-avatars", () => ({
  RandomAvatar: ({ name }: { name: string }) => (
    <div data-testid={`avatar-${name}`}>Avatar</div>
  ),
}));

describe("LibraryPage", () => {
  const menus = [
    { title: "My First Menu", encoded: "encoded1", id: "id1", link: "slug1" },
    { title: "My Second Menu", encoded: "encoded2", id: "id2", link: "slug2" },
  ];

  it("should render all menu tiles", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} />
      </MemoryRouter>
    );
    expect(screen.getByText("My First Menu")).toBeInTheDocument();
    expect(screen.getByText("My Second Menu")).toBeInTheDocument();
  });

  it("should render View links for each menu", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} />
      </MemoryRouter>
    );
    const viewLinks = screen.getAllByText("View");
    expect(viewLinks).toHaveLength(2);
  });

  it("should render the Create New Menu button", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText("Create New Menu")).toBeInTheDocument();
  });

  it("should render delete buttons when onDelete is provided", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} onDelete={vi.fn()} />
      </MemoryRouter>
    );
    expect(
      screen.getByRole("button", { name: "Delete My First Menu" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete My Second Menu" })
    ).toBeInTheDocument();
  });

  it("should not render delete buttons when onDelete is not provided", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} />
      </MemoryRouter>
    );
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("should call onDelete with the menu id when delete is clicked", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} onDelete={onDelete} />
      </MemoryRouter>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete My First Menu" })
    );
    // Deleting asks for confirmation first.
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, delete My First Menu" })
    );
    expect(onDelete).toHaveBeenCalledWith("id1");
  });

  it("should not delete when the confirmation is declined", () => {
    const onDelete = vi.fn();
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} onDelete={onDelete} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete My First Menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Delete My First Menu" })
    ).toBeInTheDocument();
  });

  it("should render avatars for each menu", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("avatar-My First Menu")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-My Second Menu")).toBeInTheDocument();
  });

  it("should render an empty library with just the create button", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByText("View")).not.toBeInTheDocument();
    expect(screen.getByText("Create New Menu")).toBeInTheDocument();
  });

  it("shows details and supports search and sort", () => {
    const enc = (items: object) => encodeData(items);
    const rich = [
      {
        title: "Beta",
        id: "b",
        link: "b",
        encoded: enc({ G: [{ item: "Trust", value: "maybe" }, { item: "Dancing" }] }),
        person: { name: "Sam", pronouns: "they/them" },
        createdAt: Date.UTC(2026, 2, 2),
        updatedAt: Date.now() - 2 * 24 * 3600 * 1000,
      },
      { title: "Alpha", id: "a", link: "a", encoded: enc({ G: [{ item: "Hiking" }] }) },
    ];
    render(
      <MemoryRouter>
        <LibraryPage menus={rich} />
      </MemoryRouter>
    );
    expect(screen.getByText("Sam (they/them)")).toBeInTheDocument();
    expect(screen.getByText("2 in 1 group")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Beta: answered" })).toHaveAttribute(
      "aria-valuenow",
      "1"
    );
    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings()).toEqual(["Beta", "Alpha"]); // recently edited first
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "title" } });
    expect(headings()).toEqual(["Alpha", "Beta"]);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "hiking" } });
    expect(headings()).toEqual(["Alpha"]);
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("HO-7: an empty Library points to the old address, which brings menus over", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} oldAddress="https://relationship-menu.vercel.app" />
      </MemoryRouter>
    );
    expect(screen.getByText(/Open that address once in this browser to bring your menus here/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "relationship-menu.vercel.app" })).toHaveAttribute(
      "href",
      "https://relationship-menu.vercel.app/library"
    );
  });

  it("HO-7: says nothing about the old address once there are menus, or without one", () => {
    const { rerender } = render(
      <MemoryRouter>
        <LibraryPage menus={menus} oldAddress="https://relationship-menu.vercel.app" />
      </MemoryRouter>
    );
    expect(screen.queryByText(/Used this app before/)).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByText(/Used this app before/)).not.toBeInTheDocument();
  });
});

describe("LibraryPage: keeping menus", () => {
  const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  // `id` is the menu's storage id and `link` the slug its tile opens; neither is
  // used for the export, which builds each link from the menu itself.
  const menus = [
    {
      title: "Alpha",
      id: "menu-id-alpha",
      link: "tile-link-alpha",
      encoded: encodeData({ G: [{ item: "Hiking", value: "maybe" as const }] }),
    },
    { title: "Beta", id: "menu-id-beta", link: "tile-link-beta", encoded: encodeData({ G: [{ item: "Trust" }] }) },
  ];
  let gtag: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("SV-13: Export all menus saves every menu, even ones hidden by a search", async () => {
    const files: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      files.push(blob);
      return "blob:local-file";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} />
      </MemoryRouter>
    );
    const button = screen.getByRole("button", { name: "Export all menus" });
    expect(button).toHaveAccessibleDescription(
      "A backup file with a link to each menu. It's made on this device and never uploaded."
    );
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "hiking" } });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByText("Downloaded a file with 2 menus.")).toBeInTheDocument();
    const text = await files[0].text();
    expect(text).toContain("1. Alpha");
    expect(text).toContain("2. Beta");
    // Each link is the menu itself; storage ids never go into the file.
    expect(text).not.toContain("menu-id-");
    expect(text).not.toContain("tile-link-");
    // Only that it happened: no titles, no count.
    expect(gtag).toHaveBeenCalledWith("event", "menus_exported", {});
  });

  it("SV-13: an empty Library has nothing to export", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: "Export all menus" })).not.toBeInTheDocument();
  });

  it("SV-12: an empty Library suggests the Home Screen on iPhone Safari, a full one doesn't", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_SAFARI);
    const { unmount } = render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.getByRole("complementary", { name: "Tip: keep your menus" })).toBeInTheDocument();
    unmount();
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("SV-12: no tip in other browsers", () => {
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});

describe("LibraryPage: the way into sync (SY-3…SY-13)", () => {
  it("links to sync settings, with or without menus and without any account (SY-70)", () => {
    const { unmount } = render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Sync your menus" })).toHaveAttribute("href", "/sync");
    unmount();
    render(
      <MemoryRouter>
        <LibraryPage menus={[{ title: "A", encoded: "x", id: "a", link: "a" }]} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Sync your menus" })).toHaveAttribute("href", "/sync");
  });

  it("says when sync is on", () => {
    const sync = fakeSync({
      state: { kind: "on", account: fakeAccount(), pending: 0, lastSyncedAt: null, notices: [], unreadable: 0 },
    });
    render(
      <MemoryRouter>
        <FakeSyncProvider value={sync}>
          <LibraryPage menus={[]} />
        </FakeSyncProvider>
      </MemoryRouter>
    );
    expect(screen.getByText(/Sync is on in this browser\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sync settings" })).toHaveAttribute("href", "/sync");
  });
});
