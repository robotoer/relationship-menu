import { render, screen, fireEvent } from "@testing-library/react";
import { SharePane } from "./SharePane";

describe("SharePane", () => {
  it("should render the value in a read-only input", () => {
    render(<SharePane value="https://example.com/menu?encoded=abc" />);
    const input = screen.getByDisplayValue(
      "https://example.com/menu?encoded=abc"
    );
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("readOnly");
  });

  it("should render the title when provided", () => {
    render(<SharePane value="test" title="Share Link" />);
    expect(screen.getByText("Share Link")).toBeInTheDocument();
  });

  it("should not render a title element when title is not provided", () => {
    const { container } = render(<SharePane value="test" />);
    expect(container.querySelector(".title")).not.toBeInTheDocument();
  });

  it("should render the description when provided", () => {
    render(<SharePane value="test" description="Copy this link" />);
    expect(screen.getByText("Copy this link")).toBeInTheDocument();
  });

  it("should not render a description element when description is not provided", () => {
    const { container } = render(<SharePane value="test" />);
    expect(container.querySelector(".description")).not.toBeInTheDocument();
  });

  it("should render a Copy button", () => {
    render(<SharePane value="test-value" />);
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("should copy value to clipboard when Copy button is clicked", () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    try {
      render(<SharePane value="copy-me" />);
      fireEvent.click(screen.getByText("Copy"));
      expect(writeText).toHaveBeenCalledWith("copy-me");
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
    }
  });
});
