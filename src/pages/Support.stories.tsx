import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { HashRouter } from "react-router-dom";
import { SupportPage } from "./Support";

const meta = {
  title: "Pages/Support",
  component: SupportPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <HashRouter>{Story()}</HashRouter>],
} satisfies Meta<typeof SupportPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
