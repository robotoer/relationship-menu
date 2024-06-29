import { Meta, StoryObj } from "@storybook/react/*";
import { CompareSection } from "./CompareSection";

const meta = {
  title: "Components/CompareSection",
  component: CompareSection,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof CompareSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    titles: ["Person 1", "Person 2", "Person 3", "Person 4"],
    menus: [],
    onChange: () => {},
  },
};
