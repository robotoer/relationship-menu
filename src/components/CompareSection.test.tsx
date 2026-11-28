import { render, screen, fireEvent, within } from "@testing-library/react";
import { COMPARE_LIMIT, CompareSection, menuSlots } from "./CompareSection";
import { encodeMenuSlug } from "../compare-slug";
import { encodeData } from "../data-encoder";

const anaMenu = encodeData({ Time: [{ item: "Weekly time together", value: "must-have" }, { item: "Calls", value: "maybe" }] });
const benMenu = encodeData({ Time: [{ item: "Weekly time together", value: "off-limits" }] });
const ana = encodeMenuSlug("Ana", anaMenu);
const ben = encodeMenuSlug("Ben", benMenu);
const library = [
  { title: "Ana", encoded: anaMenu },
  { title: "Ben", encoded: benMenu },
];
const pasted = encodeMenuSlug("Cy", encodeData({ Time: [{ item: "Calls" }] }));

const section = (over: Partial<Parameters<typeof CompareSection>[0]> = {}) => (
  <CompareSection titles={[]} menus={[]} onChange={vi.fn()} onCompare={vi.fn()} canCompare={false} {...over} />
);

describe("CompareSection: choosing menus (SV-19, SV-20)", () => {
  it("starts with a short instruction and the picker open on an empty comparison", () => {
    render(section());
    expect(screen.getByText(/Pick two or more menus/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add the first menu" })).toBeInTheDocument();
    expect(screen.getByLabelText("Paste a menu link")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    expect(screen.getByText("Add at least two menus")).toBeInTheDocument();
  });

  it("shows one card per menu: its name, where it came from, and how many items", () => {
    render(section({ menus: [ana, pasted], titles: ["Ana", "Cy"], library, canCompare: true }));
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Ana");
    expect(cards[0]).toHaveTextContent("Your library");
    expect(cards[0]).toHaveTextContent("2 items");
    expect(cards[1]).toHaveTextContent("Cy");
    expect(cards[1]).toHaveTextContent("Pasted link");
    // The raw link is never the thing you read.
    expect(screen.queryByDisplayValue(ana)).toBeNull();
  });

  it("adds a menu from the library, and says where it came from", () => {
    const onChange = vi.fn();
    render(section({ onChange, library }));
    expect(screen.getByRole("heading", { name: "Add the first menu" })).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByRole("button", { name: /Ana/ })).toHaveTextContent("Your library");
    fireEvent.click(within(list).getByRole("button", { name: /Ana/ }));
    expect(onChange).toHaveBeenCalledWith([ana]);
  });

  it("searches the library and says when nothing matches", () => {
    render(section({ library }));
    fireEvent.change(screen.getByPlaceholderText("Search your menus"), { target: { value: "ben" } });
    expect(screen.getByRole("button", { name: /Ben/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ana/ })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search your menus"), { target: { value: "zzz" } });
    expect(screen.getByText("No menu matches that.")).toBeInTheDocument();
  });

  it("adds a pasted link through the picker", () => {
    const onChange = vi.fn();
    render(section({ menus: [ana], titles: ["Ana"], library, onChange }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add a menu" }));
    fireEvent.change(screen.getByLabelText("Paste a menu link"), { target: { value: `  ${ben}  ` } });
    fireEvent.click(screen.getByRole("button", { name: "Use link" }));
    expect(onChange).toHaveBeenCalledWith([ana, ben]);
  });

  it("changes one menu without touching the others", () => {
    const onChange = vi.fn();
    render(section({ menus: [ana, ben], titles: ["Ana", "Ben"], library, onChange, canCompare: true }));
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[1]);
    expect(screen.getByRole("heading", { name: "Change this menu" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paste a menu link"), { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Use link" }));
    expect(onChange).toHaveBeenCalledWith([ana, pasted]);
  });

  it("removes a menu with its ✕", () => {
    const onChange = vi.fn();
    render(section({ menus: [ana, ben], titles: ["Ana", "Ben"], library, onChange, canCompare: true }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));
    expect(onChange).toHaveBeenCalledWith([ben]);
  });

  it("shows an error under the menu it belongs to", () => {
    render(section({ menus: [ana, "broken"], titles: ["Ana", ""], errors: [undefined, "Not a valid menu link"], library }));
    expect(screen.getByText("Not a valid menu link")).toBeInTheDocument();
  });

  it("stops at the limit", () => {
    const menus = Array.from({ length: COMPARE_LIMIT }, (_, i) => `${ana}${i}`);
    render(section({ menus, titles: menus.map((_, i) => `Menu ${i + 1}`), canCompare: true }));
    expect(screen.queryByRole("button", { name: "+ Add a menu" })).toBeNull();
    expect(screen.getByText(`${COMPARE_LIMIT} of ${COMPARE_LIMIT} menus`)).toBeInTheDocument();
  });

  it("collapses to a summary line once the comparison exists", () => {
    const onEdit = vi.fn();
    render(section({ menus: [ana, pasted], titles: ["Ana", "Cy"], library, collapsed: true, onEdit }));
    expect(screen.getByText("Comparing")).toBeInTheDocument();
    const chips = screen.getAllByRole("listitem");
    expect(chips[0]).toHaveTextContent("Ana");
    expect(chips[0]).toHaveTextContent("Your library");
    expect(chips[1]).toHaveTextContent("Pasted link");
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit menus" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("names a menu from its link, falling back to the given title or position", () => {
    expect(menuSlots([ana, "not-a-link"], ["", "Third"], library)).toEqual([
      { title: "Ana", source: "library", items: 2 },
      { title: "Third", source: "link", items: null },
    ]);
  });
});
