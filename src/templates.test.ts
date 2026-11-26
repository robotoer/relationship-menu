import { GROUP_TEMPLATES, MENU_TEMPLATES, templateMenu } from "./templates";

// Same matching as adding a ready-made group (spec ED-8).
const key = (text: string) => text.trim().toLowerCase();

const allGroups = [
  ...MENU_TEMPLATES.flatMap((t) =>
    Object.entries(t.groups).map(([name, items]) => ({ where: `${t.id} / ${name}`, items }))
  ),
  ...GROUP_TEMPLATES.map((g) => ({ where: `ready-made / ${g.name}`, items: g.items })),
];

describe("templates", () => {
  it("have unique ids", () => {
    const ids = MENU_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offer each ready-made group name once", () => {
    const names = GROUP_TEMPLATES.map((g) => key(g.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(allGroups)("$where has no blank or repeated items", ({ items }) => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.trim()).toBe(item);
    expect(items.every((item) => item.length > 0)).toBe(true);
    expect(new Set(items.map(key)).size).toBe(items.length);
  });

  it("start menus with no answers or notes", () => {
    for (const template of MENU_TEMPLATES) {
      for (const items of Object.values(templateMenu(template))) {
        for (const item of items) expect(item).toEqual({ item: item.item });
      }
    }
  });
});
