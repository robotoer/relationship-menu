import { Meta, StoryObj } from "@storybook/react/*";
import { MenuTile } from "./MenuTile";

const meta = {
  title: "Components/MenuTile",
  component: MenuTile,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof MenuTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Menu Tile",
    image: <img src="https://via.placeholder.com/150" alt="Placeholder" />,
    link: "https://example.com",
  },
};
