import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MenuPage } from "./Menu";
import { RelationshipMenu } from "../model/menu";
import { applyMenuChange } from "../menu-editing";
import { MENU_TEMPLATES, templateMenu } from "../templates";

let ids = 0;

/** MenuPage wired to real state, the way App.tsx uses it (with simple undo). */
const Editor = ({ initial = {} }: { initial?: RelationshipMenu }) => {
  const [menu, setMenu] = useState<RelationshipMenu>(initial);
  const [history, setHistory] = useState<RelationshipMenu[]>([]);
  return (
    <MemoryRouter>
      <MenuPage
        title="T"
        menu={menu}
        menuEncoded="x:y"
        templateEncoded="x:z"
        onChange={(change) => {
          setHistory((h) => [...h, menu]);
          setMenu(applyMenuChange(menu, change, () => `item_${++ids}`));
        }}
        onUndo={() => {
          if (history.length) {
            setMenu(history[history.length - 1]);
            setHistory(history.slice(0, -1));
          }
        }}
        onChangeTitle={() => {}}
        onUseTemplate={(template) =>
          setMenu(templateMenu(template))
        }
      />
      <output data-testid="menu">{JSON.stringify(menu)}</output>
    </MemoryRouter>
  );
};

const groupInputs = () =>
  document.querySelectorAll<HTMLInputElement>("input.new-group-title");
const itemInputs = (groupEl: Element) =>
  groupEl.querySelectorAll<HTMLInputElement>(".menu-item-input");
const menuState = () => JSON.parse(screen.getByTestId("menu").textContent!);

