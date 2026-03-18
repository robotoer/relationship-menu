import { render, screen, fireEvent } from "@testing-library/react";
import { MenuItem } from "./MenuItem";

describe("MenuItem", () => {
  it("should render with item text", () => {
    render(<MenuItem item="Kissing" onChange={jest.fn()} />);
    expect(screen.getByDisplayValue("Kissing")).toBeInTheDocument();
  });

  it("should render with a selected value", () => {
    render(
      <MenuItem item="Kissing" value="must-have" onChange={jest.fn()} />
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("must-have");
    expect(select).toHaveClass("must-have");
  });

  it("should apply 'unknown' class when no value is selected", () => {
    render(<MenuItem item="Kissing" onChange={jest.fn()} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveClass("unknown");
  });

  it("should call onChange with the new value when select changes", () => {
    const onChange = jest.fn();
    render(<MenuItem item="Kissing" onChange={onChange} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "off-limits" } });
    expect(onChange).toHaveBeenCalledWith({ value: "off-limits" });
  });

  it("should call onChange with the new item text when input changes", () => {
    const onChange = jest.fn();
    render(<MenuItem item="Kissing" onChange={onChange} />);
    const input = screen.getByDisplayValue("Kissing");
    fireEvent.change(input, { target: { value: "Hugging" } });
    expect(onChange).toHaveBeenCalledWith({ item: "Hugging" });
  });

  it("should render all preference options", () => {
    render(<MenuItem item="Test" onChange={jest.fn()} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5);
    expect(options[0]).toHaveTextContent("---");
    expect(options[1]).toHaveTextContent("Must Have");
    expect(options[2]).toHaveTextContent("Like to Have");
    expect(options[3]).toHaveTextContent("Maybe");
    expect(options[4]).toHaveTextContent("Off Limits");
  });

  it("should render a delete button when onDelete is provided", () => {
    const onDelete = jest.fn();
    render(<MenuItem item="Kissing" onChange={jest.fn()} onDelete={onDelete} />);
    const deleteButton = screen.getByRole("button", { name: "Delete item" });
    expect(deleteButton).toBeInTheDocument();
  });

  it("should not render a delete button when onDelete is not provided", () => {
    render(<MenuItem item="Kissing" onChange={jest.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Delete item" })
    ).not.toBeInTheDocument();
  });

  it("should call onDelete when the delete button is clicked", () => {
    const onDelete = jest.fn();
    render(<MenuItem item="Kissing" onChange={jest.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("should set the id attribute on the input when provided", () => {
    render(<MenuItem id="test-id" item="Kissing" onChange={jest.fn()} />);
    expect(screen.getByDisplayValue("Kissing")).toHaveAttribute("id", "test-id");
  });

  it("should show placeholder 'New item' for empty item text", () => {
    render(<MenuItem item="" onChange={jest.fn()} />);
    expect(screen.getByPlaceholderText("New item")).toBeInTheDocument();
  });
});
