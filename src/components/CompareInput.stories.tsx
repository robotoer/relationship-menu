import { Meta, StoryObj } from "@storybook/react/*";
import { CompareInput } from "./CompareInput";

const meta = {
  title: "Components/CompareInput",
  component: CompareInput,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof CompareInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Compare Input",
    value: undefined,
    onChange: () => {},
  },
};
