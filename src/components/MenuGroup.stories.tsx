import { Meta, StoryObj } from "@storybook/react/*";
import { MenuGroup } from "./MenuGroup";

const meta = {
  title: "Components/MenuGroup",
  component: MenuGroup,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof MenuGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: <h2>Menu Group</h2>,
    children: "Menu Group Content",
  },
};
