import { StoryObj } from "@storybook/react/*";
import { MenuItemCompare } from "./MenuItemCompare";

const meta = {
  title: "Components/MenuItemCompare",
  component: MenuItemCompare,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    item: "Menu Item",
    menuItems: ["must-have", "like-to-have", "maybe", "off-limits"],
  },
};
