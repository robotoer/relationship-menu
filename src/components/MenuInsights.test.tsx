import { fireEvent, render, screen, within } from "@testing-library/react";
import { MenuInsights } from "./MenuInsights";
import { RelationshipMenu } from "../model/menu";
import { THEME_ANIMALS } from "../insights-content";

const otterMenu: RelationshipMenu = {
  Romance: [
    { item: "Kissing", value: "must-have" },
    { item: "Cuddling", value: "must-have" },
    { item: "Hugging", value: "must-have" },
  ],
  Chores: [
    { item: "Shared cooking", value: "like-to-have" },
    { item: "Cleaning schedule", value: "like-to-have" },
    { item: "Separate bedrooms", value: "off-limits" },
  ],
};

describe("MenuInsights", () => {
  it("IN-4: says how many more answers until the animal hatches", () => {
    render(<MenuInsights menu={{ A: [{ item: "Kissing", value: "maybe" }, { item: "Hugging" }] }} />);
    expect(screen.getByRole("heading", { name: "Still hatching" })).toBeInTheDocument();
    expect(screen.getByText("Answer 4 more items to see what hatches.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Another one" })).not.toBeInTheDocument();
  });

  it("IN-4, IN-5: names the animal with its style and streak", () => {
    render(<MenuInsights menu={otterMenu} />);
    expect(
      screen.getByRole("heading", { name: "A Wholehearted Otter with a streak of Beaver" })
    ).toBeInTheDocument();
    expect(screen.getByText("Lots of Must haves: all in.")).toBeInTheDocument();
  });

  it("IN-6: Another one changes only the wording, and goes round the list", () => {
    render(<MenuInsights menu={otterMenu} />);
    const [first, second] = THEME_ANIMALS.closeness.blurbs;
    expect(screen.getByText(first)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Another one" }));
    expect(screen.getByText(second)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Wholehearted Otter/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Another one" }));
    expect(screen.getByText(first)).toBeInTheDocument();
  });

  it("IN-9: every stat has its value in text, and emoji are hidden from screen readers", () => {
    const { container } = render(<MenuInsights menu={otterMenu} />);
    const stats = screen.getByRole("list", { name: "Stats" });
    expect(within(stats).getByText("Closeness").closest("li")).toHaveTextContent("Closeness3.0 out of 3");
    expect(within(stats).getByText("Talk").closest("li")).toHaveTextContent("not enough answers yet");
    const emoji = container.querySelectorAll(".insights-emoji, .insights-badge-emoji");
    expect(emoji.length).toBeGreaterThan(0);
    emoji.forEach((e) => expect(e).toHaveAttribute("aria-hidden", "true"));
  });

  it("IN-7: earned badges come first; unearned effort badges show a hint", () => {
    render(<MenuInsights menu={otterMenu} />);
    const badges = within(screen.getByRole("list", { name: "Badges" })).getAllByRole("listitem");
    expect(badges.map((b) => b.querySelector("strong")?.textContent)).toEqual([
      "Hatched",
      "Boundary Keeper",
      "Cartographer",
      "Well-Rounded",
      "Fine Print",
      "Homebrewer",
    ]);
    expect(badges[2]).toHaveTextContent("(not yet earned)");
    expect(badges[2]).toHaveTextContent("Answer every item (a menu of 10 or more).");
  });

  it("IN-10: a character sheet with class, multiclass and level once hatched", () => {
    render(<MenuInsights menu={otterMenu} />);
    expect(screen.getByText("Level 2 Enchanter")).toBeInTheDocument();
    expect(screen.getByText(/multiclass Artificer/)).toBeInTheDocument();
    expect(screen.getByText("Casts Hold Hands at will. No saving throw.")).toBeInTheDocument();
  });

  it("IN-11: a loot item quoting the menu's own items, with Roll again", () => {
    render(<MenuInsights menu={otterMenu} />);
    expect(screen.getByText("Unwavering Weighted Blanket of Kissing")).toBeInTheDocument();
    expect(screen.getByText("Epic")).toBeInTheDocument();
    expect(screen.getByText("+3.0 Closeness · +2.0 Hearth")).toBeInTheDocument();
    const lines = within(screen.getByRole("list", { name: "Loot lines" })).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([
      "+3 Cuddling",
      "+3 Hugging",
      "+1 Shared cooking",
      "Immune to: Separate bedrooms",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Roll again" }));
    expect(screen.getByText("Blazing Weighted Blanket of Cuddling")).toBeInTheDocument();
    expect(screen.getByText("Epic")).toBeInTheDocument();
  });

  it("IN-10, IN-11: no class or loot while still hatching", () => {
    render(<MenuInsights menu={{ A: [{ item: "Kissing", value: "maybe" }] }} />);
    expect(screen.queryByText(/^Level /)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Loot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Roll again" })).not.toBeInTheDocument();
  });
});
