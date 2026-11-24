import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MenuPage } from "./Menu";
import { RelationshipMenu } from "../model/menu";
import { applyMenuChange } from "../menu-editing";

let ids = 0;

/** MenuPage wired to real state, the way App.tsx uses it. */
const Editor = ({ initial = {} }: { initial?: RelationshipMenu }) => {
  const [menu, setMenu] = useState<RelationshipMenu>(initial);
  return (
    <MemoryRouter>
      <MenuPage
        title="T"
        menu={menu}
        menuEncoded="x:y"
        templateEncoded="x:z"
        onChange={(change) =>
          setMenu((prev) => applyMenuChange(prev, change, () => `item_${++ids}`))
        }
        onChangeTitle={() => {}}
      />
      <output data-testid="menu">{JSON.stringify(menu)}</output>
    </MemoryRouter>
  );
};

const groupInputs = () =>
  document.querySelectorAll<HTMLInputElement>("input.new-group-title");
const itemInputs = (groupEl: Element) =>
  groupEl.querySelectorAll<HTMLInputElement>("input.menu-item-input");
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
});
