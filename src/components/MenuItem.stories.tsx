import { Meta, StoryObj } from "@storybook/react/*";
import { MenuItem } from "./MenuItem";

const meta = {
  title: "Components/MenuItem",
  component: MenuItem,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof MenuItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    item: "Menu Item",
    value: undefined,
    onChange: () => {},
  },
};

export const MustHave: Story = {
  args: {
    item: "Menu Item",
    value: "must-have",
    onChange: () => {},
  },
};

export const LikeToHave: Story = {
  args: {
    item: "Menu Item",
    value: "like-to-have",
    onChange: () => {},
  },
};

export const Maybe: Story = {
  args: {
    item: "Menu Item",
    value: "maybe",
    onChange: () => {},
  },
};

export const OffLimits: Story = {
  args: {
    item: "Menu Item",
    value: "off-limits",
    onChange: () => {},
  },
};
