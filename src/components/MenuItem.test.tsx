import { render, screen, fireEvent } from "@testing-library/react";
import { MenuItem } from "./MenuItem";

describe("MenuItem", () => {
  it("should render with item text", () => {
    render(<MenuItem item="Kissing" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("Kissing")).toBeInTheDocument();
  });

  it("should render with a selected value", () => {
    render(
      <MenuItem item="Kissing" value="must-have" onChange={vi.fn()} />
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("must-have");
    expect(select).toHaveClass("must-have");
  });

  it("should apply 'unknown' class when no value is selected", () => {
    render(<MenuItem item="Kissing" onChange={vi.fn()} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveClass("unknown");
  });

  it("should call onChange with the new value when select changes", () => {
    const onChange = vi.fn();
    render(<MenuItem item="Kissing" onChange={onChange} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "off-limits" } });
    expect(onChange).toHaveBeenCalledWith({ value: "off-limits" });
  });

  it("should call onChange with the new item text when input changes", () => {
    const onChange = vi.fn();
    render(<MenuItem item="Kissing" onChange={onChange} />);
    const input = screen.getByDisplayValue("Kissing");
    fireEvent.change(input, { target: { value: "Hugging" } });
    expect(onChange).toHaveBeenCalledWith({ item: "Hugging" });
  });

  it("should render all preference options", () => {
    render(<MenuItem item="Test" onChange={vi.fn()} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5);
    expect(options[0]).toHaveTextContent("---");
    expect(options[1]).toHaveTextContent("Must Have");
    expect(options[2]).toHaveTextContent("Like to Have");
    expect(options[3]).toHaveTextContent("Maybe");
    expect(options[4]).toHaveTextContent("Off Limits");
  });

  it("should render a delete button when onDelete is provided", () => {
    const onDelete = vi.fn();
    render(<MenuItem item="Kissing" onChange={vi.fn()} onDelete={onDelete} />);
    const deleteButton = screen.getByRole("button", { name: /^Delete item/ });
    expect(deleteButton).toBeInTheDocument();
  });

  it("should not render a delete button when onDelete is not provided", () => {
    render(<MenuItem item="Kissing" onChange={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /^Delete item/ })
    ).not.toBeInTheDocument();
  });

  it("should call onDelete when the delete button is clicked", () => {
    const onDelete = vi.fn();
    render(<MenuItem item="Kissing" onChange={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete item/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("should set the id attribute on the input when provided", () => {
    render(<MenuItem id="test-id" item="Kissing" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("Kissing")).toHaveAttribute("id", "test-id");
  });

  it("should show placeholder 'New item' for empty item text", () => {
    render(<MenuItem item="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("New item")).toBeInTheDocument();
  });

  describe("notes and make-into-group", () => {
    it("opens a note field from the note button and reports typed notes", () => {
      const onChange = vi.fn();
      render(<MenuItem item="Kissing" onChange={onChange} onDelete={vi.fn()} />);
      expect(screen.queryByLabelText("Note on Kissing")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add a note to Kissing" }));
      const note = screen.getByLabelText("Note on Kissing");
      expect(note).toHaveFocus();
      fireEvent.change(note, { target: { value: "not in public" } });
      expect(onChange).toHaveBeenCalledWith({ note: "not in public" });
    });

    it("shows an existing note, and clearing it reports undefined", () => {
      const onChange = vi.fn();
      render(<MenuItem item="Kissing" note="ask first" onChange={onChange} onDelete={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Edit note on Kissing" })).toHaveAttribute("aria-expanded", "true");
      fireEvent.change(screen.getByLabelText("Note on Kissing"), { target: { value: "" } });
      expect(onChange).toHaveBeenCalledWith({ note: undefined });
    });

    it("has no note or make-group controls on the new-item row", () => {
      render(<MenuItem item="" onChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /note/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /into a group/i })).not.toBeInTheDocument();
    });

    it("makes the item into a group, or explains why it can't", () => {
      const onMakeGroup = vi.fn();
      const { rerender } = render(
        <MenuItem item="Kids" onChange={vi.fn()} onDelete={vi.fn()} onMakeGroup={onMakeGroup} />
      );
      fireEvent.click(screen.getByRole("button", { name: 'Make "Kids" into a group' }));
      expect(onMakeGroup).toHaveBeenCalled();
      rerender(
        <MenuItem
          item="Kids"
          onChange={vi.fn()}
          onDelete={vi.fn()}
          onMakeGroup={onMakeGroup}
          makeGroupBlockedReason="There's already a group with this name"
        />
      );
      const button = screen.getByRole("button", { name: 'Make "Kids" into a group' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "There's already a group with this name");
    });
  });
});
