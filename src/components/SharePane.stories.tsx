import { Meta, StoryObj } from "@storybook/react/*";
import { SharePane } from "./SharePane";

const meta = {
  title: "Components/SharePane",
  component: SharePane,
} as Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "https://example.com",
    description: "This is a description",
    title: "This is a title",
  },
};
