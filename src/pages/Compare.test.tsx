import { render, screen, fireEvent } from "@testing-library/react";
import { ComparePage } from "./Compare";

describe("ComparePage", () => {
  const defaultProps = {
    titles: ["Alice", "Bob"],
    encoded: ["encoded1", "encoded2"],
    comparison: {},
    showComparison: false,
    onChangeCompared: jest.fn(),
    onCompare: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(screen.getByText("Kissing")).toBeInTheDocument();
    expect(screen.getByText("Physical")).toBeInTheDocument();
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
    const onCompare = jest.fn();
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
    expect(screen.getByText("Physical")).toBeInTheDocument();
    expect(screen.getByText("Emotional")).toBeInTheDocument();
    expect(screen.getByText("Kissing")).toBeInTheDocument();
    expect(screen.getByText("Trust")).toBeInTheDocument();
  });
});
