import { encodeData } from "../data-encoder";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LibraryPage } from "./Library";
import { FakeSyncProvider, fakeAccount, fakeSync } from "../sync/fake-sync";
import type { TextImport } from "../import-menus";

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

describe("LibraryPage: Import menus (SV-14)", () => {
  const result = (over: Partial<TextImport> = {}): TextImport => ({
    add: [],
    alreadyHere: 0,
    renamed: [],
    found: 0,
    unreadable: 0,
    ...over,
  });
  let gtag: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
  });
  afterEach(() => {
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  const open = () => {
    const button = screen.getByRole("button", { name: "Import menus" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    return screen.getByRole("form", { name: "Import menus" });
  };

  it("is offered in an empty Library (a new Home Screen app), and only where it can save", () => {
    const { unmount } = render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "Import menus" })).toHaveAccessibleDescription(
      "Bring menus here from a backup file, menu links, a relationshipmenu.org file, a spreadsheet, a form's responses or a list."
    );
    unmount();
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: "Import menus" })).not.toBeInTheDocument();
  });

  it("imports pasted links, says what happened, and counts only that it happened", async () => {
    const onImport = vi.fn().mockResolvedValue(
      result({ add: [{ title: "A", encoded: "x" }, { title: "B", encoded: "y" }, { title: "C", encoded: "z" }], alreadyHere: 1, found: 4 })
    );
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={onImport} />
      </MemoryRouter>
    );
    open();
    const field = screen.getByLabelText("Paste menu links — or a list of items");
    expect(field).toHaveFocus();
    const add = screen.getByRole("button", { name: "Add menus" });
    expect(add).toBeDisabled();
    fireEvent.change(field, { target: { value: "https://example.test/menu?encoded=secret" } });
    await act(async () => {
      fireEvent.click(add);
    });
    expect(onImport).toHaveBeenCalledWith("https://example.test/menu?encoded=secret");
    expect(screen.getByText("Added 3 menus, 1 was already here.")).toBeInTheDocument();
    // Done: the form closes and focus goes back to the button.
    expect(screen.queryByRole("form", { name: "Import menus" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import menus" })).toHaveFocus();
    expect(gtag).toHaveBeenCalledWith("event", "menus_imported", {});
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("secret");
  });

  it("reads a chosen backup file on this device", async () => {
    const onImport = vi.fn().mockResolvedValue(result({ add: [{ title: "A", encoded: "x" }], found: 1 }));
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={onImport} />
      </MemoryRouter>
    );
    open();
    const input = screen.getByLabelText("Choose a file") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "file");
    const file = new File(["Wants & Won'ts: 1 menu\n\n1. A\nhttps://example.test/menu?encoded=a\n"], "backup.txt", {
      type: "text/plain",
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(onImport).toHaveBeenCalledWith("Wants & Won'ts: 1 menu\n\n1. A\nhttps://example.test/menu?encoded=a\n");
    expect(screen.getByText("Added 1 menu.")).toBeInTheDocument();
  });

  it("reads a spreadsheet as one menu per person, through the file importer (SV-16)", async () => {
    const onImportFile = vi.fn().mockResolvedValue(result({ add: [{ title: "Ana", encoded: "x" }, { title: "Ben", encoded: "y" }], found: 2 }));
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={vi.fn()} onImportFile={onImportFile} />
      </MemoryRouter>
    );
    open();
    const file = new File(["Item,Ana,Ben\nWeekly time together,Must have,Off limits\n"], "menus.csv", { type: "text/csv" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [file] } });
    });
    expect(onImportFile).toHaveBeenCalledWith("Item,Ana,Ben\nWeekly time together,Must have,Off limits\n", "menus.csv");
    expect(screen.getByText("Added 2 menus.")).toBeInTheDocument();
    expect(gtag).toHaveBeenCalledWith("event", "menus_imported", {});
  });

  it("explains that a noescalator.com link can't be read here (SV-16)", async () => {
    const onImport = vi.fn();
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={onImport} />
      </MemoryRouter>
    );
    open();
    fireEvent.change(screen.getByLabelText("Paste menu links — or a list of items"), {
      target: { value: "https://noescalator.com/?view=abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add menus" }));
    expect(await screen.findByText(/keeps its menu on their site/)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("keeps the form open when nothing was found, and counts nothing", async () => {
    const onImport = vi.fn().mockResolvedValue(result({ unreadable: 1 }));
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={onImport} />
      </MemoryRouter>
    );
    open();
    fireEvent.change(screen.getByLabelText("Paste menu links — or a list of items"), { target: { value: "https://x.test/menu?encoded=cut" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add menus" }));
    });
    expect(screen.getByText("That link or file couldn't be read. A link may have been cut off; a file may not be a menu.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Import menus" })).toBeInTheDocument();
    expect(screen.getByLabelText("Paste menu links — or a list of items")).toHaveValue("https://x.test/menu?encoded=cut");
    expect(gtag).not.toHaveBeenCalledWith("event", "menus_imported", expect.anything());
  });

  it("says when the menus couldn't be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onImport = vi.fn().mockRejectedValue(new Error("storage full"));
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={onImport} />
      </MemoryRouter>
    );
    open();
    fireEvent.change(screen.getByLabelText("Paste menu links — or a list of items"), { target: { value: "link" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add menus" }));
    });
    expect(screen.getByText("Couldn't save the menus. Try again: any that were saved are skipped.")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("Cancel and Escape close it without importing", () => {
    const onImport = vi.fn();
    render(
      <MemoryRouter>
        <LibraryPage menus={[]} onImport={onImport} />
      </MemoryRouter>
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Import menus" })).not.toBeInTheDocument();
    open();
    fireEvent.keyDown(screen.getByLabelText("Paste menu links — or a list of items"), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Import menus" })).not.toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });
});
