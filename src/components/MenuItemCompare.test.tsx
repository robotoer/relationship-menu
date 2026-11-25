import { render, screen } from "@testing-library/react";
import { MenuItemCompare } from "./MenuItemCompare";

describe("MenuItemCompare", () => {
  it("should render the item name", () => {
    render(<MenuItemCompare item="Kissing" menuItems={[]} />);
    expect(screen.getByText("Kissing")).toBeInTheDocument();
  });

  it("should render color indicators for each menu item value", () => {
    const { container } = render(
      <MenuItemCompare
        item="Kissing"
        menuItems={["must-have", "like-to-have", "maybe", "off-limits"]}
      />
    );
    const indicators = container.querySelectorAll(".menu-item-compare > div");
    // 4 value indicators + 1 item text div = 5
    expect(indicators).toHaveLength(5);
    expect(indicators[0]).toHaveClass("must-have");
    expect(indicators[1]).toHaveClass("like-to-have");
    expect(indicators[2]).toHaveClass("maybe");
    expect(indicators[3]).toHaveClass("off-limits");
  });

  it("should apply 'unknown' class for undefined values", () => {
    const { container } = render(
      <MenuItemCompare item="Kissing" menuItems={[undefined, "must-have"]} />
    );
    const indicators = container.querySelectorAll(".menu-item-compare > div");
    expect(indicators[0]).toHaveClass("unknown");
    expect(indicators[1]).toHaveClass("must-have");
  });

  it("should render the item text in a menu-item div", () => {
    const { container } = render(
      <MenuItemCompare item="Trust" menuItems={["maybe"]} />
    );
    const itemDiv = container.querySelector(".menu-item");
    expect(itemDiv).toHaveTextContent("Trust");
  });

  it("should apply 'absent' class when the item is not on a menu (null)", () => {
    const { container } = render(
      <MenuItemCompare item="Trust" menuItems={[null, undefined]} />
    );
    const indicators = container.querySelectorAll(".menu-item-compare > div");
    expect(indicators[0]).toHaveClass("absent");
    expect(indicators[1]).toHaveClass("unknown");
  });

  it("should label each cell with the menu title and preference", () => {
    render(
      <MenuItemCompare
        item="Trust"
        menuItems={["maybe", null]}
        titles={["Alice", "Bob"]}
      />
    );
    expect(screen.getByRole("img", { name: "Alice: Maybe" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Bob: Not on this menu" })
    ).toBeInTheDocument();
  });

  it("lists each person's note under the item, labelled with whose it is", () => {
    render(
      <MenuItemCompare
        item="Kissing"
        menuItems={["must-have", "maybe", null]}
        titles={["Ana", "Ben", "Cy"]}
        notes={["not in public", undefined, undefined]}
      />
    );
    const notes = screen.getByRole("list", { name: "Notes on Kissing" });
    expect(notes).toHaveTextContent("Ana: not in public");
    expect(notes).not.toHaveTextContent("Ben");
  });

  it("shows no notes list when nobody wrote one", () => {
    render(<MenuItemCompare item="Kissing" menuItems={["maybe"]} titles={["Ana"]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