describe("MenuPage editing", () => {
  it("typing a new group name creates one group and keeps focus", async () => {
    render(<Editor />);
    const input = groupInputs()[0];
    await userEvent.type(input, "Appetizers");

    expect(Object.keys(menuState())).toEqual(["Appetizers"]);
    expect(groupInputs()[0]).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Appetizers");
    expect(groupInputs()[1]).toHaveValue("");
  });

  it("typing a new item creates one item and keeps focus", async () => {
    render(<Editor initial={{ Appetizers: [] }} />);
    const group = document.querySelector(".menu-group")!;
    const input = itemInputs(group)[0];
    await userEvent.type(input, "Spring Rolls");

    expect(menuState().Appetizers.map((i: { item: string }) => i.item)).toEqual([
      "Spring Rolls",
    ]);
    expect(itemInputs(group)[0]).toBe(input);
    expect(input).toHaveFocus();
    expect(itemInputs(group)[1]).toHaveValue("");
  });

  it("supports group names btoa can't encode", async () => {
    render(<Editor />);
    await userEvent.type(groupInputs()[0], "愛 💕");
    expect(Object.keys(menuState())).toEqual(["愛 💕"]);
  });

  it("warns instead of overwriting when a new group name is already used", async () => {
    render(
      <Editor initial={{ A: [{ id: "1", item: "Kissing", value: "maybe" }] }} />
    );
    const newGroup = groupInputs()[1];
    await userEvent.type(newGroup, "A");
    expect(screen.getByText("A group with this name already exists")).toBeInTheDocument();
    expect(menuState()).toEqual({ A: [{ id: "1", item: "Kissing", value: "maybe" }] });

    // Continuing to type a unique name creates the group.
    await userEvent.type(newGroup, "b");
    expect(Object.keys(menuState())).toEqual(["A", "Ab"]);
    expect(menuState().A).toHaveLength(1);
  });

  it("clearing a group's name keeps the group and its items", async () => {
    render(<Editor initial={{ A: [{ id: "1", item: "Kissing" }], B: [] }} />);
    await userEvent.clear(groupInputs()[0]);
    expect(menuState()).toEqual({ "": [{ id: "1", item: "Kissing" }], B: [] });
  });

  it("renaming a group keeps it in place", async () => {
    render(<Editor initial={{ A: [], B: [] }} />);
    await userEvent.type(groupInputs()[0], "x");
    expect(Object.keys(menuState())).toEqual(["Ax", "B"]);
    expect(groupInputs()[0]).toHaveFocus();
  });

  describe("keyboard controls", () => {
    const menu: RelationshipMenu = {
      Physical: [
        { id: "a", item: "Kissing" },
        { id: "b", item: "Hugging", value: "maybe" },
      ],
      Emotional: [{ id: "c", item: "Trust" }],
    };
    const row = (key: string) =>
      document.querySelector<HTMLElement>(`[data-row-key="${key}"]`)!;
    const items = () =>
      menuState().Physical.map((i: { item: string; value?: string }) => [i.item, i.value ?? null]);

    it("moves between rows with j/k and arrows, and answers with number keys", async () => {
      render(<Editor initial={menu} />);
      row("group-0").focus();
      await userEvent.keyboard("j");
      expect(row("a")).toHaveFocus();
      await userEvent.keyboard("1");
      await userEvent.keyboard("{ArrowDown}");
      expect(row("b")).toHaveFocus();
      await userEvent.keyboard("4");
      expect(items()).toEqual([
        ["Kissing", "must-have"],
        ["Hugging", "off-limits"],
      ]);
      await userEvent.keyboard("0");
      expect(items()[1]).toEqual(["Hugging", null]);
    });

    it("cycles preferences with h/l", async () => {
      render(<Editor initial={menu} />);
      row("b").focus();
      await userEvent.keyboard("l");
      expect(items()[1][1]).toBe("off-limits");
      await userEvent.keyboard("l");
      expect(items()[1][1]).toBeNull();
      await userEvent.keyboard("h");
      expect(items()[1][1]).toBe("off-limits");
    });

    it("Enter edits a row, Esc returns to the row, Enter while typing goes to the next row", async () => {
      render(<Editor initial={menu} />);
      row("a").focus();
      await userEvent.keyboard("{Enter}");
      const input = row("a").querySelector(".menu-item-input")!;
      expect(input).toHaveFocus();
      await userEvent.keyboard("!");
      expect(items()[0][0]).toBe("Kissing!");
      // Letters type while editing instead of acting as commands.
      await userEvent.keyboard("j");
      expect(items()[0][0]).toBe("Kissing!j");
      await userEvent.keyboard("{Escape}");
      expect(row("a")).toHaveFocus();
      await userEvent.keyboard("i{Enter}");
      expect(row("b").querySelector(".menu-item-input")).toHaveFocus();
    });

    it("o adds an item to the current group", async () => {
      render(<Editor initial={menu} />);
      row("a").focus();
      await userEvent.keyboard("o");
      await userEvent.keyboard("Dancing");
      expect(items().map((i: string[]) => i[0])).toEqual(["Kissing", "Hugging", "Dancing"]);
    });

    it("J/K move items, dd deletes, u undoes", async () => {
      render(<Editor initial={menu} />);
      row("a").focus();
      await userEvent.keyboard("J");
      expect(items().map((i: string[]) => i[0])).toEqual(["Hugging", "Kissing"]);
      expect(row("a")).toHaveFocus();
      await userEvent.keyboard("dd");
      expect(items().map((i: string[]) => i[0])).toEqual(["Hugging"]);
      await userEvent.keyboard("u");
      expect(items().map((i: string[]) => i[0])).toEqual(["Hugging", "Kissing"]);
    });

    it("? opens the help and Esc closes it", async () => {
      render(<Editor initial={menu} />);
      row("a").focus();
      await userEvent.keyboard("?");
      expect(screen.getByRole("dialog", { name: "Keyboard controls" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(row("a")).toHaveFocus();
    });

    it("selecting --- clears the preference instead of storing '---'", async () => {
      render(<Editor initial={menu} />);
      const select = row("b").querySelector("select")!;
      await userEvent.selectOptions(select, "---");
      expect(menuState().Physical[1].value).toBeUndefined();
    });
  });

  describe("templates", () => {
    it("offers templates in an empty menu and loads the chosen one", async () => {
      render(<Editor />);
      expect(screen.getByRole("heading", { name: "Pick a starting point" })).toBeInTheDocument();
      const friendship = MENU_TEMPLATES.find((t) => t.id === "close-friendship")!;
      await userEvent.click(screen.getByRole("button", { name: new RegExp(friendship.name) }));
      expect(Object.keys(menuState())).toEqual(Object.keys(friendship.groups));
      // The picker goes away once the menu has groups.
      expect(screen.queryByRole("heading", { name: "Pick a starting point" })).not.toBeInTheDocument();
    });

    it("adds a ready-made group from the picker below the menu", async () => {
      render(<Editor initial={{ Mine: [] }} />);
      await userEvent.selectOptions(screen.getByLabelText("Add a ready-made group"), "Finances");
      expect(Object.keys(menuState())).toEqual(["Mine", "Finances"]);
      expect(menuState().Finances.length).toBeGreaterThan(2);
    });
  });
});

describe("Reorder mode (ED-7, ED-23)", () => {
  const initial: RelationshipMenu = {
    Touch: [
      { id: "a", item: "Kissing", value: "must-have" },
      { id: "b", item: "Cuddling" },
      { id: "c", item: "Holding hands" },
    ],
    Future: [{ id: "d", item: "Kids" }],
    Home: [{ id: "e", item: "Pets" }],
  };
  const order = () => {
    const m = menuState() as RelationshipMenu;
    return Object.fromEntries(Object.entries(m).map(([g, items]) => [g, items.map((i) => i.item)]));
  };

  it("shows ▲▼ on every item and group, instead of their other actions and the new rows", async () => {
    render(<Editor initial={initial} />);
    expect(screen.queryByRole("button", { name: 'Move "Kissing" up' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "↕ Reorder" }));
    expect(screen.getByRole("button", { name: "✓ Done reordering" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /^Move ".*" (up|down)$/ })).toHaveLength(10);
    expect(screen.getAllByRole("button", { name: /^Move group ".*" (up|down)$/ })).toHaveLength(6);
    // At the ends the button is there but disabled, so rows don't shift.
    expect(screen.getByRole("button", { name: 'Move "Kissing" up' })).toBeDisabled();
    expect(screen.getByRole("button", { name: 'Move group "Home" down' })).toBeDisabled();
    // Delete, notes, make-into-group and the empty "new" rows are out of the way.
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /note/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "New item" })).not.toBeInTheDocument();
    expect([...groupInputs()].map((i) => i.value)).toEqual(["Touch", "Future", "Home"]);
  });

  it("moves items within their group and groups among themselves, keeping focus on the button", async () => {
    render(<Editor initial={initial} />);
    await userEvent.click(screen.getByRole("button", { name: "↕ Reorder" }));
    await userEvent.click(screen.getByRole("button", { name: 'Move "Kissing" down' }));
    expect(order().Touch).toEqual(["Cuddling", "Kissing", "Holding hands"]);
    expect(screen.getByRole("button", { name: 'Move "Kissing" down' })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: 'Move "Kissing" down' }));
    expect(order().Touch).toEqual(["Cuddling", "Holding hands", "Kissing"]);
    // At the bottom: focus moves to ▲, the one that still works.
    expect(screen.getByRole("button", { name: 'Move "Kissing" up' })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: 'Move group "Home" up' }));
    expect(Object.keys(order())).toEqual(["Touch", "Home", "Future"]);
    expect(screen.getByRole("button", { name: 'Move group "Home" up' })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: 'Move group "Home" up' }));
    expect(Object.keys(order())).toEqual(["Home", "Touch", "Future"]);
    expect(screen.getByRole("button", { name: 'Move group "Home" down' })).toHaveFocus();

    // Nothing was lost (ED-11), answers kept.
    expect(order()).toEqual({ Home: ["Pets"], Touch: ["Cuddling", "Holding hands", "Kissing"], Future: ["Kids"] });
    expect((menuState() as RelationshipMenu).Touch[2]).toMatchObject({ id: "a", value: "must-have" });

    // Each move is one undo step; done puts the usual row actions back.
    await userEvent.click(screen.getByRole("button", { name: "✓ Done reordering" }));
    expect(screen.getAllByRole("button", { name: /^Delete item/ }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(Object.keys(order())).toEqual(["Touch", "Home", "Future"]);
  });
});
