import { render, screen } from "@testing-library/react";
import { MenuCompareLegend } from "./MenuCompareLegend";

describe("MenuCompareLegend", () => {
  it("should render all titles", () => {
    render(<MenuCompareLegend titles={["Alice", "Bob"]} />);
    // Each title appears twice: once in mobile, once in desktop
    expect(screen.getAllByText("Alice")).toHaveLength(2);
    expect(screen.getAllByText("Bob")).toHaveLength(2);
  });

  it("should render an empty legend with no titles", () => {
    const { container } = render(<MenuCompareLegend titles={[]} />);
    const legendTitles = container.querySelectorAll(".legend-title");
    expect(legendTitles).toHaveLength(0);
  });

  it("should render mobile titles in legend-titles-mobile container", () => {
    const { container } = render(
      <MenuCompareLegend titles={["Alice", "Bob", "Charlie"]} />
    );
    const mobileContainer = container.querySelector(".legend-titles-mobile");
    expect(mobileContainer).toBeInTheDocument();
    const spans = mobileContainer!.querySelectorAll("span");
    expect(spans).toHaveLength(3);
    expect(spans[0]).toHaveTextContent("Alice");
    expect(spans[1]).toHaveTextContent("Bob");
    expect(spans[2]).toHaveTextContent("Charlie");
  });

  it("should render desktop titles in legend-title-outer containers", () => {
    const { container } = render(
      <MenuCompareLegend titles={["Alice", "Bob"]} />
    );
    const outerContainers = container.querySelectorAll(".legend-title-outer");
    expect(outerContainers).toHaveLength(2);
  });
});
