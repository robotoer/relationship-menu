import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LibraryPage } from "./Library";

// Mock react-random-avatars to avoid rendering SVG complexity in tests
jest.mock("react-random-avatars", () => ({
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
        <LibraryPage menus={menus} onDelete={jest.fn()} />
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
    const onDelete = jest.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LibraryPage menus={menus} onDelete={onDelete} />
      </MemoryRouter>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete My First Menu" })
    );
    expect(onDelete).toHaveBeenCalledWith("My First Menu");
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
});
