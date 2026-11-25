import { encodeData } from "../data-encoder";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LibraryPage } from "./Library";

// Mock react-random-avatars to avoid rendering SVG complexity in tests
vi.mock("react-random-avatars", () => ({
  RandomAvatar: ({ name }: { name: string }) => (
    <div data-testid={`avatar-${name}`}>Avatar</div>
  ),
}));

describe("LibraryPage", () => {
  const menus = [
    { title: "My First Menu", encoded: "encoded1", id: "id1" },
    { title: "My Second Menu", encoded: "encoded2", id: "id2" },
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

  it("should call onDelete with the menu title when delete is clicked", async () => {
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
    expect(onDelete).toHaveBeenCalledWith("My First Menu");
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
        encoded: enc({ G: [{ item: "Trust", value: "maybe" }, { item: "Dancing" }] }),
        person: { name: "Sam", pronouns: "they/them" },
        createdAt: Date.UTC(2026, 2, 2),
        updatedAt: Date.now() - 2 * 24 * 3600 * 1000,
      },
      { title: "Alpha", id: "a", encoded: enc({ G: [{ item: "Hiking" }] }) },
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
