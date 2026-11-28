import { render, screen, fireEvent } from "@testing-library/react";
import { COMPARE_LIMIT, CompareSection } from "./CompareSection";
import { encodeMenuSlug } from "../compare-slug";
import { encodeData } from "../data-encoder";

describe("CompareSection", () => {
  it("should render inputs for existing menus", () => {
    render(
      <CompareSection
        titles={["Alice", "Bob"]}
        menus={["encoded1", "encoded2"]}
        onChange={vi.fn()}
        onCompare={vi.fn()}
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
        onChange={vi.fn()}
        onCompare={vi.fn()}
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
        onChange={vi.fn()}
        onCompare={vi.fn()}
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
        onChange={vi.fn()}
        onCompare={vi.fn()}
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
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare={true}
      />
    );
    expect(screen.getByText("Compare")).toBeEnabled();
  });

  it("should call onCompare when Compare button is clicked", () => {
    const onCompare = vi.fn();
    render(
      <CompareSection
        titles={["A", "B"]}
        menus={["e1", "e2"]}
        onChange={vi.fn()}
        onCompare={onCompare}
        canCompare={true}
      />
    );
    fireEvent.click(screen.getByText("Compare"));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("should call onChange to update existing menu when input changes", () => {
    const onChange = vi.fn();
    render(
      <CompareSection
        titles={["Alice"]}
        menus={["encoded1"]}
        onChange={onChange}
        onCompare={vi.fn()}
        canCompare={false}
      />
    );
    const input = screen.getByDisplayValue("encoded1");
    fireEvent.change(input, { target: { value: "new-encoded" } });
    expect(onChange).toHaveBeenCalledWith(["new-encoded"]);
  });

  it("should call onChange to add a new menu when the empty input gets a value", () => {
    const onChange = vi.fn();
    render(
      <CompareSection
        titles={["Alice"]}
        menus={["encoded1"]}
        onChange={onChange}
        onCompare={vi.fn()}
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
    const onChange = vi.fn();
    render(
      <CompareSection
        titles={["Alice", "Bob"]}
        menus={["encoded1", "encoded2"]}
        onChange={onChange}
        onCompare={vi.fn()}
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
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByText("Menu 1")).toBeInTheDocument();
  });

  it("should keep the same input element (and focus) when the empty input becomes a new entry", () => {
    const { rerender } = render(
      <CompareSection
        titles={[]}
        menus={[]}
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare={false}
      />
    );
    const emptyInput = screen.getByRole("textbox");
    emptyInput.focus();
    rerender(
      <CompareSection
        titles={[]}
        menus={["a"]}
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare={false}
      />
    );
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toBe(emptyInput);
    expect(inputs[0]).toHaveValue("a");
    expect(inputs[0]).toHaveFocus();
    expect(inputs[1]).toHaveValue("");
  });

  it("should show errors for invalid entries", () => {
    render(
      <CompareSection
        titles={["Alice", ""]}
        menus={["good", "bad"]}
        errors={[undefined, "Not a valid menu slug or share link"]}
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByDisplayValue("bad")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByDisplayValue("good")).not.toHaveAttribute("aria-invalid");
    expect(
      screen.getByText("Not a valid menu slug or share link")
    ).toBeInTheDocument();
  });

  it("should label inputs so they are reachable by label text", () => {
    render(
      <CompareSection
        titles={["Alice"]}
        menus={["encoded1"]}
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare={false}
      />
    );
    expect(screen.getByLabelText("Alice")).toHaveValue("encoded1");
    expect(screen.getByLabelText("Menu 2")).toHaveValue("");
  });
});

describe("CompareSection: adding menus (SV-19)", () => {
  const library = [
    { title: "Ana", encoded: encodeData({ Time: [{ item: "Weekly time together", value: "must-have" }] }) },
    { title: "Ben", encoded: encodeData({ Time: [{ item: "Weekly time together", value: "off-limits" }] }) },
  ];

  it("adds a saved menu from this browser instead of a pasted link", () => {
    const onChange = vi.fn();
    render(
      <CompareSection
        titles={["Ana"]}
        menus={[encodeMenuSlug("Ana", library[0].encoded)]}
        onChange={onChange}
        onCompare={vi.fn()}
        canCompare={false}
        library={library}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Add a menu/ }));
    // Ana is already in the comparison, so only Ben is offered.
    expect(screen.queryByRole("button", { name: "Ana" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ben" }));
    expect(onChange).toHaveBeenCalledWith([
      encodeMenuSlug("Ana", library[0].encoded),
      encodeMenuSlug("Ben", library[1].encoded),
    ]);
  });

  it("says when there is nothing saved to add", () => {
    render(
      <CompareSection titles={[]} menus={[]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} library={[]} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Add a menu/ }));
    expect(screen.getByText(/haven't saved any menus/)).toBeInTheDocument();
  });

  it("stops at the comparison limit", () => {
    const menus = Array.from({ length: COMPARE_LIMIT }, (_, i) => `menu${i}`);
    render(
      <CompareSection
        titles={menus.map((_, i) => `Menu ${i + 1}`)}
        menus={menus}
        onChange={vi.fn()}
        onCompare={vi.fn()}
        canCompare
        library={library}
      />
    );
    expect(screen.queryByRole("button", { name: /Add a menu/ })).toBeNull();
    // No trailing empty box once it's full: every box holds a menu.
    expect(screen.getAllByRole("textbox")).toHaveLength(COMPARE_LIMIT);
  });

  it("shows how many menus are in the comparison", () => {
    render(
      <CompareSection titles={["A", "B"]} menus={["e1", "e2"]} onChange={vi.fn()} onCompare={vi.fn()} canCompare />
    );
    expect(screen.getByText(`2 of ${COMPARE_LIMIT} menus`)).toBeInTheDocument();
  });
});
