import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MenuTile } from "./MenuTile";

describe("MenuTile", () => {
  it("should render the title", () => {
    render(
      <MemoryRouter>
        <MenuTile title="My Menu" image={<span>🖼️</span>} link="/menu?id=1" />
      </MemoryRouter>
    );
    expect(screen.getByText("My Menu")).toBeInTheDocument();
  });

  it("should render the image", () => {
    render(
      <MemoryRouter>
        <MenuTile
          title="My Menu"
          image={<img alt="menu avatar" src="test.png" />}
          link="/menu?id=1"
        />
      </MemoryRouter>
    );
    expect(screen.getByAltText("menu avatar")).toBeInTheDocument();
  });

  it("should render a View link with the correct href", () => {
    render(
      <MemoryRouter>
        <MenuTile title="My Menu" image={<span>🖼️</span>} link="/menu?id=1" />
      </MemoryRouter>
    );
    const link = screen.getByText("View");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/menu?id=1");
  });
});
