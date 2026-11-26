import {
  render as rtlRender,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ComparePage } from "./Compare";

// The overview repeats some names (biggest differences, groups), so look in the grid.
const grid = () =>
  within(document.querySelector(".compare-page-grid") as HTMLElement);
const filters = () => within(screen.getByRole("group", { name: "Show items" }));

// The page links to /support, so it needs a router.
const render = (ui: ReactElement) =>
  rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

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
      container.querySelector(".compare-page-grid"),
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
      />,
    );
    expect(container.querySelector(".compare-page-grid")).toBeInTheDocument();
    expect(grid().getByText("Kissing")).toBeInTheDocument();
    expect(grid().getByText("Physical")).toBeInTheDocument();
  });

  it("should render legend in comparison grid", () => {
    const comparison = {
      Values: [{ item: "Trust", values: ["must-have", "maybe"] as any }],
    };
    render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
      />,
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
      Physical: [{ item: "Kissing", values: ["must-have", "maybe"] as any }],
      Emotional: [
        { item: "Trust", values: ["like-to-have", "off-limits"] as any },
      ],
    };
    render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
      />,
    );
    expect(grid().getByText("Physical")).toBeInTheDocument();
    expect(grid().getByText("Emotional")).toBeInTheDocument();
    expect(grid().getByText("Kissing")).toBeInTheDocument();
    expect(grid().getByText("Trust")).toBeInTheDocument();
  });

  it("filters the grid to conflicting items and shows counts that add up (CP-12, CP-30)", () => {
    const comparison = {
      Physical: [
        { item: "Kissing", values: ["must-have", "must-have"] as any },
        { item: "Dancing", values: ["like-to-have", "off-limits"] as any },
      ],
      Emotional: [{ item: "Trust", values: ["maybe", "maybe"] as any }],
    };
    render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
      />,
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
    // The zones split every item exactly once.
    // Kissing (both Must have) is the same page; Trust (both Maybe) is a quick check.
    expect(
      filters().getByRole("button", { name: /Same page/ }),
    ).toHaveTextContent("1");
    expect(
      filters().getByRole("button", { name: /Quick checks/ }),
    ).toHaveTextContent("1");
    // Rows that need a talk say so; aligned rows don't.
    expect(grid().getByText("Conflict")).toBeInTheDocument();
    expect(
      document.querySelectorAll(".compare-page-grid .zone-tag"),
    ).toHaveLength(1);
  });

  it("shows an overview and can search, pick a group and sort by difference (CP-24, CP-25)", () => {
    const comparison = {
      Physical: [
        { item: "Kissing", values: ["must-have", "must-have"] as any },
        {
          item: "Dancing",
          values: ["must-have", "off-limits"] as any,
          notes: ["at weddings", undefined],
        },
      ],
      Emotional: [{ item: "Trust", values: ["like-to-have", "maybe"] as any }],
    };
    render(
      <ComparePage
        {...defaultProps}
        comparison={comparison}
        showComparison={true}
        discussLink="/discuss?x"
      />,
    );
    const overview = within(
      screen.getByRole("region", { name: "Where you stand" }),
    );
    expect(overview.getByText(/on the same page/)).toHaveTextContent(
      "Alice & Bob: you're on the same page on 1 of 3 items. 2 are worth a real conversation, including 1 conflict.",
    );
    expect(
      overview.getByRole("link", { name: /Talk it through/ }),
    ).toHaveAttribute("href", "/discuss?x");
    // What to talk about first names who answered what, and shows their notes (CP-32).
    const first = overview.getByRole("heading", {
      name: "Talk about these first",
    }).parentElement!;
    expect(first).toHaveTextContent(
      /Dancing.*Alice: Must Have.*Bob: Off Limits.*at weddings/,
    );
    // What matters most to each person (CP-33).
    const people = overview.getByRole("heading", {
      name: "What matters most to each of you",
    }).parentElement!;
    expect(people).toHaveTextContent("Must-haves that aren't a yes for Bob:");
    expect(people).toHaveTextContent("Off limits, but Alice wants it:");
    // Each zone opens its items below.
    fireEvent.click(
      overview.getByRole("button", { name: /^Talk about it: 1/ }),
    );
    expect(
      filters().getByRole("button", { name: /Talk about it/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(grid().getByText("Trust")).toBeInTheDocument();
    expect(grid().queryByText("Dancing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));

    // Search matches notes too.
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "wedding" },
    });
    expect(grid().getByText("Dancing")).toBeInTheDocument();
    expect(grid().queryByText("Kissing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Group" }), {
      target: { value: "Emotional" },
    });
    expect(grid().getByText("Trust")).toBeInTheDocument();
    expect(grid().queryByText("Kissing")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Group" }), {
      target: { value: "" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Order" }), {
      target: { value: "difference" },
    });
    const rows = document.querySelectorAll(
      ".compare-page-grid .menu-item-compare .menu-item",
    );
    expect(Array.from(rows).map((r) => r.textContent)).toEqual([
      "Dancing · Physical",
      "Trust · Emotional",
      "Kissing · Physical",
    ]);
    // Not one group: a band for each distance, each item still naming its group.
    expect(
      grid()
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(["Conflicts 1", "One step apart 1", "Same answer 1"]);
    expect(
      screen.queryByRole("heading", { name: "Biggest differences first" }),
    ).not.toBeInTheDocument();
    expect(
      grid().getByText(/Squares, left to right: Alice, Bob/),
    ).toBeInTheDocument();
  });

  it("a shortened list says how many more there are and opens them (Show more)", () => {
    const shared = Array.from({ length: 11 }, (_, i) => ({
      item: `Shared ${i + 1}`,
      values: ["must-have", "must-have"] as any,
    }));
    render(
      <ComparePage
        {...defaultProps}
        comparison={{ G: shared }}
        showComparison={true}
      />,
    );
    const overview = within(
      screen.getByRole("region", { name: "Where you stand" }),
    );
    expect(overview.queryByText("Shared 11")).not.toBeInTheDocument();
    const more = overview.getByRole("button", { name: "Show 3 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(overview.getByText("Shared 11")).toBeInTheDocument();
    expect(
      overview.getByRole("button", { name: "Show fewer" }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(overview.getByRole("button", { name: "Show fewer" }));
    expect(overview.queryByText("Shared 11")).not.toBeInTheDocument();
  });
});
