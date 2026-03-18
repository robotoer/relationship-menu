import { render, screen } from "@testing-library/react";
import { ShareSection } from "./ShareSection";

describe("ShareSection", () => {
  it("should render all four share panes", () => {
    render(
      <ShareSection
        menuUrl="https://example.com/menu"
        menuEncoded="menu-slug"
        templateUrl="https://example.com/template"
        templateEncoded="template-slug"
      />
    );
    expect(screen.getByText("Share Menu Link")).toBeInTheDocument();
    expect(screen.getByText("Share Menu Slug")).toBeInTheDocument();
    expect(screen.getByText("Share Template Link")).toBeInTheDocument();
    expect(screen.getByText("Share Template Slug")).toBeInTheDocument();
  });

  it("should display the correct values in each share pane", () => {
    render(
      <ShareSection
        menuUrl="https://example.com/menu"
        menuEncoded="menu-slug"
        templateUrl="https://example.com/template"
        templateEncoded="template-slug"
      />
    );
    expect(
      screen.getByDisplayValue("https://example.com/menu")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("menu-slug")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://example.com/template")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("template-slug")).toBeInTheDocument();
  });

  it("should render four Copy buttons", () => {
    render(
      <ShareSection
        menuUrl="url1"
        menuEncoded="slug1"
        templateUrl="url2"
        templateEncoded="slug2"
      />
    );
    expect(screen.getAllByText("Copy")).toHaveLength(4);
  });
});
