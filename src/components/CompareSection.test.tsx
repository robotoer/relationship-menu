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

  it("shows no empty box: one box per menu, and one way to add (SV-19)", () => {
    render(
      <CompareSection titles={["Alice"]} menus={["encoded1"]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} />
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByText("Menu 2")).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add a menu" })).toBeInTheDocument();
  });

  it("opens the add card on an empty comparison, with the paste field ready", () => {
    render(<CompareSection titles={[]} menus={[]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} />);
    expect(screen.getByRole("heading", { name: "Add the first menu" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "+ Add a menu" })).toBeNull();
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

  it("adds a pasted link through the add card", () => {
    const onChange = vi.fn();
    render(
      <CompareSection titles={["Alice"]} menus={["encoded1"]} onChange={onChange} onCompare={vi.fn()} canCompare={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add a menu" }));
    fireEvent.change(screen.getByLabelText("Paste a menu link or share link"), { target: { value: "  new-menu  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith(["encoded1", "new-menu"]);
  });

  it("removes a menu with its ✕", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(onChange).toHaveBeenCalledWith(["encoded2"]);
  });

  it("keeps Cancel available only when there are menus to return to", () => {
    const { unmount } = render(
      <CompareSection titles={[]} menus={[]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} />
    );
    // Nothing to go back to on an empty comparison, so no Cancel.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    unmount();
    render(<CompareSection titles={["A"]} menus={["e1"]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a menu" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
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

  it("closes the add card as part of adding, not a render later", () => {
    const onChange = vi.fn();
    render(<CompareSection titles={[]} menus={[]} onChange={onChange} onCompare={vi.fn()} canCompare={false} />);
    fireEvent.change(screen.getByLabelText("Paste a menu link or share link"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
    expect(screen.queryByRole("heading", { name: /Add/ })).toBeNull();
    expect(screen.queryByLabelText("Paste a menu link or share link")).toBeNull();
  });

  it("shows a menu as one box, with the add card closed", () => {
    render(<CompareSection titles={["A"]} menus={["a"]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByDisplayValue("a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add a menu" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "+ Add a menu" }));
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
    expect(screen.getByText(/Nothing saved in this browser yet/)).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "+ Add a menu" })).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(COMPARE_LIMIT);
  });

  it("shows how many menus are in the comparison", () => {
    render(
      <CompareSection titles={["A", "B"]} menus={["e1", "e2"]} onChange={vi.fn()} onCompare={vi.fn()} canCompare />
    );
    expect(screen.getByText(`2 of ${COMPARE_LIMIT} menus`)).toBeInTheDocument();
  });
});
