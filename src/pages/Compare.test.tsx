import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ComparePage } from "./Compare";

// The overview repeats some names (biggest differences, groups), so look in the grid.
const grid = () => within(document.querySelector(".compare-page-grid") as HTMLElement);
const filters = () => within(screen.getByRole("group", { name: "Show items" }));

// The page links to /support, so it needs a router.
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

describe("ComparePage", () => {
  const defaultProps = {
    titles: ["Alice", "Bob"],
    encoded: ["encoded1", "encoded2"],
    comparison: {},
    showComparison: false,
    onChangeCompared: vi.fn(),
    onCompare: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the compare section with inputs", () => {
    render(<ComparePage {...defaultProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("should render encoded values in inputs", () => {
    render(<ComparePage {...defaultProps} />);
    expect(screen.getByDisplayValue("encoded1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("encoded2")).toBeInTheDocument();
  });

  it("should render the Compare button", () => {
    render(<ComparePage {...defaultProps} />);
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("should not show comparison grid when showComparison is false", () => {
    const { container } = render(<ComparePage {...defaultProps} />);
    expect(
      container.querySelector(".compare-page-grid")
    ).not.toBeInTheDocument();
  });

  it("should show comparison grid when showComparison is true", () => {
    const comparison = {
      Physical: [
        { item: "Kissing", values: ["must-have", "like-to-have"] as any },
      ],
    };
    const { container } = render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
      />
    );
    expect(container.querySelector(".compare-page-grid")).toBeInTheDocument();
    expect(grid().getByText("Kissing")).toBeInTheDocument();
    expect(grid().getByText("Physical")).toBeInTheDocument();
  });

  it("should render legend in comparison grid", () => {
    const comparison = {
      Values: [
        { item: "Trust", values: ["must-have", "maybe"] as any },
      ],
    };
    render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
      />
    );
    // Legend should display the titles; each appears in mobile + desktop legend + input label
    expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(2);
  });

  it("should call onCompare when Compare button is clicked", () => {
    const onCompare = vi.fn();
    render(<ComparePage {...defaultProps} onCompare={onCompare} />);
    fireEvent.click(screen.getByText("Compare"));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("should render multiple groups in comparison", () => {
    const comparison = {
      Physical: [
        { item: "Kissing", values: ["must-have", "maybe"] as any },
      ],
      Emotional: [
        { item: "Trust", values: ["like-to-have", "off-limits"] as any },
      ],
    };
    render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
      />
    );
    expect(grid().getByText("Physical")).toBeInTheDocument();
    expect(grid().getByText("Emotional")).toBeInTheDocument();
    expect(grid().getByText("Kissing")).toBeInTheDocument();
    expect(grid().getByText("Trust")).toBeInTheDocument();
  });

  it("filters the grid to conflicting items and shows counts", () => {
    const comparison = {
      Physical: [
        { item: "Kissing", values: ["must-have", "must-have"] as any },
        { item: "Dancing", values: ["like-to-have", "off-limits"] as any },
      ],
      Emotional: [{ item: "Trust", values: ["maybe", "maybe"] as any }],
    };
    render(
      <ComparePage {...defaultProps} comparison={comparison} showComparison={true} />
    );
    const conflicts = filters().getByRole("button", { name: /Conflicts/ });
    expect(conflicts).toHaveTextContent("1");
    fireEvent.click(conflicts);
    expect(conflicts).toHaveAttribute("aria-pressed", "true");
    expect(grid().getByText("Dancing")).toBeInTheDocument();
    expect(grid().queryByText("Kissing")).not.toBeInTheDocument();
    // Groups with no matching items are hidden.
    expect(grid().queryByText("Emotional")).not.toBeInTheDocument();
    fireEvent.click(filters().getByRole("button", { name: /^All 3/ }));
    expect(grid().getByText("Kissing")).toBeInTheDocument();
  });

  it("shows an overview and can search, pick a group and sort by difference (CP-24, CP-25)", () => {
    const comparison = {
      Physical: [
        { item: "Kissing", values: ["must-have", "must-have"] as any },
        { item: "Dancing", values: ["must-have", "off-limits"] as any, notes: ["at weddings", undefined] },
      ],
      Emotional: [{ item: "Trust", values: ["like-to-have", "maybe"] as any }],
    };
    render(
      <ComparePage {...defaultProps} comparison={comparison} showComparison={true} discussLink="/discuss?x" />
    );
    const overview = within(screen.getByRole("region", { name: "At a glance" }));
    expect(overview.getByText(/You agree on/)).toHaveTextContent("You agree on 33% of the 3 items everyone answered, with 1 conflict.");
    expect(overview.getByRole("link", { name: /Talk it through/ })).toHaveAttribute("href", "/discuss?x");

    // Search matches notes too.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wedding" } });
    expect(grid().getByText("Dancing")).toBeInTheDocument();
    expect(grid().queryByText("Kissing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Group" }), { target: { value: "Emotional" } });
    expect(grid().getByText("Trust")).toBeInTheDocument();
    expect(grid().queryByText("Kissing")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Group" }), { target: { value: "" } });

    fireEvent.change(screen.getByRole("combobox", { name: "Order" }), { target: { value: "difference" } });
    const rows = document.querySelectorAll(".compare-page-grid .menu-item-compare .menu-item");
    expect(Array.from(rows).map((r) => r.textContent)).toEqual([
      "Dancing · Physical",
      "Trust · Emotional",
      "Kissing · Physical",
    ]);
  });
});
