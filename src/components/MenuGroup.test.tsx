import { render, screen, fireEvent } from "@testing-library/react";
import { MenuGroup } from "./MenuGroup";

describe("MenuGroup", () => {
  it("should render with a title", () => {
    render(<MenuGroup title={<h2>Physical</h2>} />);
    expect(screen.getByText("Physical")).toBeInTheDocument();
  });

  it("should render children", () => {
    render(
      <MenuGroup title={<h2>Physical</h2>}>
        <p>Child content</p>
      </MenuGroup>
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("should render a delete button when onDelete is provided", () => {
    const onDelete = jest.fn();
    render(
      <MenuGroup title={<h2>Physical</h2>} onDelete={onDelete} />
    );
    expect(
      screen.getByRole("button", { name: "Delete group" })
    ).toBeInTheDocument();
  });

  it("should not render a delete button when onDelete is not provided", () => {
    render(<MenuGroup title={<h2>Physical</h2>} />);
    expect(
      screen.queryByRole("button", { name: "Delete group" })
    ).not.toBeInTheDocument();
  });

  it("should call onDelete when the delete button is clicked", () => {
    const onDelete = jest.fn();
    render(
      <MenuGroup title={<h2>Physical</h2>} onDelete={onDelete} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("should use custom deleteAriaLabel when provided", () => {
    const onDelete = jest.fn();
    render(
      <MenuGroup
        title={<h2>Physical</h2>}
        onDelete={onDelete}
        deleteAriaLabel="Remove Physical group"
      />
    );
    expect(
      screen.getByRole("button", { name: "Remove Physical group" })
    ).toBeInTheDocument();
  });

  it("should use default 'Delete group' aria label when deleteAriaLabel is not provided", () => {
    render(
      <MenuGroup title={<h2>Physical</h2>} onDelete={jest.fn()} />
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", "Delete group");
    expect(button).toHaveAttribute("title", "Delete group");
  });
});
