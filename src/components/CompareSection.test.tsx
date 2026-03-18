import { render, screen, fireEvent } from "@testing-library/react";
import { CompareSection } from "./CompareSection";

describe("CompareSection", () => {
  it("should render inputs for existing menus", () => {
    render(
      <CompareSection
        titles={["Alice", "Bob"]}
        menus={["encoded1", "encoded2"]}
        onChange={jest.fn()}
        onCompare={jest.fn()}
        canCompare={true}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByDisplayValue("encoded1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("encoded2")).toBeInTheDocument();
  });

  it("should render an empty input for adding a new menu", () => {
    render(
      <CompareSection
        titles={["Alice"]}
        menus={["encoded1"]}
        onChange={jest.fn()}
        onCompare={jest.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByText("Menu 2")).toBeInTheDocument();
  });

  it("should render the Compare button", () => {
    render(
      <CompareSection
        titles={[]}
        menus={[]}
        onChange={jest.fn()}
        onCompare={jest.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("should disable the Compare button when canCompare is false", () => {
    render(
      <CompareSection
        titles={[]}
        menus={[]}
        onChange={jest.fn()}
        onCompare={jest.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByText("Compare")).toBeDisabled();
  });

  it("should enable the Compare button when canCompare is true", () => {
    render(
      <CompareSection
        titles={["A", "B"]}
        menus={["e1", "e2"]}
        onChange={jest.fn()}
        onCompare={jest.fn()}
        canCompare={true}
      />
    );
    expect(screen.getByText("Compare")).toBeEnabled();
  });

  it("should call onCompare when Compare button is clicked", () => {
    const onCompare = jest.fn();
    render(
      <CompareSection
        titles={["A", "B"]}
        menus={["e1", "e2"]}
        onChange={jest.fn()}
        onCompare={onCompare}
        canCompare={true}
      />
    );
    fireEvent.click(screen.getByText("Compare"));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("should call onChange to update existing menu when input changes", () => {
    const onChange = jest.fn();
    render(
      <CompareSection
        titles={["Alice"]}
        menus={["encoded1"]}
        onChange={onChange}
        onCompare={jest.fn()}
        canCompare={false}
      />
    );
    const input = screen.getByDisplayValue("encoded1");
    fireEvent.change(input, { target: { value: "new-encoded" } });
    expect(onChange).toHaveBeenCalledWith(["new-encoded"]);
  });

  it("should call onChange to add a new menu when the empty input gets a value", () => {
    const onChange = jest.fn();
    render(
      <CompareSection
        titles={["Alice"]}
        menus={["encoded1"]}
        onChange={onChange}
        onCompare={jest.fn()}
        canCompare={false}
      />
    );
    // The empty input is the one labeled "Menu 2"
    const inputs = screen.getAllByRole("textbox");
    const emptyInput = inputs[inputs.length - 1];
    fireEvent.change(emptyInput, { target: { value: "new-menu" } });
    expect(onChange).toHaveBeenCalledWith(["encoded1", "new-menu"]);
  });

  it("should call onChange to remove a menu when its input is cleared", () => {
    const onChange = jest.fn();
    render(
      <CompareSection
        titles={["Alice", "Bob"]}
        menus={["encoded1", "encoded2"]}
        onChange={onChange}
        onCompare={jest.fn()}
        canCompare={true}
      />
    );
    const input = screen.getByDisplayValue("encoded1");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(["encoded2"]);
  });

  it("should use default label 'Menu N' when titles are not provided for an index", () => {
    render(
      <CompareSection
        titles={[]}
        menus={["encoded1"]}
        onChange={jest.fn()}
        onCompare={jest.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByText("Menu 1")).toBeInTheDocument();
  });
});
