import { Meta, StoryObj } from "@storybook/react/*";
import { MenuCompareLegend } from "./MenuCompareLegend";

const meta = {
  title: "Components/MenuCompareLegend",
  component: MenuCompareLegend,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof MenuCompareLegend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    titles: ["Person 1", "Person 2", "Person 3", "Person 4"],
  },
};
