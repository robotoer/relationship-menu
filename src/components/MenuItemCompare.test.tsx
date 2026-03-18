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
});
