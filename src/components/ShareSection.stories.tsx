import { Meta, StoryObj } from "@storybook/react/*";
import { ShareSection } from "./ShareSection";

const meta = {
  title: "Components/ShareSection",
  component: ShareSection,
} as Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    menuUrl: "https://example.com",
    menuEncoded: "encoded",
    templateUrl: "https://example.com",
    templateEncoded: "encoded",
  },
};
