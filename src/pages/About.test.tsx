import { render, screen } from "@testing-library/react";
import { AboutPage } from "./About";

describe("AboutPage", () => {
  it("should render the About heading", () => {
    render(<AboutPage />);
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("should render the How to Use section", () => {
    render(<AboutPage />);
    expect(screen.getByText("How to Use")).toBeInTheDocument();
  });

  it("should render the Comparison section", () => {
    render(<AboutPage />);
    expect(screen.getByText("Comparison")).toBeInTheDocument();
  });

  it("should render the Feedback section", () => {
    render(<AboutPage />);
    expect(screen.getByText("Feedback")).toBeInTheDocument();
  });

  it("should describe the purpose of the app", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/simple way to create, customize and edit/i)
    ).toBeInTheDocument();
  });
});
